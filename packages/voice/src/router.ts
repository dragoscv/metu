/**
 * Voice routing — picks lane + provider chain for a persona/utterance.
 *
 * Companion-Agent slice 2. Centralizes the "which providers do we try, in
 * what order?" decision so the companion + mobile + web broker all share a
 * single source of truth.
 *
 * Inputs:
 *   - persona (slug, voiceProvider, sttProvider, language, costTier)
 *   - environment hints (online?, hasLocalSidecar?)
 *
 * Output: a chain of attempts the caller walks until one succeeds.
 */
import type { RealtimeProviderId, STTProviderId, TTSProviderId } from './types';

export type CostTier = 'budget' | 'balanced' | 'premium';
export type VoiceLane = 'realtime' | 'pipeline';

/**
 * Mirror of the workspace billing tier from `workspace_subscription`. Lets
 * the router refuse providers above the user's plan so we never silently
 * burn through a higher-tier provider's API quota when the workspace is on
 * `free` or `starter`.
 */
export type BillingTier = 'free' | 'starter' | 'pro' | 'pro_plus' | 'enterprise';

/**
 * Allow-list of providers per billing tier. Each tier additively unlocks
 * providers; the router only picks a provider if it's in the workspace's
 * allow-set, otherwise it falls through to the next attempt.
 *
 * Free tier is local-only so $0 spend is structurally enforced — the cap
 * meter is the soft check, this is the hard one.
 */
const TIER_PROVIDERS: Record<BillingTier, ReadonlySet<string>> = {
  free: new Set(['local-whisper-cpp', 'piper-local']),
  starter: new Set(['local-whisper-cpp', 'piper-local', 'deepgram-nova3', 'deepgram-aura-2']),
  pro: new Set([
    'local-whisper-cpp',
    'piper-local',
    'deepgram-nova3',
    'deepgram-aura-2',
    'openai-whisper-1',
    'openai-4o-mini-transcribe',
    'cartesia-sonic-turbo',
    'elevenlabs-flash',
  ]),
  pro_plus: new Set([
    'local-whisper-cpp',
    'piper-local',
    'deepgram-nova3',
    'deepgram-aura-2',
    'openai-whisper-1',
    'openai-4o-mini-transcribe',
    'cartesia-sonic-turbo',
    'elevenlabs-flash',
    'openai-realtime',
  ]),
  enterprise: new Set([
    'local-whisper-cpp',
    'piper-local',
    'deepgram-nova3',
    'deepgram-aura-2',
    'openai-whisper-1',
    'openai-4o-mini-transcribe',
    'cartesia-sonic-turbo',
    'elevenlabs-flash',
    'openai-realtime',
    'anthropic-realtime',
  ]),
};

export function isVoiceProviderAllowed(tier: BillingTier, provider: string): boolean {
  return TIER_PROVIDERS[tier].has(provider);
}

function isAllowed(tier: BillingTier, provider: string): boolean {
  return isVoiceProviderAllowed(tier, provider);
}

function attemptAllowed(tier: BillingTier, a: VoiceAttempt): boolean {
  if (a.lane === 'realtime') return isAllowed(tier, a.provider);
  return isAllowed(tier, a.stt) && isAllowed(tier, a.tts);
}

export type VoiceRouteInput = {
  /** Persona-pinned realtime provider, if any. */
  voiceProvider: RealtimeProviderId | TTSProviderId | 'none';
  sttProvider: STTProviderId;
  /** BCP-47 language tag, e.g. 'en', 'ro', 'fr'. */
  language: string;
  costTier: CostTier;
  /** Workspace billing tier. Defaults to 'free' when omitted (most restrictive). */
  billingTier?: BillingTier;
  /** True when the device knows it has internet right now. */
  online: boolean;
  /** True when the device has whisper.cpp + piper sidecars provisioned. */
  hasLocalSidecar: boolean;
};

export type VoiceAttempt =
  | { lane: 'realtime'; provider: RealtimeProviderId }
  | {
      lane: 'pipeline';
      stt: STTProviderId;
      tts: TTSProviderId;
    };

export type VoiceRoute = {
  primary: VoiceAttempt;
  fallbacks: VoiceAttempt[];
};

const REALTIME_IDS: ReadonlySet<string> = new Set(['openai-realtime', 'anthropic-realtime']);

function isRealtime(id: string): id is RealtimeProviderId {
  return REALTIME_IDS.has(id);
}

/**
 * Pick a TTS provider for a given language + tier when the persona did not
 * pin one. Romanian is special-cased (ElevenLabs v3 has full RO; Cartesia
 * does not as of May 2026).
 */
function defaultTtsFor(language: string, tier: CostTier): TTSProviderId {
  const lang = language.toLowerCase();
  if (lang.startsWith('ro')) return 'elevenlabs-flash';
  if (tier === 'budget') return 'deepgram-aura-2';
  if (tier === 'premium') return 'elevenlabs-flash';
  return 'cartesia-sonic-turbo';
}

/**
 * Choose the active route. When offline + sidecars present, force the
 * local pipeline. When the persona pins a realtime provider AND we are
 * online, that's the primary; pipeline becomes the fallback.
 */
export function pickVoiceRoute(input: VoiceRouteInput): VoiceRoute {
  const tier: BillingTier = input.billingTier ?? 'free';
  const offline = !input.online;
  const localPipeline: VoiceAttempt = {
    lane: 'pipeline',
    stt: 'local-whisper-cpp',
    tts: 'piper-local',
  };

  if (offline) {
    if (input.hasLocalSidecar) {
      return { primary: localPipeline, fallbacks: [] };
    }
    // Offline + no sidecar: nothing will work, but pick the cheapest
    // pipeline so the caller's error message can name a real provider.
    return {
      primary: {
        lane: 'pipeline',
        stt: 'deepgram-nova3',
        tts: 'deepgram-aura-2',
      },
      fallbacks: [],
    };
  }

  // Online.
  const tts = defaultTtsFor(input.language, input.costTier);
  const remotePipeline: VoiceAttempt = {
    lane: 'pipeline',
    stt: input.sttProvider,
    tts,
  };

  let route: VoiceRoute;
  if (input.voiceProvider === 'none') {
    // Text-only persona — caller should not even ask, but be defensive.
    route = { primary: remotePipeline, fallbacks: [] };
  } else if (isRealtime(input.voiceProvider)) {
    const fallbacks: VoiceAttempt[] = [remotePipeline];
    if (input.hasLocalSidecar) fallbacks.push(localPipeline);
    route = {
      primary: { lane: 'realtime', provider: input.voiceProvider },
      fallbacks,
    };
  } else {
    // Persona pinned a TTS provider directly (pipeline-only).
    route = {
      primary: {
        lane: 'pipeline',
        stt: input.sttProvider,
        tts: input.voiceProvider,
      },
      fallbacks: input.hasLocalSidecar ? [localPipeline] : [],
    };
  }

  // Tier gate: drop attempts that include a provider above the user's plan.
  // The local pipeline is always allowed (free tier includes it) so we have
  // a guaranteed terminal fallback even when every paid attempt is denied.
  const allowed: VoiceAttempt[] = [route.primary, ...route.fallbacks].filter((a) =>
    attemptAllowed(tier, a),
  );
  if (allowed.length === 0) allowed.push(localPipeline);
  return { primary: allowed[0]!, fallbacks: allowed.slice(1) };
}

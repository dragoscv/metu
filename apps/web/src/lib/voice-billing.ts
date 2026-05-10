/**
 * Voice billing — record usage events + enforce monthly cap.
 *
 * Companion-Agent slice 7. Two responsibilities:
 *   1. `assertVoiceCap(workspaceId)` — called at the top of every voice
 *      broker route. Returns null if the call may proceed; otherwise a
 *      typed error the route should propagate as 402 Payment Required.
 *      Uses the workspace's subscription tier ceiling AND the user's
 *      `monthly_cost_cap_usd` (the lower of the two wins). Checked at
 *      80% (soft warn — caller can surface a banner) and 100% (hard cut).
 *   2. `recordVoiceUsage(...)` — fire-and-forget insert called after the
 *      upstream provider response. Cost computed from a per-provider
 *      pricing table; if the provider is unknown the row still records
 *      with cost=0 so the meter sees the call.
 *
 * BYOK calls (user-supplied keys) are intentionally still metered so the
 * UI shows real usage; the cap only applies to platform-billed (env-var)
 * calls. Distinguish by passing `byok: true` to `recordVoiceUsage`.
 */
import { and, gte, sql } from 'drizzle-orm';
import { getDb } from '@metu/db';
import {
  voiceUsage,
  workspace,
  workspaceSubscription,
  type subscriptionTier,
} from '@metu/db/schema';
import { eq } from 'drizzle-orm';

export type VoiceLane = 'realtime' | 'stt' | 'tts';
export type VoiceProvider =
  | 'deepgram'
  | 'cartesia'
  | 'elevenlabs'
  | 'openai-realtime'
  | 'anthropic-realtime'
  | 'piper-local'
  | 'local-whisper-cpp'
  | (string & {});

/**
 * Per-provider unit pricing (USD). Snapshot from May 2026 public pricing;
 * adjust here when providers change rates. Local providers cost $0.
 *
 * Units:
 *   - STT/TTS providers: USD per *minute* of audio.
 *   - Realtime providers: { input, output } USD per million tokens.
 */
const PRICING: Record<
  string,
  { perMinute?: number; perMillionInput?: number; perMillionOutput?: number }
> = {
  // STT
  deepgram: { perMinute: 0.0043 }, // nova-3 streaming
  'local-whisper-cpp': { perMinute: 0 },
  // TTS
  cartesia: { perMinute: 0.0166 }, // sonic-turbo
  elevenlabs: { perMinute: 0.0833 }, // flash v2.5 — premium tier
  'piper-local': { perMinute: 0 },
  // Realtime LLM
  'openai-realtime': { perMillionInput: 5, perMillionOutput: 20 },
  'anthropic-realtime': { perMillionInput: 5, perMillionOutput: 20 },
};

export function estimateCostUsd(
  provider: VoiceProvider,
  args: { seconds?: number; inputTokens?: number; outputTokens?: number },
): number {
  const p = PRICING[provider];
  if (!p) return 0;
  let cost = 0;
  if (p.perMinute && args.seconds) {
    cost += (args.seconds / 60) * p.perMinute;
  }
  if (p.perMillionInput && args.inputTokens) {
    cost += (args.inputTokens / 1_000_000) * p.perMillionInput;
  }
  if (p.perMillionOutput && args.outputTokens) {
    cost += (args.outputTokens / 1_000_000) * p.perMillionOutput;
  }
  return Math.round(cost * 100_000) / 100_000;
}

export type VoiceCapState = {
  /** USD spent this period from `voice_usage`. */
  spentUsd: number;
  /** Effective cap (min of subscription tier cap and user-set cap). */
  capUsd: number;
  /** True when spend ≥ 80% of cap — caller should warn the user. */
  soft: boolean;
  /** True when spend ≥ 100% of cap — caller should refuse the call. */
  hard: boolean;
  /** When `unlimited_ai = true` on the workspace, both flags are false. */
  unlimited: boolean;
};

export async function getVoiceCapState(workspaceId: string): Promise<VoiceCapState> {
  const db = getDb();
  const [ws] = await db
    .select({
      cap: workspace.monthlyCostCapUsd,
      unlimited: workspace.unlimitedAi,
    })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);

  if (!ws) {
    return { spentUsd: 0, capUsd: 0, soft: false, hard: true, unlimited: false };
  }
  if (ws.unlimited) {
    return { spentUsd: 0, capUsd: 0, soft: false, hard: false, unlimited: true };
  }

  const [sub] = await db
    .select({
      tierCap: workspaceSubscription.monthlyVoiceUsdCap,
      periodStart: workspaceSubscription.currentPeriodStart,
    })
    .from(workspaceSubscription)
    .where(eq(workspaceSubscription.workspaceId, workspaceId))
    .limit(1);

  // Tier cap defaults to 0 when no subscription row exists (free, no Stripe).
  const tierCapNum = sub ? Number(sub.tierCap) : 0;
  const userCapNum = ws.cap ? Number(ws.cap) : Infinity;
  const capUsd = Math.min(tierCapNum, userCapNum);

  // If neither tier nor user set a cap, treat as unlimited.
  if (!isFinite(capUsd) || capUsd <= 0) {
    if (tierCapNum === 0 && !ws.cap) {
      return { spentUsd: 0, capUsd: 0, soft: false, hard: false, unlimited: true };
    }
  }

  const periodStart = sub?.periodStart ?? new Date(0);
  const totals = await db
    .select({
      total: sql<string>`COALESCE(SUM(${voiceUsage.costUsd}), 0)::text`,
    })
    .from(voiceUsage)
    .where(and(eq(voiceUsage.workspaceId, workspaceId), gte(voiceUsage.createdAt, periodStart)));
  const spentUsd = Number(totals[0]?.total ?? '0');

  return {
    spentUsd,
    capUsd,
    soft: capUsd > 0 && spentUsd >= capUsd * 0.8,
    hard: capUsd > 0 && spentUsd >= capUsd,
    unlimited: false,
  };
}

export async function assertVoiceCap(
  workspaceId: string,
): Promise<{ ok: true; state: VoiceCapState } | { ok: false; state: VoiceCapState }> {
  const state = await getVoiceCapState(workspaceId);
  if (state.hard) return { ok: false, state };
  return { ok: true, state };
}

export async function recordVoiceUsage(args: {
  workspaceId: string;
  userId: string;
  personaSlug?: string | null;
  lane: VoiceLane;
  provider: VoiceProvider;
  seconds?: number;
  inputTokens?: number;
  outputTokens?: number;
  /** When true, cost is recorded as 0 since the user is paying the provider directly. */
  byok?: boolean;
}): Promise<void> {
  const db = getDb();
  const cost = args.byok
    ? 0
    : estimateCostUsd(args.provider, {
        seconds: args.seconds,
        inputTokens: args.inputTokens,
        outputTokens: args.outputTokens,
      });
  await db
    .insert(voiceUsage)
    .values({
      workspaceId: args.workspaceId,
      userId: args.userId,
      personaSlug: args.personaSlug ?? null,
      lane: args.lane,
      provider: args.provider,
      seconds: args.seconds ?? null,
      inputTokens: args.inputTokens ?? null,
      outputTokens: args.outputTokens ?? null,
      costUsd: cost.toFixed(5),
    })
    .catch(() => {
      // Metering must never fail the user-visible request.
    });
}

// `subscriptionTier` re-exported only to keep the type used by API consumers.
export type { subscriptionTier };

/**
 * Resolve the workspace's effective billing tier for voice routing —
 * 'free' when there is no subscription row.
 */
export async function getWorkspaceBillingTier(
  workspaceId: string,
): Promise<'free' | 'starter' | 'pro' | 'pro_plus' | 'enterprise'> {
  const db = getDb();
  const [sub] = await db
    .select({ tier: workspaceSubscription.tier })
    .from(workspaceSubscription)
    .where(eq(workspaceSubscription.workspaceId, workspaceId))
    .limit(1);
  return (
    (sub?.tier as 'free' | 'starter' | 'pro' | 'pro_plus' | 'enterprise' | undefined) ?? 'free'
  );
}

/**
 * POST /api/voice/tts/speak
 *
 * Server-side proxy that streams TTS audio to the client without ever
 * exposing the Cartesia / ElevenLabs API key. The client sends
 * `{personaSlug, text}`; we look up the persona, open the matching
 * provider's BYOK, and pipe the streamed audio back as
 * `audio/mpeg` (or whatever the provider returned).
 *
 * Why: keeping all third-party voice keys server-side preserves the
 * "client never sees raw provider tokens" invariant established in slice 4.
 */
import { z } from 'zod';
import { auth } from '@metu/auth';
import { rateLimit } from '@/lib/ratelimit';
import { getBuiltInPersona } from '@metu/presence';
import { requireVoiceProviderKey } from '@/lib/voice-keys';

export const runtime = 'nodejs';

const Body = z.object({
  personaSlug: z.string().min(1).max(80),
  text: z.string().min(1).max(4_000),
});

const TEXT_BUDGET = 4_000;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.workspaceId || !session.user.id) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthenticated' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }
  const { workspaceId, id: userId } = session.user;

  // Cheap protection — TTS is paid per character.
  const limited = await rateLimit('voice-realtime', userId);
  if (limited) return limited;

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  }

  const persona = getBuiltInPersona(parsed.data.personaSlug);
  if (!persona) {
    return new Response(JSON.stringify({ ok: false, error: 'persona_not_found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  const text = parsed.data.text.slice(0, TEXT_BUDGET);

  if (persona.voiceProvider === 'cartesia-sonic-turbo') {
    return streamFromCartesia(workspaceId, persona.voiceId, text, persona.voiceTuning);
  }
  if (persona.voiceProvider === 'elevenlabs-flash') {
    return streamFromElevenLabs(workspaceId, persona.voiceId, text, persona.voiceTuning);
  }
  return new Response(
    JSON.stringify({
      ok: false,
      error: 'unsupported_tts_provider',
      provider: persona.voiceProvider,
    }),
    { status: 409, headers: { 'content-type': 'application/json' } },
  );
}

interface VoiceTuning {
  speed?: number;
  stability?: number;
  style?: number;
  pitch?: number;
}

async function streamFromCartesia(
  workspaceId: string,
  voiceId: string,
  text: string,
  tuning: VoiceTuning | undefined,
): Promise<Response> {
  const cred = await requireVoiceProviderKey(workspaceId, 'cartesia');
  if ('error' in cred) return providerError(cred.error, 'CARTESIA_API_KEY');

  const upstream = await fetch('https://api.cartesia.ai/tts/bytes', {
    method: 'POST',
    headers: {
      'X-API-Key': cred.key,
      'Cartesia-Version': '2024-06-10',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model_id: 'sonic-turbo',
      transcript: text,
      voice: { mode: 'id', id: voiceId || 'sonic-default' },
      output_format: { container: 'mp3', encoding: 'mp3', sample_rate: 24_000 },
      language: 'en',
      ...(tuning?.speed != null && {
        __experimental_controls: { speed: clamp(tuning.speed, 0.5, 1.5) },
      }),
    }),
  });
  return relay(upstream, 'audio/mpeg');
}

async function streamFromElevenLabs(
  workspaceId: string,
  voiceId: string,
  text: string,
  tuning: VoiceTuning | undefined,
): Promise<Response> {
  const cred = await requireVoiceProviderKey(workspaceId, 'elevenlabs');
  if ('error' in cred) return providerError(cred.error, 'ELEVENLABS_API_KEY');

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
    voiceId || 'EXAVITQu4vr4xnSDxMaL',
  )}/stream?optimize_streaming_latency=3&output_format=mp3_22050_32`;
  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': cred.key,
      'content-type': 'application/json',
      accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_flash_v2_5',
      voice_settings: {
        stability: clamp(tuning?.stability ?? 0.5, 0, 1),
        similarity_boost: 0.7,
        style: clamp(tuning?.style ?? 0, 0, 1),
        use_speaker_boost: true,
      },
    }),
  });
  return relay(upstream, 'audio/mpeg');
}

function relay(upstream: Response, fallbackContentType: string): Response {
  if (!upstream.ok || !upstream.body) {
    return new Response(
      JSON.stringify({ ok: false, error: 'tts_upstream_error', status: upstream.status }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    );
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? fallbackContentType,
      'cache-control': 'no-store',
    },
  });
}

function providerError(error: string, envName: string): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error,
      hint: `Set ${envName} (BYOK voice keys: slice 10).`,
    }),
    { status: 412, headers: { 'content-type': 'application/json' } },
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

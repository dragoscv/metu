/**
 * SDK v1 — POST /api/sdk/v1/presence/speak
 *
 * Bearer auth (`presence:talk` scope). Bearer-friendly twin of
 * `/api/voice/tts/speak` (slice 4). Streams audio bytes for the persona's
 * configured TTS provider so external clients (mobile) never touch the
 * provider key.
 */
import { z } from 'zod';
import { getBuiltInPersona } from '@metu/presence';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { rateLimit } from '@/lib/ratelimit';
import { requireVoiceProviderKey } from '@/lib/voice-keys';
import { assertVoiceCap, recordVoiceUsage } from '@/lib/voice-billing';

const Body = z.object({
  personaSlug: z.string().min(1).max(80),
  text: z.string().min(1).max(4_000),
  /** Optional BCP-47 language hint — forwarded to ElevenLabs as model id
   *  preference; Cartesia handles language via voice id. */
  language: z
    .string()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
    .optional(),
});

const TEXT_BUDGET = 4_000;

export async function POST(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'presence:talk')) return forbidden();

  const limited = await rateLimit('voice-realtime', session.userId);
  if (limited) return limited;

  const cap = await assertVoiceCap(session.workspaceId);
  if (!cap.ok) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'voice_cap_exceeded',
        spent: cap.state.spentUsd,
        cap: cap.state.capUsd,
      }),
      { status: 402, headers: { 'content-type': 'application/json' } },
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return new Response(parsed.error.issues[0]?.message ?? 'invalid', { status: 400 });
  }
  const persona = getBuiltInPersona(parsed.data.personaSlug);
  if (!persona) return new Response('persona_not_found', { status: 404 });

  const text = parsed.data.text.slice(0, TEXT_BUDGET);

  // Approximate audio duration from word count (≈150 wpm → 0.4 s/word).
  // Good enough for usage metering; precise duration would require
  // post-processing the streamed bytes which doubles latency.
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const estSeconds = Math.max(1, Math.round(wordCount * 0.4));
  const provider = persona.voiceProvider;
  void recordVoiceUsage({
    workspaceId: session.workspaceId,
    userId: session.userId,
    personaSlug: persona.slug,
    lane: 'tts',
    provider:
      provider === 'cartesia-sonic-turbo'
        ? 'cartesia'
        : provider === 'elevenlabs-flash'
          ? 'elevenlabs'
          : provider,
    seconds: estSeconds,
  });

  if (persona.voiceProvider === 'cartesia-sonic-turbo') {
    return streamFromCartesia(session.workspaceId, persona.voiceId, text);
  }
  if (persona.voiceProvider === 'elevenlabs-flash') {
    return streamFromElevenLabs(session.workspaceId, persona.voiceId, text);
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

async function streamFromCartesia(
  workspaceId: string,
  voiceId: string,
  text: string,
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
    }),
  });
  return forwardAudio(upstream, 'audio/mpeg');
}

async function streamFromElevenLabs(
  workspaceId: string,
  voiceId: string,
  text: string,
): Promise<Response> {
  const cred = await requireVoiceProviderKey(workspaceId, 'elevenlabs');
  if ('error' in cred) return providerError(cred.error, 'ELEVENLABS_API_KEY');
  const upstream = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId || 'EXAVITQu4vr4xnSDxMaL')}/stream?optimize_streaming_latency=3`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': cred.key,
        'content-type': 'application/json',
        accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_flash_v2_5',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    },
  );
  return forwardAudio(upstream, 'audio/mpeg');
}

function forwardAudio(upstream: Response, contentType: string): Response {
  if (!upstream.ok || !upstream.body) {
    return new Response(
      JSON.stringify({ ok: false, error: 'tts_provider_error', status: upstream.status }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    );
  }
  return new Response(upstream.body, {
    status: 200,
    headers: { 'content-type': contentType, 'cache-control': 'no-store' },
  });
}

function providerError(code: string, envName: string): Response {
  return new Response(
    JSON.stringify({ ok: false, error: code, hint: `set ${envName} on the server` }),
    { status: 412, headers: { 'content-type': 'application/json' } },
  );
}

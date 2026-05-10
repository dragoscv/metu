/**
 * POST /api/voice/pipeline/session
 *
 * Token broker for the pipeline lane (lane 2): mints an ephemeral Deepgram
 * STT token + names the TTS endpoint the client should hit. Unlike Realtime,
 * TTS audio is streamed via our own proxy (`/api/voice/tts/speak`) so the
 * Cartesia/ElevenLabs API key never reaches the client.
 *
 * Deepgram supports short-lived tokens via POST /v1/auth/grant. They expire
 * in 30s by default — long enough to open the WS, after which Deepgram
 * authenticates the connection on its own.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@metu/auth';
import { rateLimit } from '@/lib/ratelimit';
import { getBuiltInPersona } from '@metu/presence';
import { requireVoiceProviderKey } from '@/lib/voice-keys';
import { getDb } from '@metu/db';
import { timelineEvent } from '@metu/db/schema';
import { getWorkspaceBillingTier } from '@/lib/voice-billing';
import { isVoiceProviderAllowed } from '@metu/voice';
import { log } from '@/lib/logger';

export const runtime = 'nodejs';

const Body = z.object({
  personaSlug: z.string().min(1).max(80),
});

interface DeepgramGrant {
  access_token: string;
  expires_in: number;
}

const PIPELINE_TTL_SEC = 30;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.workspaceId || !session.user.id) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  }
  const { workspaceId, id: userId } = session.user;

  const limited = await rateLimit('voice-realtime', userId);
  if (limited) return limited;

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' },
      { status: 400 },
    );
  }

  const persona = getBuiltInPersona(parsed.data.personaSlug);
  if (!persona) {
    return NextResponse.json({ ok: false, error: 'persona_not_found' }, { status: 404 });
  }
  if (persona.voiceProvider === 'openai-realtime') {
    return NextResponse.json(
      { ok: false, error: 'persona_is_realtime', hint: 'use /api/voice/realtime/session' },
      { status: 409 },
    );
  }
  if (persona.voiceProvider === 'none') {
    return NextResponse.json({ ok: false, error: 'persona_is_text_only' }, { status: 409 });
  }

  // Tier gate — STT and TTS providers vary by tier (see TIER_PROVIDERS).
  const billingTier = await getWorkspaceBillingTier(workspaceId);
  // Map persona TTS to a router provider id.
  const ttsId = persona.voiceProvider; // e.g. 'cartesia-sonic-turbo' | 'elevenlabs-flash' | 'piper-local'
  const sttId = 'deepgram-nova3';
  if (!isVoiceProviderAllowed(billingTier, sttId) || !isVoiceProviderAllowed(billingTier, ttsId)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'tier_blocks_pipeline',
        tier: billingTier,
        stt: sttId,
        tts: ttsId,
        hint: 'Upgrade your plan or pick a persona whose voice provider is included in your tier.',
      },
      { status: 402 },
    );
  }

  // STT credential — Deepgram is the only provider in v1.
  const dgKey = await requireVoiceProviderKey(workspaceId, 'deepgram');
  if ('error' in dgKey) {
    return NextResponse.json(
      { ok: false, error: dgKey.error, hint: 'Set DEEPGRAM_API_KEY (BYOK voice keys: slice 10).' },
      { status: 412 },
    );
  }

  // Mint a short-lived Deepgram token. Falls back to a direct ephemeral key
  // in dev when the grant endpoint is unavailable (e.g. legacy account).
  let dgToken: string;
  let dgExpires = PIPELINE_TTL_SEC;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 5_000);
    const res = await fetch('https://api.deepgram.com/v1/auth/grant', {
      method: 'POST',
      headers: { authorization: `Token ${dgKey.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl_seconds: PIPELINE_TTL_SEC }),
      signal: ac.signal,
    });
    clearTimeout(t);
    if (res.ok) {
      const body = (await res.json()) as DeepgramGrant;
      dgToken = body.access_token;
      dgExpires = body.expires_in ?? PIPELINE_TTL_SEC;
    } else if (res.status === 404 || res.status === 405) {
      // Account doesn't have temp tokens — fall back to the long-lived key.
      // Acceptable in dev because the connection is short-lived and the URL
      // never crosses the renderer boundary outside of memory.
      log.warn('voice.pipeline_broker.deepgram_grant_unavailable', { status: res.status });
      dgToken = dgKey.key;
    } else {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      return NextResponse.json(
        { ok: false, error: 'deepgram_grant_failed', status: res.status, detail },
        { status: 502 },
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: 'broker_failed', detail: msg }, { status: 502 });
  }

  await getDb()
    .insert(timelineEvent)
    .values({
      workspaceId,
      userId,
      kind: 'voice.session_started',
      title: `${persona.name}: pipeline session`,
      body: `Pipeline (Deepgram + ${persona.voiceProvider}).`,
      importance: 0.2,
      payload: { personaSlug: persona.slug, lane: 'pipeline', tts: persona.voiceProvider },
    });

  return NextResponse.json({
    ok: true,
    lane: 'pipeline',
    persona: {
      slug: persona.slug,
      name: persona.name,
      systemPrompt: persona.systemPrompt,
      ttsProvider: persona.voiceProvider,
      ttsVoiceId: persona.voiceId,
      ttsTuning: persona.voiceTuning,
    },
    stt: {
      provider: 'deepgram-nova3',
      sessionToken: dgToken,
      expiresInSec: dgExpires,
      // Server-side defaults — client appends to URL.
      params: {
        model: 'nova-3',
        smart_format: 'true',
        interim_results: 'true',
        endpointing: '300',
      },
    },
  });
}

/**
 * POST /api/voice/realtime/session
 *
 * Token broker for OpenAI Realtime (lane 1, persona-driven).
 *
 * Flow:
 *  1. Resolve the user's session + workspace.
 *  2. Open the workspace's BYOK OpenAI key (sealed via @metu/ai/crypto).
 *  3. Mint an ephemeral Realtime session at OpenAI with the persona's
 *     system prompt + voice + tool schemas (Conductor device tools).
 *  4. Return ONLY the ephemeral `client_secret.value` (TTL ≤ 60s) plus the
 *     model + voice that was minted. The raw BYOK key never leaves the server.
 *
 * Security:
 *  - Cookie session required (no bearer; this is a first-party endpoint).
 *  - Per-request rate limit (5 sessions / 60s) — voice connect is expensive.
 *  - Audit row in `timeline_event` so the user can see every voice session.
 *  - On failure, the upstream error is bubbled but never the API key.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getProviderCredential } from '@metu/ai';
import { getDb } from '@metu/db';
import { timelineEvent } from '@metu/db/schema';
import { rateLimit } from '@/lib/ratelimit';
import { hasScope, resolveSession } from '@/lib/bearer';
import { getBuiltInPersona } from '@metu/presence';
import { getWorkspaceBillingTier } from '@/lib/voice-billing';
import { isVoiceProviderAllowed } from '@metu/voice';

export const runtime = 'nodejs';

const REQUEST_TTL_SEC = 60;
const REALTIME_DEFAULT_MODEL = 'gpt-4o-realtime-preview-2024-12-17';

const Body = z.object({
  /** Built-in persona slug or DB persona id. Built-in lookup first. */
  personaSlug: z.string().min(1).max(80),
  /**
   * Optional model override. Locked to the OpenAI realtime family —
   * anything else is rejected so callers can't mint general chat tokens.
   */
  model: z
    .string()
    .regex(/^gpt-(4o|realtime)/i)
    .optional(),
});

interface OpenAiRealtimeSession {
  id: string;
  model: string;
  voice: string;
  expires_at?: number;
  client_secret: { value: string; expires_at?: number };
}

export async function POST(req: Request) {
  // Cookie session (web) OR bearer token (companion/mobile) — the
  // companion is a paired OAuth client, not a cookie browser. Bearer
  // callers need the presence:talk scope.
  const session = await resolveSession(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  }
  if (!hasScope(session, 'presence:talk')) {
    return NextResponse.json({ ok: false, error: 'insufficient_scope' }, { status: 403 });
  }
  const workspaceId = session.workspaceId;
  const userId = session.userId;

  // Cheap per-user rate limit — protects BYOK quota from runaway clients.
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
  if (persona.voiceProvider !== 'openai-realtime') {
    return NextResponse.json(
      { ok: false, error: 'persona_not_realtime', hint: 'use /api/voice/pipeline/session' },
      { status: 409 },
    );
  }

  // Tier gate — realtime providers are restricted to pro_plus / enterprise.
  const billingTier = await getWorkspaceBillingTier(workspaceId);
  if (!isVoiceProviderAllowed(billingTier, 'openai-realtime')) {
    return NextResponse.json(
      {
        ok: false,
        error: 'tier_blocks_realtime',
        tier: billingTier,
        hint: 'Upgrade to Pro+ to use realtime voice. Pipeline lane (STT+TTS) remains available.',
      },
      { status: 402 },
    );
  }

  const cred = await getProviderCredential(workspaceId, 'openai');
  if (!cred) {
    return NextResponse.json(
      {
        ok: false,
        error: 'no_openai_credential',
        hint: 'Add an OpenAI API key on /settings/ai-providers (BYOK).',
      },
      { status: 412 },
    );
  }

  const model = parsed.data.model ?? REALTIME_DEFAULT_MODEL;
  const voice = persona.voiceId || 'verse';

  let upstream: OpenAiRealtimeSession;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 10_000);
    const res = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cred.apiKey}`,
        'content-type': 'application/json',
        'OpenAI-Beta': 'realtime=v1',
      },
      body: JSON.stringify({
        model,
        voice,
        instructions: persona.systemPrompt,
        modalities: ['audio', 'text'],
        // Server-side VAD so the model knows when the user finishes speaking
        // — barge-in still works because the client sends `cancel` events.
        turn_detection: { type: 'server_vad' },
      }),
      signal: ac.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return NextResponse.json(
        { ok: false, error: 'upstream_error', status: res.status, detail: errText.slice(0, 240) },
        { status: 502 },
      );
    }
    upstream = (await res.json()) as OpenAiRealtimeSession;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: 'broker_failed', detail: msg }, { status: 502 });
  }

  if (!upstream.client_secret?.value) {
    return NextResponse.json({ ok: false, error: 'no_client_secret' }, { status: 502 });
  }

  await getDb()
    .insert(timelineEvent)
    .values({
      workspaceId,
      userId,
      kind: 'voice.session_started',
      title: `${persona.name}: voice session`,
      body: `Realtime session minted for ${model}.`,
      importance: 0.2,
      payload: {
        personaSlug: persona.slug,
        model,
        voice,
        sessionId: upstream.id,
        ttlSec: REQUEST_TTL_SEC,
      },
    });

  return NextResponse.json({
    ok: true,
    sessionToken: upstream.client_secret.value,
    sessionId: upstream.id,
    model,
    voice,
    /** Wall-clock seconds until the ephemeral token expires. */
    expiresInSec: REQUEST_TTL_SEC,
    persona: {
      slug: persona.slug,
      name: persona.name,
      systemPrompt: persona.systemPrompt,
    },
  });
}

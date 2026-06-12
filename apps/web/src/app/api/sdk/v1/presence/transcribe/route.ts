/**
 * SDK v1 — POST /api/sdk/v1/presence/transcribe
 *
 * Bearer auth (`presence:talk` scope). Accepts a `multipart/form-data` body
 * with an `audio` file field, forwards the bytes to Deepgram for STT, and
 * returns `{ text, durationMs }`. Mobile (and any external client) uses
 * this so it never holds the Deepgram key.
 *
 * Why a separate route vs. reusing `/api/voice/pipeline/respond`: that
 * endpoint is session-cookie-only and JSON-only. Mobile needs bearer +
 * multipart upload so the recorded `m4a` / `webm` chunk goes straight to
 * the provider.
 */
import { NextResponse } from 'next/server';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { rateLimit } from '@/lib/ratelimit';
import { requireVoiceProviderKey } from '@/lib/voice-keys';
import { assertVoiceCap, recordVoiceUsage } from '@/lib/voice-billing';
import { getWorkspacePreferences } from '@/app/actions/workspace-preferences';

export const maxDuration = 30;

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB hard cap — single utterance.

export async function POST(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'presence:talk')) return forbidden();

  const limited = await rateLimit('voice-realtime', session.userId);
  if (limited) return limited;

  // Cap check before consuming the upstream quota.
  const cap = await assertVoiceCap(session.workspaceId);
  if (!cap.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: 'voice_cap_exceeded',
        spent: cap.state.spentUsd,
        cap: cap.state.capUsd,
      },
      { status: 402 },
    );
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get('audio');
  if (!(file instanceof Blob)) {
    return NextResponse.json({ ok: false, error: 'missing_audio' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: 'audio_too_large', max: MAX_BYTES },
      { status: 413 },
    );
  }
  // Optional BCP-47 language hint from the client — lets Deepgram pick
  // the right model/decoder for non-English personas (e.g. Dorel → 'ro').
  // Fallback chain: form field → workspace preferred language → none.
  const langField = form?.get('language');
  const formLang =
    typeof langField === 'string' && /^[a-z]{2}(-[A-Z]{2})?$/.test(langField) ? langField : null;
  let language = formLang;
  if (!language) {
    const prefs = await getWorkspacePreferences();
    if (prefs.preferredLanguage) language = prefs.preferredLanguage;
  }
  const cred = await requireVoiceProviderKey(session.workspaceId, 'deepgram');
  if ('error' in cred) {
    return NextResponse.json(
      { ok: false, error: cred.error, provider: cred.provider },
      { status: 412 },
    );
  }

  const upstreamUrl = new URL('https://api.deepgram.com/v1/listen');
  upstreamUrl.searchParams.set('model', 'nova-3');
  upstreamUrl.searchParams.set('smart_format', 'true');
  upstreamUrl.searchParams.set('punctuate', 'true');
  if (language) upstreamUrl.searchParams.set('language', language);
  const upstream = await fetch(upstreamUrl, {
    method: 'POST',
    headers: {
      Authorization: `Token ${cred.key}`,
      'content-type': file.type || 'audio/webm',
    },
    body: file.stream(),
    // @ts-expect-error duplex required when body is a stream
    duplex: 'half',
  });
  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    return NextResponse.json(
      {
        ok: false,
        error: 'stt_provider_error',
        status: upstream.status,
        detail: detail.slice(0, 500),
      },
      { status: 502 },
    );
  }
  const json = (await upstream.json()) as {
    results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
    metadata?: { duration?: number };
  };
  const text = json.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? '';
  const durationMs = Math.round((json.metadata?.duration ?? 0) * 1000);
  void recordVoiceUsage({
    workspaceId: session.workspaceId,
    userId: session.userId,
    lane: 'stt',
    provider: 'deepgram',
    seconds: Math.round(durationMs / 1000),
  });
  return NextResponse.json({
    ok: true,
    text,
    durationMs,
    capWarn: cap.state.soft,
  });
}

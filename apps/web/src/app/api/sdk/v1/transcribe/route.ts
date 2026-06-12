/**
 * SDK v1 — POST /api/sdk/v1/transcribe
 *
 * Bearer auth (`capture:write` scope). Synchronous transcription helper
 * for clients that have already uploaded an audio blob to GCS (via
 * `/api/upload/sign`) and want the transcript back without persisting
 * a `capture` row. Mobile + companion use this for "preview before
 * capture" flows.
 *
 * Body: { storageKey: string, languageHint?: string }
 * Response: { ok: true, transcript: string, durationMs: number, modelId: string }
 *
 * Heavy lifting is delegated to the Cloud Run worker at $WORKER_URL/transcribe.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { rateLimit } from '@/lib/ratelimit';

export const maxDuration = 120;

const BodySchema = z.object({
  storageKey: z.string().min(1).max(512),
  languageHint: z
    .string()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
    .optional(),
});

export async function POST(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'capture:write')) return forbidden();

  const limited = await rateLimit('sdk-write', session.userId);
  if (limited) return limited;

  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' },
      { status: 400 },
    );
  }

  const workerUrl = process.env.WORKER_URL;
  if (!workerUrl) {
    return NextResponse.json({ ok: false, error: 'WORKER_URL not configured' }, { status: 503 });
  }

  const started = Date.now();
  const res = await fetch(`${workerUrl.replace(/\/$/, '')}/transcribe`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(process.env.WORKER_AUTH_TOKEN
        ? { authorization: `Bearer ${process.env.WORKER_AUTH_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      storageKey: parsed.data.storageKey,
      languageHint: parsed.data.languageHint ?? null,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return NextResponse.json(
      { ok: false, error: `worker ${res.status}: ${detail.slice(0, 200)}` },
      { status: 502 },
    );
  }
  const out = (await res.json()) as { transcript?: string; modelId?: string };
  return NextResponse.json({
    ok: true,
    transcript: out.transcript ?? '',
    modelId: out.modelId ?? 'unknown',
    durationMs: Date.now() - started,
  });
}

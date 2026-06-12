/**
 * SDK v1 — POST /api/sdk/v1/companion/image
 *
 * Image generation for the companion (Jarvis v4): "draw …" / "imagine …"
 * routes here. Uses the workspace's codai credential against the
 * OpenAI-compatible /images/generations endpoint on the codai gateway.
 * Returns a data URI (b64) so the companion renders it inline as an
 * image card without any storage round-trip; persisting to GCS is a
 * future slice if galleries are wanted.
 *
 * Scope: presence:talk (same lane as skills) + voice cap + rate limit.
 */
import { z } from 'zod';
import { type NextRequest, NextResponse } from 'next/server';
import { getProviderCredential, CODAI_BASE_URL } from '@metu/ai';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { rateLimit } from '@/lib/ratelimit';
import { assertVoiceCap } from '@/lib/voice-billing';

export const maxDuration = 60;

const Body = z.object({
  prompt: z.string().min(3).max(1_000),
  size: z.enum(['1024x1024', '1024x1536', '1536x1024']).default('1024x1024'),
});

export async function POST(req: NextRequest) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'presence:talk')) return forbidden();

  const limited = await rateLimit('companion-skill', session.userId);
  if (limited) return limited;

  const cap = await assertVoiceCap(session.workspaceId);
  if (!cap.ok) {
    return NextResponse.json({ ok: false, error: 'budget_reached' }, { status: 402 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400 });
  }

  const cred = await getProviderCredential(session.workspaceId, 'codai');
  if (!cred) {
    return NextResponse.json(
      { ok: false, error: 'no_codai_credential', message: 'Add a codai key in Settings → AI.' },
      { status: 409 },
    );
  }

  const base = (cred.endpoint ?? CODAI_BASE_URL).replace(/\/+$/, '');
  const upstream = await fetch(`${base}/images/generations`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${cred.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      prompt: parsed.data.prompt,
      n: 1,
      size: parsed.data.size,
      response_format: 'b64_json',
    }),
  }).catch(() => null);

  if (!upstream || !upstream.ok) {
    const detail = upstream ? await upstream.text().catch(() => '') : 'fetch_failed';
    return NextResponse.json(
      { ok: false, error: 'generation_failed', detail: detail.slice(0, 300) },
      { status: 502 },
    );
  }

  const json = (await upstream.json().catch(() => null)) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  } | null;
  const first = json?.data?.[0];
  if (first?.b64_json) {
    return NextResponse.json({ ok: true, dataUri: `data:image/png;base64,${first.b64_json}` });
  }
  if (first?.url) {
    return NextResponse.json({ ok: true, url: first.url });
  }
  return NextResponse.json({ ok: false, error: 'empty_response' }, { status: 502 });
}

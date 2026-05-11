/**
 * SDK v1 — POST /api/sdk/v1/recall
 * Bearer auth (`recall:read` scope).
 */
import { NextResponse } from 'next/server';
import { RecallQuerySchema } from '@metu/protocol';
import { memory } from '@metu/core';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'recall:read')) return forbidden();

  const limited = await rateLimit('sdk-write', session.userId);
  if (limited) return limited;

  const json = await req.json().catch(() => null);
  const parsed = RecallQuerySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' },
      { status: 400 },
    );
  }

  const result = await memory.recall({
    workspaceId: session.workspaceId,
    query: parsed.data.query,
    projectId: parsed.data.projectId,
    kinds: parsed.data.kinds,
    since: parsed.data.timeRange?.from ? new Date(parsed.data.timeRange.from) : null,
    until: parsed.data.timeRange?.to ? new Date(parsed.data.timeRange.to) : null,
    mode: parsed.data.mode,
    minScore: parsed.data.minScore,
    limit: parsed.data.k,
  });
  const rows =
    ((result as { rows?: unknown[] }).rows as Array<{
      id: string;
      content: string;
      similarity: number;
    }>) ??
    (result as unknown as Array<{
      id: string;
      content: string;
      similarity: number;
    }>);

  return NextResponse.json(
    (rows ?? []).map((h) => ({
      id: h.id,
      content: h.content,
      score: h.similarity,
    })),
  );
}

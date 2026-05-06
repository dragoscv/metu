/**
 * SDK v1 — POST /api/sdk/v1/recall
 * Bearer auth (`recall:read` scope).
 */
import { NextResponse } from 'next/server';
import { RecallQuerySchema } from '@metu/protocol';
import { memory } from '@metu/core';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'recall:read')) return forbidden();

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

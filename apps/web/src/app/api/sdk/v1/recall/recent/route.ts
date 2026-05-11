/**
 * SDK v1 — GET /api/sdk/v1/recall/recent
 *
 * Bearer auth (`recall:read` scope). Returns the workspace's recent
 * recall queries (kind='memory.recall' timeline events) so clients can
 * show a "you searched for…" history dropdown / quick-replay UI.
 */
import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { timelineEvent } from '@metu/db/schema';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { trace } from '@/lib/request-id';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await resolveSession(req);
  if (!session) return trace(req, unauthorized());
  if (!hasScope(session, 'recall:read')) return trace(req, forbidden());

  const url = new URL(req.url);
  const limitParam = Number.parseInt(url.searchParams.get('limit') ?? '20', 10);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 20;

  const db = getDb();
  const rows = await db
    .select({
      id: timelineEvent.id,
      title: timelineEvent.title,
      body: timelineEvent.body,
      payload: timelineEvent.payload,
      projectId: timelineEvent.projectId,
      occurredAt: timelineEvent.occurredAt,
    })
    .from(timelineEvent)
    .where(
      and(
        eq(timelineEvent.workspaceId, session.workspaceId),
        eq(timelineEvent.kind, 'memory.recall'),
      ),
    )
    .orderBy(desc(timelineEvent.occurredAt))
    .limit(limit);

  return trace(
    req,
    NextResponse.json({
      ok: true,
      items: rows.map((r) => ({
        id: r.id,
        query: r.title,
        summary: r.body,
        projectId: r.projectId,
        occurredAt: r.occurredAt.toISOString(),
        mode: (r.payload as { mode?: string } | null)?.mode ?? 'hybrid',
        hitCount: (r.payload as { hitCount?: number } | null)?.hitCount ?? 0,
      })),
    }),
  );
}

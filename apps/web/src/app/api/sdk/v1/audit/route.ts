/**
 * SDK v1 — GET /api/sdk/v1/audit
 *
 * Bearer auth (`audit:read` scope). Paginated workspace audit feed. Use
 * for an external dashboard or a mobile "what happened today" widget.
 *
 * Query params:
 *   - limit:  1..200 (default 50)
 *   - since:  ISO timestamp (events occurredAt > since); default 7d ago
 *   - kind:   optional exact match on `timeline_event.kind`
 *
 * Response: { ok: true, events: [{id, kind, title, body, importance, occurredAt}] }
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq, gt, desc } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { timelineEvent } from '@metu/db/schema';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  since: z.string().datetime().optional(),
  kind: z.string().min(1).max(80).optional(),
});

export async function GET(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'audit:read')) return forbidden();

  const limited = await rateLimit('sdk-read', session.userId);
  if (limited) return limited;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' },
      { status: 400 },
    );
  }
  const since = parsed.data.since
    ? new Date(parsed.data.since)
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const conds = [
    eq(timelineEvent.workspaceId, session.workspaceId),
    gt(timelineEvent.occurredAt, since),
  ];
  if (parsed.data.kind) conds.push(eq(timelineEvent.kind, parsed.data.kind));

  const db = getDb();
  const rows = await db
    .select({
      id: timelineEvent.id,
      kind: timelineEvent.kind,
      title: timelineEvent.title,
      body: timelineEvent.body,
      importance: timelineEvent.importance,
      occurredAt: timelineEvent.occurredAt,
    })
    .from(timelineEvent)
    .where(and(...conds))
    .orderBy(desc(timelineEvent.occurredAt))
    .limit(parsed.data.limit);

  return NextResponse.json({ ok: true, events: rows });
}

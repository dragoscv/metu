/**
 * SDK v1 — GET /api/sdk/v1/timeline
 *
 * Bearer auth (`event:read` scope). Returns recent timeline_event rows
 * for the caller's workspace, with the same filters the `/timeline`
 * page exposes (kind, project, since, search) and a stable keyset
 * cursor for pagination.
 *
 * The companion / external dashboards use this to render "what
 * happened today" surfaces without scraping the web UI.
 *
 * Query params:
 *   - kind:    repeat to filter by multiple kinds (`?kind=capture&kind=reflection`)
 *   - project: project id
 *   - since:   `Nd` (default 7d, capped 1..365)
 *   - q:       case-insensitive substring match on title + body
 *   - limit:   1..100 (default 40)
 *   - cursor:  base64url(`{occurredAt}|{id}`) returned from the previous page
 */
import { NextResponse } from 'next/server';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { listTimelineFiltered } from '@metu/db/queries';

export const runtime = 'nodejs';

const DEFAULT_SINCE_DAYS = 7;
const MAX_SINCE_DAYS = 365;
const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;

function parseSince(raw: string | null): { since: Date; days: number } {
  const m = raw?.match(/^(\d+)d$/);
  const requested = m ? Number(m[1]) : DEFAULT_SINCE_DAYS;
  const days = Math.min(Math.max(requested, 1), MAX_SINCE_DAYS);
  return { since: new Date(Date.now() - days * 24 * 60 * 60 * 1000), days };
}

function parseLimit(raw: string | null): number {
  const n = raw ? Number(raw) : DEFAULT_LIMIT;
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(n), 1), MAX_LIMIT);
}

function decodeCursor(raw: string | null): { occurredAt: Date; id: string } | null {
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const [occurredAt, id] = decoded.split('|');
    if (!occurredAt || !id) return null;
    const d = new Date(occurredAt);
    if (Number.isNaN(d.getTime())) return null;
    return { occurredAt: d, id };
  } catch {
    return null;
  }
}

function encodeCursor(c: { occurredAt: string; id: string } | null): string | null {
  if (!c) return null;
  return Buffer.from(`${c.occurredAt}|${c.id}`, 'utf8').toString('base64url');
}

export async function GET(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'event:read')) return forbidden();

  const url = new URL(req.url);
  const kinds = url.searchParams.getAll('kind').filter(Boolean);
  const projectId = url.searchParams.get('project');
  const search = url.searchParams.get('q');
  const limit = parseLimit(url.searchParams.get('limit'));
  const { since, days } = parseSince(url.searchParams.get('since'));
  const cursor = decodeCursor(url.searchParams.get('cursor'));

  const { items, nextCursor } = await listTimelineFiltered({
    workspaceId: session.workspaceId,
    kinds: kinds.length > 0 ? kinds : undefined,
    projectId: projectId ?? undefined,
    since,
    search: search ?? undefined,
    cursor,
    limit,
  });

  return NextResponse.json(
    {
      ok: true,
      window: { sinceDays: days, sinceIso: since.toISOString() },
      items: items.map((e) => ({
        id: e.id,
        kind: e.kind,
        title: e.title,
        body: e.body,
        payload: e.payload,
        importance: e.importance,
        projectId: e.projectId,
        userId: e.userId,
        occurredAt: e.occurredAt.toISOString(),
      })),
      nextCursor: encodeCursor(nextCursor),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}

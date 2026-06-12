/**
 * GET /insights/export?format=csv|json&range=24h|7d|30d|90d
 *
 * Streams the same timeline_event rows that /insights renders, scoped to
 * the signed-in user's workspace. Filters mirror the page (kind,
 * importance, q, range). CSV uses RFC-4180 quoting.
 */
import { auth } from '@metu/auth';
import { and, desc, eq, gte, ilike, or, sql } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { timelineEvent } from '@metu/db/schema';

const RANGE_TO_MS: Record<string, number> = {
  '24h': 24 * 60 * 60_000,
  '7d': 7 * 24 * 60 * 60_000,
  '30d': 30 * 24 * 60 * 60_000,
  '90d': 90 * 24 * 60 * 60_000,
};

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session) return new Response('unauthorized', { status: 401 });
  const url = new URL(req.url);
  const format = url.searchParams.get('format') === 'json' ? 'json' : 'csv';
  const range = url.searchParams.get('range') ?? '7d';
  const since = new Date(Date.now() - (RANGE_TO_MS[range] ?? RANGE_TO_MS['7d']!));
  const kind = url.searchParams.get('kind') ?? '';
  const importance = url.searchParams.get('importance') ?? '';
  const q = (url.searchParams.get('q') ?? '').trim();

  const filters = [
    eq(timelineEvent.workspaceId, session.user.workspaceId),
    gte(timelineEvent.occurredAt, since),
  ];
  if (kind) filters.push(eq(timelineEvent.kind, kind));
  if (importance === 'high') filters.push(sql`${timelineEvent.importance} >= 0.7`);
  else if (importance === 'medium') filters.push(sql`${timelineEvent.importance} >= 0.5`);
  else if (importance === 'low') filters.push(sql`${timelineEvent.importance} < 0.5`);
  if (q) {
    filters.push(
      or(
        ilike(timelineEvent.title, `%${q}%`),
        ilike(timelineEvent.kind, `%${q}%`),
        ilike(timelineEvent.body, `%${q}%`),
      )!,
    );
  }

  const rows = await getDb()
    .select({
      id: timelineEvent.id,
      kind: timelineEvent.kind,
      title: timelineEvent.title,
      body: timelineEvent.body,
      importance: timelineEvent.importance,
      occurredAt: timelineEvent.occurredAt,
    })
    .from(timelineEvent)
    .where(and(...filters))
    .orderBy(desc(timelineEvent.occurredAt))
    .limit(10_000);

  const stamp = new Date().toISOString().slice(0, 10);

  if (format === 'json') {
    return new Response(
      JSON.stringify(
        { exportedAt: new Date().toISOString(), range, count: rows.length, rows },
        null,
        2,
      ),
      {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="insights-${stamp}.json"`,
        },
      },
    );
  }

  const header = ['occurredAt', 'kind', 'importance', 'title', 'body', 'id'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        new Date(r.occurredAt).toISOString(),
        r.kind,
        r.importance ?? '',
        csvEscape(r.title),
        csvEscape(r.body),
        r.id,
      ].join(','),
    );
  }
  return new Response(lines.join('\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="insights-${stamp}.csv"`,
    },
  });
}

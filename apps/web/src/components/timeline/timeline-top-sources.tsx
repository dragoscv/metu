/**
 * Top-N timeline kinds in the last 24h. Surfaces "what's been
 * generating noise today" so the user can spot anomalies (e.g.
 * 80 capture.classify in one day = something is misfiring).
 */
import Link from 'next/link';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { Card, CardTitle } from '@metu/ui';
import { Activity } from 'lucide-react';
import { getDb } from '@metu/db';
import { timelineEvent } from '@metu/db/schema';

export async function TimelineTopSources({ workspaceId }: { workspaceId: string }) {
  const db = getDb();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      kind: timelineEvent.kind,
      count: sql<number>`count(*)::int`,
    })
    .from(timelineEvent)
    .where(and(eq(timelineEvent.workspaceId, workspaceId), gte(timelineEvent.occurredAt, since)))
    .groupBy(timelineEvent.kind)
    .orderBy(desc(sql`count(*)`))
    .limit(6);

  if (rows.length === 0) return null;

  const total = rows.reduce(
    (s, r) => s + (typeof r.count === 'string' ? Number(r.count) : r.count),
    0,
  );

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[var(--color-brand)]" />
          <CardTitle>Top sources today</CardTitle>
        </div>
        <span className="text-xs text-[var(--color-fg-subtle)]">{total} events</span>
      </div>
      <ul className="mt-3 space-y-1.5 text-sm">
        {rows.map((r) => {
          const count = typeof r.count === 'string' ? Number(r.count) : r.count;
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          return (
            <li key={r.kind} className="flex items-center justify-between gap-3">
              <Link
                href={`/timeline?kinds=${encodeURIComponent(r.kind)}`}
                className="truncate font-mono text-xs hover:underline"
              >
                {r.kind}
              </Link>
              <span className="shrink-0 text-xs text-[var(--color-fg-subtle)]">
                {count} <span className="opacity-60">· {pct}%</span>
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/**
 * /insights — per-source activity timeline. Server component reading
 * `timeline_event` filtered by URL state (kind, importance, date range,
 * free-text). Aggregated by day to show the firehose at a glance.
 *
 * Filters live in the URL (nuqs) so deep-linking + back/forward work.
 */
import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { Card, EmptyState, Page, PageHeader, PageSection } from '@metu/ui';
import { Sparkles } from 'lucide-react';
import { getDb } from '@metu/db';
import { project, timelineEvent } from '@metu/db/schema';
import { and, asc, desc, eq, gte, ilike, isNull, or, sql } from 'drizzle-orm';
import { InsightsFilters } from '@/components/insights/insights-filters';
import { InsightsSidebar } from '@/components/insights/insights-sidebar';
import { InsightsExportButtons } from '@/components/insights/insights-export-buttons';

const RANGE_TO_MS: Record<string, number> = {
  '24h': 24 * 60 * 60_000,
  '7d': 7 * 24 * 60 * 60_000,
  '30d': 30 * 24 * 60 * 60_000,
  '90d': 90 * 24 * 60 * 60_000,
};

function importanceFloor(level: string): number | null {
  if (level === 'high') return 0.7;
  if (level === 'medium') return 0.5;
  if (level === 'low') return -1; // ceiling instead, handled below
  return null;
}

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const { workspaceId } = session.user;
  const sp = await searchParams;

  const range = (typeof sp.range === 'string' ? sp.range : '7d') as string;
  const since = new Date(Date.now() - (RANGE_TO_MS[range] ?? RANGE_TO_MS['7d']!));
  const kind = typeof sp.kind === 'string' ? sp.kind : '';
  const importance = typeof sp.importance === 'string' ? sp.importance : '';
  const q = typeof sp.q === 'string' ? sp.q.trim() : '';
  const projectFilter = typeof sp.project === 'string' ? sp.project.trim() : '';

  const db = getDb();
  const baseFilters = [
    eq(timelineEvent.workspaceId, workspaceId),
    gte(timelineEvent.occurredAt, since),
  ];
  if (kind) baseFilters.push(eq(timelineEvent.kind, kind));
  if (importance) {
    const floor = importanceFloor(importance);
    if (importance === 'low') {
      baseFilters.push(sql`${timelineEvent.importance} < 0.5`);
    } else if (floor !== null) {
      baseFilters.push(sql`${timelineEvent.importance} >= ${floor}`);
    }
  }
  if (q) {
    baseFilters.push(
      or(
        ilike(timelineEvent.title, `%${q}%`),
        ilike(timelineEvent.kind, `%${q}%`),
        ilike(timelineEvent.body, `%${q}%`),
      )!,
    );
  }
  if (projectFilter === 'none') {
    baseFilters.push(isNull(timelineEvent.projectId));
  } else if (projectFilter && /^[0-9a-f-]{36}$/i.test(projectFilter)) {
    baseFilters.push(eq(timelineEvent.projectId, projectFilter));
  }

  const [rows, facetRows, totalRow, weekly7d, weekly14d, projectFacets] = await Promise.all([
    db
      .select({
        id: timelineEvent.id,
        kind: timelineEvent.kind,
        title: timelineEvent.title,
        body: timelineEvent.body,
        importance: timelineEvent.importance,
        occurredAt: timelineEvent.occurredAt,
      })
      .from(timelineEvent)
      .where(and(...baseFilters))
      .orderBy(desc(timelineEvent.occurredAt))
      .limit(200),
    db
      .select({ value: timelineEvent.kind, count: sql<number>`count(*)::int` })
      .from(timelineEvent)
      .where(and(eq(timelineEvent.workspaceId, workspaceId), gte(timelineEvent.occurredAt, since)))
      .groupBy(timelineEvent.kind)
      .orderBy(desc(sql`count(*)`))
      .limit(40),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(timelineEvent)
      .where(and(...baseFilters)),
    // Weekly summary: kind counts last 7 days. Always computed regardless
    // of the active range filter so the summary card is stable across
    // user navigation.
    db
      .select({ kind: timelineEvent.kind, count: sql<number>`count(*)::int` })
      .from(timelineEvent)
      .where(
        and(
          eq(timelineEvent.workspaceId, workspaceId),
          gte(timelineEvent.occurredAt, new Date(Date.now() - 7 * 24 * 60 * 60_000)),
        ),
      )
      .groupBy(timelineEvent.kind),
    // Previous 7-day window for surge detection (8-14 days ago).
    db
      .select({ kind: timelineEvent.kind, count: sql<number>`count(*)::int` })
      .from(timelineEvent)
      .where(
        and(
          eq(timelineEvent.workspaceId, workspaceId),
          gte(timelineEvent.occurredAt, new Date(Date.now() - 14 * 24 * 60 * 60_000)),
          sql`${timelineEvent.occurredAt} < ${new Date(Date.now() - 7 * 24 * 60 * 60_000)}`,
        ),
      )
      .groupBy(timelineEvent.kind),
    db
      .select({ id: project.id, name: project.name })
      .from(project)
      .where(and(eq(project.workspaceId, workspaceId), eq(project.status, 'active')))
      .orderBy(asc(project.name))
      .limit(50),
  ]);

  const total = totalRow[0]?.n ?? 0;

  // Weekly summary calculations — top kinds + surge alerts (kinds whose
  // 7d count is ≥ 2x their previous-week count, with a min volume of 5
  // to avoid spam from one-off events).
  const prevByKind = new Map(weekly14d.map((r) => [r.kind, r.count]));
  const total7d = weekly7d.reduce((acc, r) => acc + r.count, 0);
  const totalPrev7d = weekly14d.reduce((acc, r) => acc + r.count, 0);
  const topKinds = [...weekly7d].sort((a, b) => b.count - a.count).slice(0, 5);
  interface Surge {
    kind: string;
    current: number;
    previous: number;
    multiplier: number;
  }
  const surges: Surge[] = weekly7d
    .filter((r) => r.count >= 5)
    .map((r) => {
      const previous = prevByKind.get(r.kind) ?? 0;
      const multiplier = previous === 0 ? Infinity : r.count / previous;
      return { kind: r.kind, current: r.count, previous, multiplier };
    })
    .filter((s) => s.multiplier >= 2)
    .sort((a, b) => b.multiplier - a.multiplier)
    .slice(0, 5);
  const trendDelta = totalPrev7d === 0 ? null : (total7d - totalPrev7d) / totalPrev7d;

  // Group by day for visual chunking.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const day = new Date(r.occurredAt).toISOString().slice(0, 10);
    const existing = groups.get(day) ?? [];
    existing.push(r);
    groups.set(day, existing);
  }

  return (
    <Page>
      <PageHeader
        accent={<Sparkles className="h-5 w-5 text-[var(--color-brand)]" />}
        eyebrow="Intelligence"
        title="Insights"
        description={`${total.toLocaleString()} signals in this view`}
        actions={<InsightsExportButtons />}
      />
      <PageSection>
        <InsightsFilters facets={{ kinds: facetRows, projects: projectFacets }} />
      </PageSection>
      <PageSection>
        <div className="grid gap-3 md:grid-cols-3">
          <Card>
            <p className="text-xs text-[var(--color-fg-subtle)]">Last 7 days</p>
            <p className="mt-1 text-2xl font-semibold">{total7d.toLocaleString()}</p>
            {trendDelta !== null && (
              <p
                className="mt-1 text-xs"
                style={{
                  color:
                    trendDelta > 0.1
                      ? 'var(--color-brand)'
                      : trendDelta < -0.1
                        ? 'var(--color-fg-subtle)'
                        : 'var(--color-fg-subtle)',
                }}
              >
                {trendDelta >= 0 ? '+' : ''}
                {Math.round(trendDelta * 100)}% vs prior 7d
              </p>
            )}
          </Card>
          <Card>
            <p className="text-xs text-[var(--color-fg-subtle)]">Top kinds (7d)</p>
            <ul className="mt-1 space-y-0.5 text-xs">
              {topKinds.length === 0 ? (
                <li className="text-[var(--color-fg-subtle)]">No activity</li>
              ) : (
                topKinds.map((k) => (
                  <li key={k.kind} className="flex justify-between gap-2">
                    <span className="truncate font-mono">{k.kind}</span>
                    <span className="text-[var(--color-fg-subtle)]">{k.count}</span>
                  </li>
                ))
              )}
            </ul>
          </Card>
          <Card>
            <p className="text-xs text-[var(--color-fg-subtle)]">Surge alerts</p>
            <ul className="mt-1 space-y-0.5 text-xs">
              {surges.length === 0 ? (
                <li className="text-[var(--color-fg-subtle)]">No surges this week</li>
              ) : (
                surges.map((s) => (
                  <li key={s.kind} className="flex justify-between gap-2">
                    <span className="truncate font-mono">{s.kind}</span>
                    <span style={{ color: 'var(--color-brand)' }}>
                      {s.previous === 0
                        ? `+${s.current}`
                        : `${s.multiplier.toFixed(1)}× (${s.previous}→${s.current})`}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </Card>
        </div>
      </PageSection>
      <PageSection>
        <div className="grid gap-4 md:grid-cols-[200px_minmax(0,1fr)]">
          <aside className="md:sticky md:top-4 md:self-start">
            <InsightsSidebar facets={facetRows} />
          </aside>
          <div>
            {rows.length === 0 ? (
              <EmptyState
                icon={<Sparkles className="h-6 w-6" />}
                title="No signals match these filters"
                description="Try a wider date range or clear filters."
              />
            ) : (
              <div className="space-y-4">
                {Array.from(groups.entries()).map(([day, items]) => (
                  <Card key={day}>
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-medium">{formatDay(day)}</h3>
                      <span className="text-xs text-[var(--color-fg-subtle)]">
                        {items.length} {items.length === 1 ? 'event' : 'events'}
                      </span>
                    </div>
                    <ul className="space-y-2">
                      {items.map((e) => (
                        <li key={e.id} className="flex items-start gap-2 text-sm">
                          <span
                            className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{
                              background:
                                (e.importance ?? 0) >= 0.7
                                  ? 'var(--color-danger, #ef4444)'
                                  : (e.importance ?? 0) >= 0.5
                                    ? 'var(--color-brand)'
                                    : 'var(--color-fg-subtle)',
                            }}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate">{e.title}</div>
                            <div className="text-[11px] text-[var(--color-fg-subtle)]">
                              <span className="font-mono">{e.kind}</span>
                              {' · '}
                              {new Date(e.occurredAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                              {e.importance !== null && e.importance !== undefined
                                ? ` · ${e.importance.toFixed(2)}`
                                : ''}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </PageSection>
    </Page>
  );
}

function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const today = new Date().toISOString().slice(0, 10);
  if (iso === today) return 'Today';
  const yesterday = new Date(Date.now() - 24 * 60 * 60_000).toISOString().slice(0, 10);
  if (iso === yesterday) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

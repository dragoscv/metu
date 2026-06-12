import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { listGoalsFiltered, listTimelineFiltered, weeklyReviewSummary } from '@metu/db/queries';
import { Badge, Card, EmptyState, Page, PageHeader } from '@metu/ui';
import { CalendarDays, Gavel, Sparkles, Target } from 'lucide-react';
import Link from 'next/link';
import { ReviewNarrative } from '@/components/review/review-narrative';

interface PageProps {
  searchParams: Promise<{ window?: string }>;
}

const VALID_WINDOWS = new Set([7, 14, 30]);

export default async function ReviewPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const sp = await searchParams;
  const w = Number(sp.window ?? 7);
  const windowDays = VALID_WINDOWS.has(w) ? w : 7;

  const [summary, goals] = await Promise.all([
    weeklyReviewSummary(session.user.workspaceId, windowDays),
    listGoalsFiltered({
      workspaceId: session.user.workspaceId,
      status: 'active',
      sort: 'weight',
    }),
  ]);

  const decisions = await listTimelineFiltered({
    workspaceId: session.user.workspaceId,
    kinds: ['decision', 'policy.change', 'goal.achieved'],
    since: summary.startedAt,
    limit: 12,
  });

  const totalSignals =
    summary.captures + summary.toolCalls + summary.tasksCompleted + summary.topProjects.length;

  return (
    <Page className="space-y-5">
      <PageHeader
        title="Review"
        description={`The last ${summary.windowDays} days, on one screen. Use this to remember where you were and decide what's next.`}
        actions={
          <div className="flex items-center gap-1 text-xs">
            {[7, 14, 30].map((d) => (
              <Link
                key={d}
                href={`/review?window=${d}`}
                className={`rounded-md border px-2 py-1 transition ${
                  d === windowDays
                    ? 'bg-[var(--color-brand)]/10 border-[var(--color-brand)] text-[var(--color-brand)]'
                    : 'border-[var(--color-border)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-elevated)]'
                }`}
              >
                {d}d
              </Link>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Captures" value={summary.captures} />
        <Stat label="Tasks completed" value={summary.tasksCompleted} />
        <Stat
          label="Tool calls"
          value={summary.toolCalls}
          sub={
            summary.toolCallsFailed > 0
              ? `${summary.toolCallsFailed} failed`
              : summary.toolCallsCost > 0
                ? `$${summary.toolCallsCost.toFixed(3)}`
                : undefined
          }
        />
        <Stat
          label="Goals"
          value={summary.goalsActive}
          sub={summary.goalsAchieved > 0 ? `${summary.goalsAchieved} achieved` : 'active'}
        />
      </div>

      {totalSignals > 0 ? <ReviewNarrative windowDays={windowDays as 7 | 14 | 30} /> : null}

      {totalSignals === 0 ? (
        <EmptyState
          icon={<CalendarDays className="h-5 w-5" />}
          title="Nothing to review yet"
          description="Once you start capturing and the Conductor takes its first action, this view will summarise the period."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-sm font-medium">Top projects touched</h2>
              <span className="text-[11px] text-[var(--color-fg-subtle)]">
                {summary.projectsTouched} total
              </span>
            </div>
            {summary.topProjects.length === 0 ? (
              <p className="text-xs text-[var(--color-fg-subtle)]">
                No project-scoped events in this window.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {summary.topProjects.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/projects/${p.id}`}
                      className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition hover:bg-[var(--color-bg-elevated)]"
                    >
                      <span className="truncate">{p.name}</span>
                      <Badge variant="neutral" size="sm">
                        {p.events} events
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-sm font-medium">Activity mix</h2>
              <Sparkles className="h-3.5 w-3.5 text-[var(--color-fg-subtle)]" />
            </div>
            {summary.topKinds.length === 0 ? (
              <p className="text-xs text-[var(--color-fg-subtle)]">
                No timeline events recorded yet.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {summary.topKinds.map((k) => {
                  const total = summary.topKinds.reduce((s, x) => s + x.count, 0);
                  const pct = Math.round((k.count / total) * 100);
                  return (
                    <li key={k.kind}>
                      <Link
                        href={`/timeline?kinds=${encodeURIComponent(k.kind)}`}
                        className="block rounded-md px-2 py-1.5 transition hover:bg-[var(--color-bg-elevated)]"
                      >
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="font-medium">{k.kind}</span>
                          <span className="tabular-nums text-[var(--color-fg-subtle)]">
                            {k.count}
                          </span>
                        </div>
                        <div className="h-1 overflow-hidden rounded-full bg-[var(--color-bg-elevated)]">
                          <div
                            className="h-full bg-[var(--color-brand)]"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      )}

      {goals.length > 0 && (
        <Card>
          <div className="mb-3 flex items-baseline justify-between">
            <div>
              <h2 className="text-sm font-medium">Active goals</h2>
              <p className="mt-0.5 text-xs text-[var(--color-fg-subtle)]">
                Heaviest weight first. Tap to open.
              </p>
            </div>
            <Target className="h-3.5 w-3.5 text-[var(--color-fg-subtle)]" />
          </div>
          <ul className="space-y-2">
            {goals.slice(0, 8).map((g) => {
              const pct = Math.round((g.progress ?? 0) * 100);
              const driftTone =
                g.drift === 'stalled'
                  ? 'bg-[var(--color-danger)]'
                  : g.drift === 'slipping'
                    ? 'bg-[var(--color-warning)]'
                    : 'bg-[var(--color-success)]';
              return (
                <li key={g.id}>
                  <Link
                    href={`/goals/${g.id}`}
                    className="block rounded-md px-2 py-1.5 transition hover:bg-[var(--color-bg-elevated)]"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{g.title}</span>
                      <div className="flex items-center gap-2 text-[11px] text-[var(--color-fg-subtle)]">
                        <Badge variant="neutral" size="sm">
                          w{g.weight}
                        </Badge>
                        <span className="tabular-nums">{pct}%</span>
                      </div>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-[var(--color-bg-elevated)]">
                      <div className={`h-full ${driftTone}`} style={{ width: `${pct}%` }} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {decisions.items.length > 0 && (
        <Card>
          <div className="mb-3 flex items-baseline justify-between">
            <div>
              <h2 className="text-sm font-medium">Recent decisions</h2>
              <p className="mt-0.5 text-xs text-[var(--color-fg-subtle)]">
                Decisions, policy changes, and goal milestones from this period.
              </p>
            </div>
            <Gavel className="h-3.5 w-3.5 text-[var(--color-fg-subtle)]" />
          </div>
          <ul className="space-y-1.5">
            {decisions.items.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/timeline?q=${encodeURIComponent(e.title.slice(0, 80))}`}
                  className="flex items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-sm transition hover:bg-[var(--color-bg-elevated)]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{e.title}</div>
                    {e.body && (
                      <div className="truncate text-[11px] text-[var(--color-fg-subtle)]">
                        {e.body}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-[11px] text-[var(--color-fg-subtle)]">
                    <Badge variant="neutral" size="sm">
                      {e.kind}
                    </Badge>
                    <span>{e.occurredAt.toLocaleDateString()}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Page>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <Card>
      <div className="text-[11px] uppercase tracking-wide text-[var(--color-fg-subtle)]">
        {label}
      </div>
      <div className="mt-0.5 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-[var(--color-fg-subtle)]">{sub}</div>}
    </Card>
  );
}

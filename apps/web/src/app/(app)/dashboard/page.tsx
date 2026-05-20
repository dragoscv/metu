import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import {
  listProjects,
  listOpenTasks,
  listBlockedTasks,
  listRecentCaptures,
} from '@metu/db/queries';
import { Badge, Card, CardTitle, MomentumBar, Page, PageHeader } from '@metu/ui';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { agentPolicy, goal, target, timelineEvent } from '@metu/db/schema';
import { BrainDump } from '@/components/brain-dump';
import { RecomputeFocusButton } from '@/components/recompute-focus';
import { PauseAutonomyToggle } from '@/components/pause-autonomy-toggle';
import { DashboardTabs } from '@/components/dashboard-tabs';
import { ConductorBacklog } from '@/components/conductor-backlog';
import { ContinuityStrip } from '@/components/continuity-strip';
import { PlanTabClient } from '@/components/dashboard/plan-tab-client';
import { OnboardingChecklist } from '@/components/dashboard/onboarding-checklist';
import { ProposedActionsStrip } from '@/components/dashboard/proposed-actions-strip';
import { CostBudgetBanner } from '@/components/dashboard/cost-budget-banner';
import { getConductorActivityLevel } from '@/app/actions/workspace-preferences';
import { getDashboardPrefsAction } from '@/app/actions/dashboard-prefs';
import { aggregateStreams } from '@/lib/dashboard/streams';
import { DashboardScene } from '@/components/dashboard/observatory/dashboard-scene';

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const { workspaceId } = session.user;
  const sp = await searchParams;
  const tab = (sp.tab ?? 'now') as 'now' | 'inbox' | 'plan' | 'widgets';

  const [projects, openTasks, blocked, policyRow, activityLevel, dashboardPrefs] =
    await Promise.all([
      listProjects(workspaceId),
      listOpenTasks(workspaceId),
      listBlockedTasks(workspaceId),
      getDb()
        .select({ enabled: agentPolicy.enabled })
        .from(agentPolicy)
        .where(eq(agentPolicy.workspaceId, workspaceId))
        .limit(1),
      getConductorActivityLevel(workspaceId),
      getDashboardPrefsAction(),
    ]);
  const streams = tab === 'now' ? await aggregateStreams(workspaceId, dashboardPrefs) : [];
  const autonomyEnabled = policyRow[0]?.enabled ?? true;

  const ignoredIds: string[] = [];
  const momentumProjects = projects.filter((p) => !ignoredIds.includes(p.id)).slice(0, 6);

  return (
    <Page className="space-y-8">
      <PageHeader
        eyebrow={
          <span className="text-xs uppercase tracking-wider text-[var(--color-fg-subtle)]">
            What matters now
          </span>
        }
        title={`${greeting()}, ${session.user.name?.split(' ')[0] ?? 'there'}.`}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/settings/autonomy"
              title="Conductor reactivity — click to change"
              className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-fg-muted)] hover:border-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-brand)]" />
              {activityLevel}
            </Link>
            <PauseAutonomyToggle initialEnabled={autonomyEnabled} />
            <RecomputeFocusButton />
          </div>
        }
      />
      <DashboardTabs active={tab} />
      {tab === 'now' && (
        <DashboardScene
          prefs={dashboardPrefs}
          streams={streams}
          greetingName={session.user.name?.split(' ')[0]}
        />
      )}
      {tab === 'now' && <CostBudgetBanner workspaceId={workspaceId} />}
      {tab === 'now' && <ProposedActionsStrip workspaceId={workspaceId} />}
      {tab === 'now' && <OnboardingChecklist workspaceId={workspaceId} />}
      {tab === 'now' && <ContinuityStrip workspaceId={workspaceId} />}
      {tab === 'now' && <ConductorBacklog workspaceId={workspaceId} />}{' '}
      {tab === 'inbox' && <InboxTab workspaceId={workspaceId} />}
      {tab === 'plan' && <PlanTabClient openTasks={openTasks} blocked={blocked} />}
      {tab === 'widgets' && (
        <WidgetsTab workspaceId={workspaceId} momentumProjects={momentumProjects} />
      )}
      <BrainDump />
    </Page>
  );
}

async function InboxTab({ workspaceId }: { workspaceId: string }) {
  const captures = await listRecentCaptures(workspaceId, 30);
  const db = getDb();
  const drifting = await db
    .select({ id: goal.id, title: goal.title, drift: goal.drift, weight: goal.weight })
    .from(goal)
    .where(
      and(eq(goal.workspaceId, workspaceId), isNull(goal.deletedAt), eq(goal.status, 'active')),
    )
    .orderBy(desc(goal.weight))
    .limit(10);

  const drifted = drifting.filter((g) => g.drift !== 'on_track');

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardTitle>Recent captures</CardTitle>
        <ul className="mt-3 space-y-2 text-sm">
          {captures.length === 0 && (
            <li className="text-[var(--color-fg-subtle)]">No captures yet.</li>
          )}
          {captures.slice(0, 12).map((c) => (
            <li key={c.id} className="rounded-md border border-[var(--color-border)] px-3 py-2">
              <div className="flex items-center justify-between text-xs text-[var(--color-fg-subtle)]">
                <span>
                  {c.kind} · {c.source}
                </span>
                <span>{new Date(c.capturedAt).toLocaleString()}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-[var(--color-fg-muted)]">
                {c.content ?? c.sourceUrl ?? c.storageKey ?? '(media)'}
              </p>
            </li>
          ))}
        </ul>
        <Link
          href="/inbox"
          className="mt-3 inline-flex items-center gap-1 text-xs text-[var(--color-brand)] hover:underline"
        >
          See all <ArrowRight className="h-3 w-3" />
        </Link>
      </Card>
      <Card>
        <CardTitle>Drifting goals</CardTitle>
        <ul className="mt-3 space-y-2 text-sm">
          {drifted.length === 0 && (
            <li className="text-[var(--color-fg-subtle)]">All goals on track. Nice.</li>
          )}
          {drifted.map((g) => (
            <li
              key={g.id}
              className="flex items-center justify-between gap-2 rounded-md border border-[var(--color-border)] px-3 py-2"
            >
              <span className="truncate">{g.title}</span>
              <Badge variant={g.drift === 'stalled' ? 'danger' : 'warning'} size="xs">
                {g.drift}
              </Badge>
            </li>
          ))}
        </ul>
        <Link
          href="/goals"
          className="mt-3 inline-flex items-center gap-1 text-xs text-[var(--color-brand)] hover:underline"
        >
          Open goals <ArrowRight className="h-3 w-3" />
        </Link>
      </Card>
    </div>
  );
}

async function WidgetsTab({
  workspaceId,
  momentumProjects,
}: {
  workspaceId: string;
  momentumProjects: {
    id: string;
    name: string;
    momentumScore: number | null;
    lastMeaningfulActivityAt: Date | null;
  }[];
}) {
  const db = getDb();
  const goals = await db
    .select({
      id: goal.id,
      title: goal.title,
      progress: goal.progress,
      drift: goal.drift,
      weight: goal.weight,
    })
    .from(goal)
    .where(
      and(eq(goal.workspaceId, workspaceId), isNull(goal.deletedAt), eq(goal.status, 'active')),
    )
    .orderBy(desc(goal.weight))
    .limit(8);
  const targets = await db
    .select({
      id: target.id,
      title: target.title,
      currentValue: target.currentValue,
      targetValue: target.targetValue,
      unit: target.unit,
    })
    .from(target)
    .where(and(eq(target.workspaceId, workspaceId), isNull(target.deletedAt)))
    .orderBy(desc(target.updatedAt))
    .limit(8);

  const since24h = new Date(Date.now() - 24 * 60 * 60_000);
  const intelligence = await db
    .select({
      id: timelineEvent.id,
      kind: timelineEvent.kind,
      title: timelineEvent.title,
      importance: timelineEvent.importance,
      occurredAt: timelineEvent.occurredAt,
    })
    .from(timelineEvent)
    .where(and(eq(timelineEvent.workspaceId, workspaceId), gte(timelineEvent.occurredAt, since24h)))
    .orderBy(desc(timelineEvent.importance), desc(timelineEvent.occurredAt))
    .limit(5);

  const recentCaptures = await listRecentCaptures(workspaceId, 6);
  const captureSampleForTags = await listRecentCaptures(workspaceId, 200);
  const tagCounts = new Map<string, number>();
  for (const c of captureSampleForTags) {
    const tags = (c.metadata as { tags?: unknown } | null)?.tags;
    if (!Array.isArray(tags)) continue;
    for (const t of tags) {
      if (typeof t !== 'string') continue;
      const norm = t.toLowerCase().trim();
      if (!norm) continue;
      tagCounts.set(norm, (tagCounts.get(norm) ?? 0) + 1);
    }
  }
  const topTags = Array.from(tagCounts, ([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardTitle>Top goals</CardTitle>
        <ul className="mt-3 space-y-3 text-sm">
          {goals.length === 0 && (
            <li className="text-[var(--color-fg-subtle)]">
              No goals yet.{' '}
              <Link href="/goals" className="underline">
                Add one
              </Link>
              .
            </li>
          )}
          {goals.map((g) => (
            <li key={g.id}>
              <div className="mb-1 flex items-center justify-between">
                <span className="truncate">{g.title}</span>
                <span className="text-[11px] text-[var(--color-fg-subtle)]">
                  {Math.round(g.progress * 100)}%
                </span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--color-bg-elevated)]">
                <div
                  className="h-full rounded-full bg-[var(--color-brand)]"
                  style={{ width: `${Math.round(g.progress * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardTitle>Targets</CardTitle>
        <ul className="mt-3 space-y-3 text-sm">
          {targets.length === 0 && (
            <li className="text-[var(--color-fg-subtle)]">No targets set.</li>
          )}
          {targets.map((t) => {
            const pct = t.targetValue ? Math.min(100, (t.currentValue / t.targetValue) * 100) : 0;
            return (
              <li key={t.id}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="truncate">{t.title}</span>
                  <span className="font-mono text-[11px] text-[var(--color-fg-subtle)]">
                    {t.currentValue.toLocaleString()} / {t.targetValue.toLocaleString()}
                    {t.unit ? ` ${t.unit}` : ''}
                  </span>
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--color-bg-elevated)]">
                  <div
                    className="h-full rounded-full bg-[var(--color-brand)]"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
      <Card className="md:col-span-2">
        <div className="flex items-center justify-between">
          <CardTitle>Today’s intelligence</CardTitle>
          <Link href="/insights" className="text-xs text-[var(--color-brand)] hover:underline">
            All signals →
          </Link>
        </div>
        <ul className="mt-3 space-y-2 text-sm">
          {intelligence.length === 0 && (
            <li className="text-[var(--color-fg-subtle)]">Nothing notable in the last 24 hours.</li>
          )}
          {intelligence.map((e) => (
            <li key={e.id} className="flex items-start gap-2">
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
                  {formatRelative(e.occurredAt)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="md:col-span-2">
        <CardTitle>Momentum</CardTitle>
        <div className="mt-3 space-y-3">
          {momentumProjects.map((p) => (
            <div key={p.id}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span>{p.name}</span>
                <span className="text-xs text-[var(--color-fg-subtle)]">
                  {p.lastMeaningfulActivityAt ? formatRelative(p.lastMeaningfulActivityAt) : 'idle'}
                </span>
              </div>
              <MomentumBar value={p.momentumScore ?? 0} />
            </div>
          ))}
        </div>
      </Card>
      <Card className="md:col-span-2">
        <div className="flex items-center justify-between">
          <CardTitle>Top tags</CardTitle>
          <Link href="/captures" className="text-xs text-[var(--color-brand)] hover:underline">
            All →
          </Link>
        </div>
        {topTags.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-fg-subtle)]">
            No tagged captures yet. Tag captures with #hashtags or via the browser extension.
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {topTags.map((t) => {
              const size = Math.max(11, Math.min(18, 11 + t.count));
              return (
                <Link
                  key={t.tag}
                  href={`/captures?tag=${encodeURIComponent(t.tag)}`}
                  className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-fg-muted)] transition-colors hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
                  style={{ fontSize: `${size}px` }}
                  title={`${t.count} ${t.count === 1 ? 'capture' : 'captures'}`}
                >
                  #{t.tag}
                </Link>
              );
            })}
          </div>
        )}
      </Card>
      <Card className="md:col-span-2">
        <div className="flex items-center justify-between">
          <CardTitle>Latest captures</CardTitle>
          <Link href="/timeline" className="text-xs text-[var(--color-brand)] hover:underline">
            All →
          </Link>
        </div>
        <ul className="mt-3 space-y-2 text-sm">
          {recentCaptures.length === 0 ? (
            <li className="text-[var(--color-fg-subtle)]">
              No captures yet — drop a thought in the inbox to start.
            </li>
          ) : (
            recentCaptures.map((c) => (
              <li key={c.id} className="flex items-start gap-2">
                <Badge variant="neutral">{c.kind}</Badge>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[var(--color-fg)]">
                    {c.content?.slice(0, 120) ?? (
                      <span className="italic text-[var(--color-fg-subtle)]">(no text)</span>
                    )}
                  </div>
                  <div className="text-[11px] text-[var(--color-fg-subtle)]">
                    {c.source ?? 'unknown source'} · {formatRelative(c.createdAt)}
                  </div>
                </div>
              </li>
            ))
          )}
        </ul>
      </Card>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Late night';
  if (h < 12) return 'Morning';
  if (h < 18) return 'Afternoon';
  return 'Evening';
}

function formatRelative(d: Date | string) {
  const date = typeof d === 'string' ? new Date(d) : d;
  const days = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

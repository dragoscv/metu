import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { focus } from '@metu/core';
import {
  listProjects,
  listOpenTasks,
  listBlockedTasks,
  listRecentCaptures,
} from '@metu/db/queries';
import { Badge, Card, CardTitle, MomentumBar, Page, PageHeader } from '@metu/ui';
import { ArrowRight, AlertTriangle, Compass, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { goal, target } from '@metu/db/schema';
import { BrainDump } from '@/components/brain-dump';
import { RecomputeFocusButton } from '@/components/recompute-focus';
import { DashboardTabs } from '@/components/dashboard-tabs';
import { ConductorBacklog } from '@/components/conductor-backlog';
import { ContinuityStrip } from '@/components/continuity-strip';
import { PlanTabClient } from '@/components/dashboard/plan-tab-client';

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

  const [latestFocus, projects, openTasks, blocked] = await Promise.all([
    focus.getLatestFocus(workspaceId, session.user.id),
    listProjects(workspaceId),
    listOpenTasks(workspaceId),
    listBlockedTasks(workspaceId),
  ]);

  const ignoredIds = (latestFocus?.ignoredProjectIds as string[]) ?? [];
  const nowTask = openTasks.find((t) => t.id === latestFocus?.nowTaskId) ?? null;
  const nextIds = (latestFocus?.nextTaskIds as string[]) ?? [];
  const nextTasks = nextIds.map((id) => openTasks.find((t) => t.id === id)).filter(Boolean);
  const ignoredProjects = projects.filter((p) => ignoredIds.includes(p.id));
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
        actions={<RecomputeFocusButton />}
      />

      <DashboardTabs active={tab} />

      {tab === 'now' && (
        <NowTab
          latestFocus={latestFocus}
          nowTask={nowTask}
          nextTasks={nextTasks}
          ignoredProjects={ignoredProjects}
          momentumProjects={momentumProjects}
          blocked={blocked}
        />
      )}
      {tab === 'now' && <ContinuityStrip workspaceId={workspaceId} />}
      {tab === 'now' && <ConductorBacklog workspaceId={workspaceId} />}
      {tab === 'inbox' && <InboxTab workspaceId={workspaceId} />}
      {tab === 'plan' && <PlanTabClient openTasks={openTasks} blocked={blocked} />}
      {tab === 'widgets' && (
        <WidgetsTab workspaceId={workspaceId} momentumProjects={momentumProjects} />
      )}

      <BrainDump />
    </Page>
  );
}

function NowTab({
  latestFocus,
  nowTask,
  nextTasks,
  ignoredProjects,
  momentumProjects,
  blocked,
}: {
  latestFocus: Awaited<ReturnType<typeof focus.getLatestFocus>>;
  nowTask: {
    id: string;
    title: string;
    body: string | null;
    projectId: string | null;
    kind: string;
  } | null;
  nextTasks: ({ id: string; title: string; kind: string } | undefined)[];
  ignoredProjects: { id: string; name: string }[];
  momentumProjects: {
    id: string;
    name: string;
    momentumScore: number | null;
    lastMeaningfulActivityAt: Date | null;
  }[];
  blocked: { id: string; title: string; blockedReason: string | null }[];
}) {
  return (
    <div className="space-y-8">
      {/* The single now */}
      <Card className="overflow-hidden !p-0">
        <div className="flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-5 py-3">
          <Compass className="h-4 w-4 text-[var(--color-brand)]" />
          <CardTitle className="!mt-0">Your single focus</CardTitle>
        </div>
        <div className="p-5">
          {nowTask ? (
            <>
              <h2 className="text-2xl font-semibold tracking-tight">{nowTask.title}</h2>
              {nowTask.body && (
                <p className="mt-2 text-sm text-[var(--color-fg-muted)]">{nowTask.body}</p>
              )}
              <Link
                href={`/projects/${nowTask.projectId}`}
                className="mt-4 inline-flex items-center gap-1 text-sm text-[var(--color-brand)] hover:underline"
              >
                Continue <ArrowRight className="h-3 w-3" />
              </Link>
            </>
          ) : (
            <p className="text-sm text-[var(--color-fg-muted)]">
              Press{' '}
              <kbd className="rounded bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-xs">
                Recompute
              </kbd>{' '}
              to ask the Focus Engine for your single next move.
            </p>
          )}
          {latestFocus?.rationale && (
            <p className="mt-4 text-pretty text-xs text-[var(--color-fg-subtle)]">
              {latestFocus.rationale}
            </p>
          )}
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Next */}
        <Card>
          <CardTitle>Next (≤3)</CardTitle>
          <ul className="mt-3 space-y-2">
            {nextTasks.length === 0 && <li className="text-sm text-[var(--color-fg-subtle)]">—</li>}
            {nextTasks.map(
              (t) =>
                t && (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm"
                  >
                    <span className="truncate">{t.title}</span>
                    <span className="text-xs uppercase tracking-wide text-[var(--color-fg-subtle)]">
                      {t.kind}
                    </span>
                  </li>
                ),
            )}
          </ul>
        </Card>

        {/* Ignore this week */}
        <Card>
          <div className="flex items-center gap-2">
            <EyeOff className="h-4 w-4 text-[var(--color-fg-muted)]" />
            <CardTitle>Ignore this week</CardTitle>
          </div>
          <ul className="mt-3 space-y-1.5 text-sm">
            {ignoredProjects.length === 0 && <li className="text-[var(--color-fg-subtle)]">—</li>}
            {ignoredProjects.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-fg-subtle)]" />
                <span className="decoration-[var(--color-fg-subtle)]/40 text-[var(--color-fg-muted)] line-through">
                  {p.name}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Momentum */}
      <Card>
        <CardTitle>Momentum</CardTitle>
        <div className="mt-4 space-y-3">
          {momentumProjects.map((p) => (
            <Link
              href={`/projects/${p.id}`}
              key={p.id}
              className="block rounded-md p-2 transition-colors hover:bg-[var(--color-bg-elevated)]"
            >
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-[var(--color-fg-subtle)]">
                  {p.lastMeaningfulActivityAt
                    ? `last ${formatRelative(p.lastMeaningfulActivityAt)}`
                    : 'no activity'}
                </span>
              </div>
              <MomentumBar value={p.momentumScore ?? 0} />
            </Link>
          ))}
          {momentumProjects.length === 0 && (
            <p className="text-sm text-[var(--color-fg-subtle)]">
              No projects yet.{' '}
              <Link href="/projects" className="underline">
                Create one
              </Link>
              .
            </p>
          )}
        </div>
      </Card>

      {/* Blockers */}
      {blocked.length > 0 && (
        <Card>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[var(--color-warning)]" />
            <CardTitle>Blockers</CardTitle>
          </div>
          <ul className="mt-3 space-y-2 text-sm">
            {blocked.map((t) => (
              <li key={t.id} className="rounded-md border border-[var(--color-border)] p-3">
                <div className="font-medium">{t.title}</div>
                {t.blockedReason && (
                  <div className="mt-1 text-xs text-[var(--color-fg-muted)]">{t.blockedReason}</div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
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

import { auth } from '@metu/auth';
import {
  getGoalById,
  listGoalCheckins,
  listGoalDirectDecisions,
  listGoalDirectProjects,
  listGoalDirectTasks,
  listGoalTargets,
  listSubGoals,
} from '@metu/db/queries';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  MomentumBar,
  Page,
  PageHeader,
  PageSection,
} from '@metu/ui';
import { Pencil, Plus } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  BoardColumnsClient,
  type BoardSubGoal,
  type SubGoalStatus,
} from '@/components/goals/board-columns-client';
import { NewGoalTaskInline } from '@/components/goals/new-goal-task-inline';

interface PageProps {
  params: Promise<{ id: string }>;
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral' | 'danger'> = {
  active: 'success',
  paused: 'warning',
  achieved: 'neutral',
  dropped: 'danger',
};
const DRIFT_TONE: Record<string, 'success' | 'warning' | 'danger'> = {
  on_track: 'success',
  slipping: 'warning',
  stalled: 'danger',
};

const COLUMNS: SubGoalStatus[] = ['active', 'paused', 'achieved', 'dropped'];

export default async function GoalBoardPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const { id } = await params;
  const wsId = session.user.workspaceId;
  const g = await getGoalById(wsId, id);
  if (!g) notFound();

  const [subs, targets, checkins, tasks, projects, decisions] = await Promise.all([
    listSubGoals(wsId, id),
    listGoalTargets(wsId, id),
    listGoalCheckins(wsId, id, 10),
    listGoalDirectTasks(wsId, id),
    listGoalDirectProjects(wsId, id),
    listGoalDirectDecisions(wsId, id),
  ]);

  const grouped: Record<SubGoalStatus, typeof subs> = {
    active: [],
    paused: [],
    achieved: [],
    dropped: [],
  };
  for (const s of subs) {
    const col = (COLUMNS as readonly string[]).includes(s.status)
      ? (s.status as SubGoalStatus)
      : 'active';
    grouped[col].push(s);
  }

  const boardSubs: BoardSubGoal[] = subs.map((s) => ({
    id: s.id,
    title: s.title,
    progress: s.progress,
    status: ((COLUMNS as readonly string[]).includes(s.status)
      ? s.status
      : 'active') as SubGoalStatus,
    drift: s.drift,
    weight: s.weight,
    dueAt: s.dueAt ? s.dueAt.toISOString() : null,
  }));

  const onTrackRatio = subs.length
    ? subs.filter((s) => s.drift === 'on_track').length / subs.length
    : 1;
  const avgProgress = subs.length
    ? subs.reduce((sum, s) => sum + s.progress, 0) / subs.length
    : g.progress;

  // Weighted roll-up: Σ(progress × weight) / Σ(weight). Weight === 0 means
  // "doesn't count toward the parent". When every weight is 0 we fall back
  // to a simple average so the card still says something useful.
  const totalWeight = subs.reduce((sum, s) => sum + (s.weight ?? 0), 0);
  const weightedProgress =
    subs.length === 0
      ? g.progress
      : totalWeight > 0
        ? subs.reduce((sum, s) => sum + s.progress * (s.weight ?? 0), 0) / totalWeight
        : avgProgress;

  return (
    <Page>
      <PageHeader
        back={{ href: `/goals/${id}`, label: 'Goal detail' }}
        title={g.title}
        eyebrow={
          <>
            <Badge variant={STATUS_TONE[g.status] ?? 'neutral'} size="sm">
              {g.status}
            </Badge>
            <Badge variant={DRIFT_TONE[g.drift] ?? 'success'} size="sm">
              {g.drift.replaceAll('_', ' ')}
            </Badge>
            <span className="text-xs text-[var(--color-fg-subtle)]">
              {g.cadence} · weight {g.weight}
              {g.dueAt && ` · due ${new Date(g.dueAt).toLocaleDateString()}`}
            </span>
          </>
        }
        actions={
          <Link href={`/goals/${id}/edit`}>
            <Button variant="outline" size="sm">
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          </Link>
        }
      />

      <PageSection title="Snapshot">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Card className="p-4">
            <p className="text-[11px] uppercase tracking-wide text-[var(--color-fg-subtle)]">
              Goal progress
            </p>
            <p className="mt-1 font-mono text-2xl tabular-nums">{Math.round(g.progress * 100)}%</p>
            <MomentumBar value={g.progress} className="mt-2" />
          </Card>
          <Card className="p-4">
            <p className="text-[11px] uppercase tracking-wide text-[var(--color-fg-subtle)]">
              Weighted roll-up
            </p>
            <p className="mt-1 font-mono text-2xl tabular-nums">
              {Math.round(weightedProgress * 100)}%
            </p>
            <MomentumBar value={weightedProgress} className="mt-2" />
            <p className="mt-1 text-[11px] text-[var(--color-fg-muted)]">
              {totalWeight > 0
                ? `Σweight ${totalWeight.toLocaleString()}`
                : 'No weights — using average'}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-[11px] uppercase tracking-wide text-[var(--color-fg-subtle)]">
              Sub-goals
            </p>
            <p className="mt-1 font-mono text-2xl tabular-nums">{subs.length}</p>
            <p className="mt-1 text-[11px] text-[var(--color-fg-muted)]">
              {grouped.active.length} active · {grouped.achieved.length} done
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-[11px] uppercase tracking-wide text-[var(--color-fg-subtle)]">
              On-track ratio
            </p>
            <p className="mt-1 font-mono text-2xl tabular-nums">
              {Math.round(onTrackRatio * 100)}%
            </p>
            <MomentumBar value={onTrackRatio} className="mt-2" />
          </Card>
          <Card className="p-4">
            <p className="text-[11px] uppercase tracking-wide text-[var(--color-fg-subtle)]">
              Avg sub-goal progress
            </p>
            <p className="mt-1 font-mono text-2xl tabular-nums">{Math.round(avgProgress * 100)}%</p>
            <MomentumBar value={avgProgress} className="mt-2" />
          </Card>
        </div>
      </PageSection>

      <PageSection title="Milestones" description="Drag a card to change its status">
        {subs.length === 0 ? (
          <EmptyState
            title="No sub-goals yet"
            description="Break this goal into milestones to track progress in flight."
            action={
              <Link href="/goals">
                <Button variant="outline" size="sm">
                  <Plus className="h-4 w-4" />
                  New goal
                </Button>
              </Link>
            }
          />
        ) : (
          <BoardColumnsClient subs={boardSubs} />
        )}
      </PageSection>

      <PageSection
        title="Tasks"
        description="Tasks pinned directly to this goal as milestones"
        actions={<NewGoalTaskInline goalId={id} />}
      >
        {tasks.length === 0 ? (
          <p className="text-sm italic text-[var(--color-fg-subtle)]">
            No tasks pinned yet. Add one above to track an action item against this goal.
          </p>
        ) : (
          <TaskBoard tasks={tasks} />
        )}
      </PageSection>

      {projects.length > 0 ? (
        <PageSection
          title="Projects"
          description="Projects pinned to this goal as workstreams"
          actions={
            <Link href={`/projects/new?goalId=${id}`}>
              <Button variant="outline" size="sm">
                <Plus className="h-4 w-4" />
                New project
              </Button>
            </Link>
          }
        >
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/projects/${p.id}`}
                  className="block rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3 transition hover:border-[var(--color-brand)]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="truncate text-sm font-medium">{p.name}</h3>
                    <Badge variant="neutral" size="xs">
                      {p.status}
                    </Badge>
                  </div>
                  <MomentumBar value={p.momentumScore ?? 0} className="mt-2" />
                  {p.summary && (
                    <p className="mt-1 line-clamp-2 text-xs text-[var(--color-fg-muted)]">
                      {p.summary}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </PageSection>
      ) : (
        <PageSection
          title="Projects"
          description="Pin a project to this goal so it shows up here as a workstream"
          actions={
            <Link href={`/projects/new?goalId=${id}`}>
              <Button variant="outline" size="sm">
                <Plus className="h-4 w-4" />
                New project
              </Button>
            </Link>
          }
        >
          <p className="text-sm italic text-[var(--color-fg-subtle)]">No projects pinned yet.</p>
        </PageSection>
      )}

      {decisions.length > 0 && (
        <PageSection title="Decisions" description="Decisions made in service of this goal">
          <ul className="space-y-2">
            {decisions.map((d) => {
              const href = d.projectId
                ? `/projects/${d.projectId}/decisions/${d.id}`
                : `/decisions/${d.id}`;
              return (
                <li key={d.id}>
                  <Link
                    href={href}
                    className="block rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3 transition hover:border-[var(--color-brand)]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="truncate text-sm font-medium">{d.title}</h3>
                      <span className="shrink-0 text-[11px] text-[var(--color-fg-subtle)]">
                        {new Date(d.decidedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-[var(--color-fg-muted)]">
                      {d.rationale}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </PageSection>
      )}

      {targets.length > 0 && (
        <PageSection title="Targets">
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {targets.map((t) => {
              const ratio = t.targetValue > 0 ? t.currentValue / t.targetValue : 0;
              return (
                <li key={t.id}>
                  <Link
                    href={`/goals/targets/${t.id}`}
                    className="block rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3 transition hover:border-[var(--color-brand)]"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="truncate text-sm font-medium">{t.title}</h3>
                      <span className="font-mono text-xs tabular-nums">
                        {t.currentValue.toLocaleString()}/{t.targetValue.toLocaleString()}
                      </span>
                    </div>
                    <MomentumBar value={ratio} className="mt-2" />
                    <p className="mt-1 text-[11px] text-[var(--color-fg-subtle)]">
                      {t.period} · {t.unit || 'no unit'}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </PageSection>
      )}

      <PageSection title="Recent check-ins">
        {checkins.length === 0 ? (
          <Card>
            <p className="text-sm italic text-[var(--color-fg-subtle)]">
              No check-ins yet. Drop one from the goal detail page to start the rhythm.
            </p>
          </Card>
        ) : (
          <ul className="space-y-1">
            {checkins.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-2 text-sm"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Badge variant="neutral" size="xs">
                    {c.createdBy}
                  </Badge>
                  <span className="font-mono text-xs tabular-nums text-[var(--color-fg-muted)]">
                    {Math.round(c.progress * 100)}%
                  </span>
                  {c.note && (
                    <span className="truncate text-[var(--color-fg-muted)]">— {c.note}</span>
                  )}
                </div>
                <span className="shrink-0 text-[11px] text-[var(--color-fg-subtle)]">
                  {new Date(c.occurredAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PageSection>
    </Page>
  );
}

const OPEN_STATUS = new Set(['inbox', 'next', 'doing', 'blocked']);

const TASK_STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral' | 'danger'> = {
  inbox: 'neutral',
  next: 'success',
  doing: 'success',
  blocked: 'danger',
  done: 'neutral',
  dropped: 'warning',
};

interface TaskRowItem {
  id: string;
  title: string;
  status: string;
  kind: string;
  dueAt: Date | null;
  projectId: string | null;
}

function TaskBoard({ tasks }: { tasks: TaskRowItem[] }) {
  const open = tasks.filter((t) => OPEN_STATUS.has(t.status));
  const closed = tasks.filter((t) => !OPEN_STATUS.has(t.status));
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <TaskColumn label="Open" count={open.length} tasks={open} emptyHint="No open tasks" />
      <TaskColumn
        label="Closed"
        count={closed.length}
        tasks={closed}
        emptyHint="No closed tasks yet"
      />
    </div>
  );
}

function TaskColumn({
  label,
  count,
  tasks,
  emptyHint,
}: {
  label: string;
  count: number;
  tasks: TaskRowItem[];
  emptyHint: string;
}) {
  return (
    <div className="bg-[var(--color-bg-elevated)]/40 flex flex-col gap-2 rounded-xl border border-[var(--color-border)] p-3">
      <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-[var(--color-fg-muted)]">
        <span>{label}</span>
        <span className="font-mono tabular-nums text-[var(--color-fg-subtle)]">{count}</span>
      </div>
      {tasks.length === 0 ? (
        <p className="text-xs italic text-[var(--color-fg-subtle)]">{emptyHint}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {tasks.map((t) => {
            const href = t.projectId ? `/projects/${t.projectId}/tasks/${t.id}` : `/tasks/${t.id}`;
            return (
              <li key={t.id}>
                <Link
                  href={href}
                  className="block rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] p-2.5 transition hover:border-[var(--color-brand)]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="line-clamp-2 text-sm font-medium leading-tight">
                      {t.title}
                    </span>
                    <Badge variant={TASK_STATUS_TONE[t.status] ?? 'neutral'} size="xs">
                      {t.status}
                    </Badge>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-[var(--color-fg-subtle)]">
                    <span>{t.kind}</span>
                    {t.dueAt && <span>due {new Date(t.dueAt).toLocaleDateString()}</span>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

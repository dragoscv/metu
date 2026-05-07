import { auth } from '@metu/auth';
import { goalFacets, listGoalsFiltered, listTargetsFiltered } from '@metu/db/queries';
import { getDb } from '@metu/db';
import { goalCheckin } from '@metu/db/schema';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { EmptyState, Button, Page, PageHeader, PageSection } from '@metu/ui';
import { Plus, Target as TargetIcon } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { GoalsListView } from '@/components/goals/goals-list-view';
import { TargetsList } from '@/components/goals/targets-list';
import { CreateGoalForm } from '@/components/goals/create-goal-form';

export const dynamic = 'force-dynamic';

const VALID_SORT = new Set(['weight', 'progress', 'recent', 'due']);

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const sp = await searchParams;
  const param = (k: string) => {
    const v = sp[k];
    return typeof v === 'string' && v.length > 0 ? v : null;
  };
  const status = param('status');
  const drift = param('drift');
  const cadence = param('cadence');
  const sort = param('sort') ?? 'weight';
  const safeSort = (VALID_SORT.has(sort) ? sort : 'weight') as
    | 'weight'
    | 'progress'
    | 'recent'
    | 'due';
  const wsId = session.user.workspaceId;

  const [goalRows, targetRows, facets] = await Promise.all([
    listGoalsFiltered({ workspaceId: wsId, status, drift, cadence, sort: safeSort }),
    listTargetsFiltered(wsId, null),
    goalFacets(wsId),
  ]);

  // Pull check-in history for the visible goals (for sparkline + progress trace)
  const db = getDb();
  const goalIds = goalRows.map((g) => g.id);
  const checkins =
    goalIds.length > 0
      ? await db
          .select({
            goalId: goalCheckin.goalId,
            progress: goalCheckin.progress,
            occurredAt: goalCheckin.occurredAt,
          })
          .from(goalCheckin)
          .where(and(eq(goalCheckin.workspaceId, wsId), inArray(goalCheckin.goalId, goalIds)))
          .orderBy(asc(goalCheckin.occurredAt))
      : [];
  const historyByGoal = new Map<string, { t: number; v: number }[]>();
  for (const c of checkins) {
    const k = c.goalId;
    const list = historyByGoal.get(k) ?? [];
    list.push({ t: c.occurredAt.getTime(), v: c.progress });
    historyByGoal.set(k, list);
  }

  const goalsForUi = goalRows.map((g) => ({
    id: g.id,
    title: g.title,
    body: g.body,
    status: g.status,
    cadence: g.cadence,
    progressMode: g.progressMode,
    progress: g.progress,
    drift: g.drift,
    weight: g.weight,
    dueAt: g.dueAt ? g.dueAt.toISOString() : null,
    lastProgressAt: g.lastProgressAt ? g.lastProgressAt.toISOString() : null,
    parentGoalId: g.parentGoalId,
    history: historyByGoal.get(g.id) ?? [],
  }));

  const targetsForUi = targetRows.map((t) => ({
    id: t.id,
    goalId: t.goalId,
    title: t.title,
    unit: t.unit,
    targetValue: t.targetValue,
    currentValue: t.currentValue,
    period: t.period,
    status: t.status,
    aggregation: t.aggregation,
  }));

  const hasFilters = !!(status || drift || cadence);

  return (
    <Page>
      <PageHeader
        title="Goals & Targets"
        description="Qualitative outcomes and numeric KPIs the Conductor watches for drift."
      />

      <CreateGoalForm />

      <PageSection id="goals" title="Goals">
        {goalsForUi.length === 0 && hasFilters ? (
          <EmptyState
            icon={<TargetIcon className="h-5 w-5" />}
            title="No goals match"
            description="Adjust filters or clear them to see all goals."
          />
        ) : goalsForUi.length === 0 ? (
          <EmptyState
            icon={<TargetIcon className="h-5 w-5" />}
            title="No goals yet"
            description="Use the form above to add your first outcome."
            action={
              <Link href="#new-goal">
                <Button size="sm">
                  <Plus className="h-4 w-4" />
                  New goal
                </Button>
              </Link>
            }
          />
        ) : (
          <GoalsListView goals={goalsForUi} facets={facets} />
        )}
      </PageSection>

      <PageSection
        id="targets"
        title="Targets"
        actions={
          <Link href="#new-target">
            <Button variant="outline" size="sm">
              <Plus className="h-4 w-4" />
              New target
            </Button>
          </Link>
        }
      >
        <TargetsList
          targets={targetsForUi}
          goals={goalsForUi.map((g) => ({ id: g.id, title: g.title }))}
        />
      </PageSection>
    </Page>
  );
}

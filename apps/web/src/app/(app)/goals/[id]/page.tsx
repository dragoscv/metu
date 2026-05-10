import { auth } from '@metu/auth';
import {
  getGoalById,
  listGoalCheckins,
  listGoalEvidence,
  listGoalTargets,
  listSubGoals,
} from '@metu/db/queries';
import { Badge, Button, Card, Page, PageHeader, PageSection } from '@metu/ui';
import { Pencil, LayoutGrid } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { GoalDetailClient } from '@/components/goals/goal-detail-client';
import {
  BoardColumnsClient,
  type BoardSubGoal,
  type SubGoalStatus,
} from '@/components/goals/board-columns-client';

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

export default async function GoalDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const { id } = await params;
  const wsId = session.user.workspaceId;
  const g = await getGoalById(wsId, id);
  if (!g) notFound();

  const [checkins, evidence, targets, subs] = await Promise.all([
    listGoalCheckins(wsId, id, 60),
    listGoalEvidence(wsId, id),
    listGoalTargets(wsId, id),
    listSubGoals(wsId, id),
  ]);

  return (
    <Page className="mx-auto max-w-4xl">
      <PageHeader
        back={{ href: '/goals', label: 'All goals' }}
        title={g.title}
        eyebrow={
          <>
            <Badge variant={STATUS_TONE[g.status] ?? 'neutral'} size="sm">
              {g.status}
            </Badge>
            <Badge variant={DRIFT_TONE[g.drift] ?? 'success'} size="sm">
              {g.drift.replaceAll('_', ' ')}
            </Badge>
          </>
        }
        description={
          <>
            <span className="text-xs text-[var(--color-fg-subtle)]">
              {g.cadence} · {g.progressMode.replaceAll('_', ' ')} · weight {g.weight}
              {g.dueAt && ` · due ${new Date(g.dueAt).toLocaleDateString()}`}
            </span>
            {g.body && <span className="mt-1 block text-[var(--color-fg-muted)]">{g.body}</span>}
          </>
        }
        actions={
          <>
            <Link href={`/goals/${id}/board`}>
              <Button variant="outline" size="sm">
                <LayoutGrid className="h-4 w-4" />
                Board
              </Button>
            </Link>
            <Link href={`/goals/${id}/edit`}>
              <Button variant="outline" size="sm">
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
            </Link>
          </>
        }
      />

      <GoalDetailClient
        goalId={id}
        progress={g.progress}
        checkins={checkins.map((c) => ({
          id: c.id,
          progress: c.progress,
          note: c.note,
          occurredAt: c.occurredAt.toISOString(),
          createdBy: c.createdBy,
        }))}
      />

      {targets.length > 0 && (
        <PageSection title="Linked targets">
          <ul className="grid gap-3 md:grid-cols-2">
            {targets.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/goals/targets/${t.id}`}
                  className="block rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3 transition hover:border-[var(--color-brand)]"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="truncate text-sm font-medium">{t.title}</h3>
                    <span className="font-mono text-xs">
                      {t.currentValue.toLocaleString()}/{t.targetValue.toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-[var(--color-fg-subtle)]">
                    {t.period} · {t.unit || 'no unit'}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </PageSection>
      )}

      {subs.length > 0 && (
        <PageSection title="Sub-goals" description="Drag a card to change its status">
          <BoardColumnsClient subs={toBoardSubs(subs)} />
        </PageSection>
      )}

      <PageSection title="Evidence">
        {evidence.length === 0 ? (
          <Card>
            <p className="text-sm italic text-[var(--color-fg-subtle)]">
              No evidence linked. The Conductor will auto-link relevant tasks/captures, or you can
              attach them via the API.
            </p>
          </Card>
        ) : (
          <ul className="space-y-1">
            {evidence.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  <Badge variant="neutral" size="xs">
                    {e.refKind}
                  </Badge>
                  <span className="font-mono text-[11px] text-[var(--color-fg-muted)]">
                    {e.refId.slice(0, 8)}
                  </span>
                  {e.note && <span className="text-[var(--color-fg-muted)]">— {e.note}</span>}
                </div>
                <span className="text-[11px] text-[var(--color-fg-subtle)]">
                  {new Date(e.addedAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PageSection>
    </Page>
  );
}

const KNOWN_STATUS = new Set<SubGoalStatus>(['active', 'paused', 'achieved', 'dropped']);

function toBoardSubs(
  subs: Array<{
    id: string;
    title: string;
    progress: number;
    status: string;
    drift: string;
    weight: number;
    dueAt: Date | null;
  }>,
): BoardSubGoal[] {
  return subs.map((s) => ({
    id: s.id,
    title: s.title,
    progress: s.progress,
    status: KNOWN_STATUS.has(s.status as SubGoalStatus) ? (s.status as SubGoalStatus) : 'active',
    drift: s.drift,
    weight: s.weight,
    dueAt: s.dueAt ? s.dueAt.toISOString() : null,
  }));
}

import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { goal } from '@metu/db/schema';
import { getTargetById } from '@metu/db/queries';
import { and, eq, isNull } from 'drizzle-orm';
import { Page, PageHeader } from '@metu/ui';
import { notFound, redirect } from 'next/navigation';
import { TargetEditForm } from '@/components/goals/target-edit-form';

interface PageProps {
  params: Promise<{ tid: string }>;
}

export default async function TargetEditPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const { tid } = await params;
  const wsId = session.user.workspaceId;
  const t = await getTargetById(wsId, tid);
  if (!t) notFound();
  const db = getDb();
  const goalRows = await db
    .select({ id: goal.id, title: goal.title })
    .from(goal)
    .where(and(eq(goal.workspaceId, wsId), isNull(goal.deletedAt)));

  return (
    <Page className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        size="sm"
        back={{ href: `/goals/targets/${tid}`, label: t.title }}
        title="Edit target"
      />
      <TargetEditForm
        target={{
          id: t.id,
          title: t.title,
          unit: t.unit,
          targetValue: t.targetValue,
          period: t.period,
          aggregation: t.aggregation,
          status: t.status,
          goalId: t.goalId,
        }}
        goals={goalRows}
      />
    </Page>
  );
}

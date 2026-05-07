import { auth } from '@metu/auth';
import { getGoalById } from '@metu/db/queries';
import { Page, PageHeader } from '@metu/ui';
import { notFound, redirect } from 'next/navigation';
import { GoalEditForm } from '@/components/goals/goal-edit-form';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function GoalEditPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const { id } = await params;
  const g = await getGoalById(session.user.workspaceId, id);
  if (!g) notFound();

  return (
    <Page className="mx-auto max-w-2xl space-y-5">
      <PageHeader size="sm" back={{ href: `/goals/${id}`, label: g.title }} title="Edit goal" />
      <GoalEditForm
        goal={{
          id: g.id,
          title: g.title,
          body: g.body,
          status: g.status,
          cadence: g.cadence,
          progressMode: g.progressMode,
          weight: g.weight,
          dueAt: g.dueAt ? g.dueAt.toISOString() : null,
        }}
      />
    </Page>
  );
}

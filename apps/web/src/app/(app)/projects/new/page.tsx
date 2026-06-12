import { auth } from '@metu/auth';
import { getGoalById } from '@metu/db/queries';
import { Page, PageHeader } from '@metu/ui';
import { redirect } from 'next/navigation';
import { ProjectStarter } from '@/components/projects/project-starter';

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ goalId?: string }>;
}) {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const sp = await searchParams;
  const goalId = sp.goalId ?? null;
  const goal = goalId ? await getGoalById(session.user.workspaceId, goalId) : null;

  return (
    <Page className="mx-auto max-w-2xl">
      <PageHeader
        size="sm"
        back={
          goal
            ? { href: `/goals/${goal.id}/board`, label: goal.title }
            : { href: '/projects', label: 'Projects' }
        }
        title="New project"
        description={
          goal
            ? `This project will be pinned to "${goal.title}" so it shows up on the goal board.`
            : 'Most projects start from a Git repo — search, create, or paste a URL. Or start blank and link things later.'
        }
      />
      <ProjectStarter pinGoalId={goal?.id ?? null} />
    </Page>
  );
}

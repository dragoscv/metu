import { auth } from '@metu/auth';
import { getProject, getTaskById, listGoalsFiltered, listProjects } from '@metu/db/queries';
import { Page, PageHeader } from '@metu/ui';
import { notFound, redirect } from 'next/navigation';
import { TaskEditForm } from '@/components/projects/task-edit-form';

interface PageProps {
  params: Promise<{ id: string; taskId: string }>;
}

export default async function TaskDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const { id, taskId } = await params;
  const [proj, task, projects, goals] = await Promise.all([
    getProject(session.user.workspaceId, id),
    getTaskById(session.user.workspaceId, taskId),
    listProjects(session.user.workspaceId),
    listGoalsFiltered({ workspaceId: session.user.workspaceId, status: 'active' }),
  ]);
  if (!proj || !task) notFound();

  return (
    <Page className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        size="sm"
        back={{ href: `/projects/${id}#tasks`, label: proj.name }}
        eyebrow={
          <span className="text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            Task
          </span>
        }
        title={task.title}
      />
      <TaskEditForm
        task={{
          id: task.id,
          projectId: task.projectId,
          goalId: task.goalId,
          title: task.title,
          body: task.body,
          status: task.status,
          kind: task.kind,
          leverageScore: task.leverageScore,
          blockedReason: task.blockedReason,
          dueAt: task.dueAt ? task.dueAt.toISOString() : null,
        }}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        goals={goals.map((g) => ({ id: g.id, title: g.title }))}
        backHref={`/projects/${id}#tasks`}
      />
    </Page>
  );
}

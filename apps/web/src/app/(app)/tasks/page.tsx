/**
 * Tasks — workspace-wide task management. Surfaces everything the Conductor
 * (and you) create: smart sections, filters, inline status, quick-add, drawer.
 */
import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { listAllTasks, listProjects } from '@metu/db/queries';
import { Page, PageHeader } from '@metu/ui';
import { TasksClient, type TaskItem, type ProjectOption } from '@/components/tasks/tasks-client';

export default async function TasksPage() {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const workspaceId = session.user.workspaceId;

  const [rows, projects] = await Promise.all([
    listAllTasks({ workspaceId, includeDone: true }),
    listProjects(workspaceId),
  ]);

  const tasks: TaskItem[] = rows.map((t) => ({
    id: t.id,
    title: t.title,
    body: t.body ?? null,
    status: t.status,
    kind: t.kind,
    leverageScore: t.leverageScore ?? null,
    blockedReason: t.blockedReason ?? null,
    dueAt: t.dueAt ? new Date(t.dueAt).toISOString() : null,
    projectId: t.projectId ?? null,
    projectName: t.projectName ?? null,
    goalId: t.goalId ?? null,
    aiSuggested: t.aiSuggested ?? null,
    sourceApp: t.sourceApp ?? null,
    sourceUrl: t.sourceUrl ?? null,
    createdAt: t.createdAt ? new Date(t.createdAt).toISOString() : null,
    updatedAt: t.updatedAt ? new Date(t.updatedAt).toISOString() : null,
  }));

  const projectOptions: ProjectOption[] = projects.map((p) => ({ id: p.id, name: p.name }));

  return (
    <Page>
      <PageHeader
        title="Tasks"
        description="Everything you and the Conductor are tracking — across all projects."
      />
      <TasksClient tasks={tasks} projects={projectOptions} />
    </Page>
  );
}

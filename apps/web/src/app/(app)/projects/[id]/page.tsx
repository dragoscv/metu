import { auth } from '@metu/auth';
import { notFound, redirect } from 'next/navigation';
import { getProject, recentDecisions, listOpenTasks } from '@metu/db/queries';
import { Card, CardTitle, MomentumBar } from '@metu/ui';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ProjectPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const { id } = await params;
  const proj = await getProject(session.user.workspaceId, id);
  if (!proj) notFound();

  const [decisions, openTasks] = await Promise.all([
    recentDecisions(session.user.workspaceId),
    listOpenTasks(session.user.workspaceId),
  ]);
  const projectTasks = openTasks.filter((t) => t.projectId === id);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-wider text-[var(--color-fg-subtle)]">Project</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{proj.name}</h1>
        {proj.summary && <p className="mt-2 text-[var(--color-fg-muted)]">{proj.summary}</p>}
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardTitle>Momentum</CardTitle>
          <div className="mt-2 text-3xl font-semibold">
            {Math.round((proj.momentumScore ?? 0) * 100)}
          </div>
          <MomentumBar value={proj.momentumScore ?? 0} className="mt-3" />
        </Card>
        <Card className="md:col-span-2">
          <CardTitle>Pulse</CardTitle>
          <p className="mt-2 text-pretty text-sm text-[var(--color-fg)]">
            {proj.stateSummary ?? 'No pulse generated yet.'}
          </p>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardTitle>Open tasks</CardTitle>
          <ul className="mt-3 space-y-1.5 text-sm">
            {projectTasks.length === 0 && <li className="text-[var(--color-fg-subtle)]">—</li>}
            {projectTasks.map((t) => (
              <li key={t.id} className="flex items-center justify-between">
                <span>{t.title}</span>
                <span className="text-xs uppercase text-[var(--color-fg-subtle)]">{t.status}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardTitle>Recent decisions</CardTitle>
          <ul className="mt-3 space-y-2 text-sm">
            {decisions
              .filter((d) => d.projectId === id)
              .slice(0, 5)
              .map((d) => (
                <li key={d.id} className="rounded-md border border-[var(--color-border)] p-2">
                  <div className="font-medium">{d.title}</div>
                  <div className="mt-1 line-clamp-2 text-xs text-[var(--color-fg-muted)]">
                    {d.rationale}
                  </div>
                </li>
              ))}
            {decisions.filter((d) => d.projectId === id).length === 0 && (
              <li className="text-[var(--color-fg-subtle)]">—</li>
            )}
          </ul>
        </Card>
      </div>
    </div>
  );
}

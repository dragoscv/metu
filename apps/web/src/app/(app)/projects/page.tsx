import Link from 'next/link';
import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { listProjects } from '@metu/db/queries';
import { Card, CardTitle, MomentumBar } from '@metu/ui';
import { CreateProjectForm } from '@/components/create-project-form';

export default async function ProjectsPage() {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const projects = await listProjects(session.user.workspaceId);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Projects</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
          Each project has its own memory, decisions, and pulse.
        </p>
      </header>

      <CreateProjectForm />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {projects.map((p) => (
          <Link key={p.id} href={`/projects/${p.id}`}>
            <Card className="h-full transition-all hover:border-[var(--color-brand)]">
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{
                    background: (p.metadata as { color?: string })?.color ?? 'var(--color-brand)',
                  }}
                />
                <CardTitle className="!mt-0 text-base text-[var(--color-fg)]">{p.name}</CardTitle>
              </div>
              {p.summary && (
                <p className="mt-2 line-clamp-2 text-sm text-[var(--color-fg-muted)]">
                  {p.summary}
                </p>
              )}
              {p.stateSummary && (
                <p className="mt-3 line-clamp-3 text-xs text-[var(--color-fg-subtle)]">
                  {p.stateSummary}
                </p>
              )}
              <div className="mt-4">
                <MomentumBar value={p.momentumScore ?? 0} label="momentum" />
              </div>
            </Card>
          </Link>
        ))}
        {projects.length === 0 && (
          <p className="text-sm text-[var(--color-fg-subtle)]">
            No projects yet. Create your first above.
          </p>
        )}
      </div>
    </div>
  );
}

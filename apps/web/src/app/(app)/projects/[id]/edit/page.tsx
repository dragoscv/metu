import { auth } from '@metu/auth';
import { getProject, listGoalsFiltered, listProjectLinks } from '@metu/db/queries';
import { Page, PageHeader } from '@metu/ui';
import { notFound, redirect } from 'next/navigation';
import { ProjectFullForm } from '@/components/projects/project-full-form';

interface PageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = 'force-dynamic';

export default async function ProjectEditPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const { id } = await params;
  const proj = await getProject(session.user.workspaceId, id);
  if (!proj) notFound();
  const meta = (proj.metadata ?? {}) as { color?: string; stack?: string[] };
  const [links, goals] = await Promise.all([
    listProjectLinks(session.user.workspaceId, id),
    listGoalsFiltered({ workspaceId: session.user.workspaceId, status: 'active' }),
  ]);

  return (
    <Page className="mx-auto max-w-3xl">
      <PageHeader
        size="sm"
        back={{ href: `/projects/${id}`, label: proj.name }}
        title="Edit project"
        description="Update identity, status, stack, and links."
      />
      <ProjectFullForm
        project={{
          id: proj.id,
          name: proj.name,
          slug: proj.slug,
          summary: proj.summary,
          stateSummary: proj.stateSummary,
          status: proj.status as 'active' | 'paused' | 'archived' | 'killed',
          color: meta.color ?? null,
          stack: Array.isArray(meta.stack) ? meta.stack : [],
          goalId: proj.goalId ?? null,
          createdAt: proj.createdAt ? proj.createdAt.toISOString() : null,
        }}
        links={links.map((l) => ({
          id: l.id,
          provider: l.provider,
          kind: l.kind,
          title: l.title,
          url: l.url,
          metadata: (l.metadata ?? {}) as Record<string, unknown>,
          addedAt: l.addedAt ? l.addedAt.toISOString() : new Date().toISOString(),
        }))}
        goals={goals.map((g) => ({ id: g.id, title: g.title }))}
      />
    </Page>
  );
}

import { auth } from '@metu/auth';
import { getDecisionById, getProject } from '@metu/db/queries';
import { Page, PageHeader } from '@metu/ui';
import { notFound, redirect } from 'next/navigation';
import { DecisionEditForm } from '@/components/projects/decision-edit-form';

interface PageProps {
  params: Promise<{ id: string; decisionId: string }>;
}

export default async function DecisionDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const { id, decisionId } = await params;
  const [proj, dec] = await Promise.all([
    getProject(session.user.workspaceId, id),
    getDecisionById(session.user.workspaceId, decisionId),
  ]);
  if (!proj || !dec) notFound();

  return (
    <Page className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        size="sm"
        back={{ href: `/projects/${id}#decisions`, label: proj.name }}
        eyebrow={
          <span className="text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            Decision · {dec.decidedAt ? new Date(dec.decidedAt).toLocaleString() : 'unknown date'}
          </span>
        }
        title={dec.title}
      />
      <DecisionEditForm
        decision={{
          id: dec.id,
          title: dec.title,
          rationale: dec.rationale,
          alternatives: (dec.alternatives ?? []) as { name: string; reason?: string }[],
        }}
        backHref={`/projects/${id}#decisions`}
      />
    </Page>
  );
}

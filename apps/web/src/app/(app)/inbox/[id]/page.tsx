import { auth } from '@metu/auth';
import { getCaptureById, listProjects } from '@metu/db/queries';
import { notFound, redirect } from 'next/navigation';
import { CaptureDetail } from '@/components/inbox/capture-detail';

export default async function CaptureDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const { id } = await params;
  const [row, projects] = await Promise.all([
    getCaptureById(session.user.workspaceId, id),
    listProjects(session.user.workspaceId),
  ]);
  if (!row) notFound();

  return (
    <CaptureDetail
      capture={{
        id: row.id,
        kind: row.kind,
        status: row.status,
        content: row.content,
        sourceUrl: row.sourceUrl,
        source: row.source,
        capturedAt: row.capturedAt.toISOString(),
        metadata: (row.metadata ?? {}) as Record<string, unknown>,
        projectId: row.projectId,
        storageKey: row.storageKey,
      }}
      projects={projects.map((p) => ({ id: p.id, name: p.name }))}
    />
  );
}

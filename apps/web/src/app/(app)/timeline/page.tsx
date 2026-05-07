import { auth } from '@metu/auth';
import {
  listTimelineFiltered,
  listTimelineProjectsForFilter,
  timelineKindFacets,
} from '@metu/db/queries';
import { redirect } from 'next/navigation';
import { Page, PageHeader } from '@metu/ui';
import { TimelineList } from '@/components/timeline/timeline-list';
import { TimelineToolbar } from '@/components/timeline/timeline-toolbar';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    kinds?: string;
    projectId?: string;
    since?: string;
    q?: string;
  }>;
}

function parseSince(since: string | undefined): Date | null {
  if (!since) return null;
  const m = since.match(/^(\d+)d$/);
  if (!m) return null;
  return new Date(Date.now() - Number(m[1]) * 24 * 60 * 60 * 1000);
}

export default async function TimelinePage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const wsId = session.user.workspaceId;
  const sp = await searchParams;
  const kinds = sp.kinds ? sp.kinds.split(',').filter(Boolean) : [];
  const since = parseSince(sp.since);

  const [{ items, nextCursor }, kindFacets, projects] = await Promise.all([
    listTimelineFiltered({
      workspaceId: wsId,
      kinds: kinds.length > 0 ? kinds : undefined,
      projectId: sp.projectId || undefined,
      since,
      search: sp.q || undefined,
      limit: 40,
    }),
    timelineKindFacets(wsId),
    listTimelineProjectsForFilter(wsId),
  ]);

  const initialItems = items.map((e) => ({
    id: e.id,
    kind: e.kind,
    title: e.title,
    body: e.body,
    payload: (e.payload ?? {}) as Record<string, unknown>,
    importance: e.importance,
    occurredAt: e.occurredAt.toISOString(),
    projectId: e.projectId,
  }));

  return (
    <Page className="space-y-5">
      <PageHeader
        title="Timeline"
        description="Episodic memory. Every meaningful event, in order."
      />

      <TimelineToolbar kindFacets={kindFacets} projects={projects} />

      <TimelineList initialItems={initialItems} initialCursor={nextCursor} />
    </Page>
  );
}

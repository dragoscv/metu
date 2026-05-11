import { auth } from '@metu/auth';
import {
  listTimelineFiltered,
  listTimelineProjectsForFilter,
  timelineKindFacets,
} from '@metu/db/queries';
import { redirect } from 'next/navigation';
import { EmptyState, Page, PageHeader } from '@metu/ui';
import { Activity } from 'lucide-react';
import Link from 'next/link';
import { TimelineList } from '@/components/timeline/timeline-list';
import { TimelineToolbar } from '@/components/timeline/timeline-toolbar';

const BTN_PRIMARY =
  'inline-flex h-8 items-center gap-2 rounded-md bg-[var(--color-brand)] px-3 text-sm font-medium text-[var(--color-brand-fg)] hover:opacity-90';

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

      {initialItems.length === 0 && kinds.length === 0 && !sp.projectId && !sp.q && !since ? (
        <EmptyState
          icon={<Activity className="h-5 w-5" />}
          title="No timeline events yet"
          description="Captures, tool calls, decisions, and recall searches all flow into this view. Drop a thought in the inbox to get started."
          action={
            <Link href="/inbox" className={BTN_PRIMARY}>
              Go to inbox
            </Link>
          }
        />
      ) : (
        <TimelineList initialItems={initialItems} initialCursor={nextCursor} />
      )}
    </Page>
  );
}

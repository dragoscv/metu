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
import { TimelineTopSources } from '@/components/timeline/timeline-top-sources';
import { KeyboardFocus } from '@/components/keyboard-focus';

const BTN_PRIMARY =
  'inline-flex h-8 items-center gap-2 rounded-md bg-[var(--color-brand)] px-3 text-sm font-medium text-[var(--color-brand-fg)] hover:opacity-90';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    kinds?: string;
    projectId?: string;
    since?: string;
    q?: string;
    tag?: string;
  }>;
}

function parseSince(since: string | undefined): Date | null {
  if (!since) return null;
  if (since === 'today') {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
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
      tag: sp.tag || undefined,
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

      <TimelineTopSources workspaceId={wsId} />

      <div className="flex flex-wrap gap-1.5">
        {[
          { label: 'All time', value: '' },
          { label: 'Today', value: 'today' },
          { label: 'Last 7d', value: '7d' },
          { label: 'Last 30d', value: '30d' },
        ].map((c) => {
          const active = (sp.since ?? '') === c.value;
          const params = new URLSearchParams();
          if (sp.kinds) params.set('kinds', sp.kinds);
          if (sp.projectId) params.set('projectId', sp.projectId);
          if (sp.q) params.set('q', sp.q);
          if (sp.tag) params.set('tag', sp.tag);
          if (c.value) params.set('since', c.value);
          const qs = params.toString();
          return (
            <Link
              key={c.label}
              href={qs ? `/timeline?${qs}` : '/timeline'}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                active
                  ? 'bg-[var(--color-brand)]/10 border-[var(--color-brand)] text-[var(--color-brand)]'
                  : 'border-[var(--color-border)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-overlay)]'
              }`}
            >
              {c.label}
            </Link>
          );
        })}
      </div>

      <TimelineToolbar kindFacets={kindFacets} projects={projects} />
      <KeyboardFocus targetId="timeline-search" />

      {sp.tag && (
        <div className="-mt-2 flex items-center gap-2 text-xs">
          <span className="text-[var(--color-fg-subtle)]">Filtered by tag</span>
          <Link
            href={(() => {
              const params = new URLSearchParams();
              if (sp.kinds) params.set('kinds', sp.kinds);
              if (sp.projectId) params.set('projectId', sp.projectId);
              if (sp.since) params.set('since', sp.since);
              if (sp.q) params.set('q', sp.q);
              const qs = params.toString();
              return qs ? `/timeline?${qs}` : '/timeline';
            })()}
            className="bg-[var(--color-brand)]/10 inline-flex items-center gap-1 rounded-full border border-[var(--color-brand)] px-2.5 py-1 text-[var(--color-brand)]"
            title="Clear tag filter"
          >
            #{sp.tag} ✕
          </Link>
        </div>
      )}

      {(kinds.length > 0 || sp.projectId || sp.q || sp.since || sp.tag) && (
        <div className="-mt-2 flex justify-end text-xs">
          <Link
            href="/timeline"
            className="text-[var(--color-fg-subtle)] hover:text-[var(--color-brand)] hover:underline"
          >
            Reset filters
          </Link>
        </div>
      )}

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

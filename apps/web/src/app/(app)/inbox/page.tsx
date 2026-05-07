import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { captureFacets, listCaptures, listProjects } from '@metu/db/queries';
import { Badge, EmptyState, Page, PageHeader, PageSection } from '@metu/ui';
import { Inbox } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { BrainDump } from '@/components/brain-dump';
import { ImportConversations } from '@/components/import-conversations';
import { CaptureList, type CaptureListItem } from '@/components/inbox/capture-list';
import { InboxFilters } from '@/components/inbox/inbox-filters';

export const dynamic = 'force-dynamic';

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const sp = await searchParams;
  const param = (k: string) => {
    const v = sp[k];
    return typeof v === 'string' && v.length > 0 ? v : null;
  };

  const [page, projects, facets] = await Promise.all([
    listCaptures({
      workspaceId: session.user.workspaceId,
      limit: 30,
      cursor: param('before'),
      kind: param('kind'),
      status: param('status'),
      source: param('source'),
      search: param('q'),
    }),
    listProjects(session.user.workspaceId),
    captureFacets(session.user.workspaceId),
  ]);

  const projectMap = new Map(projects.map((p) => [p.id, p.name] as const));
  const items: CaptureListItem[] = page.rows.map((c) => ({
    id: c.id,
    kind: c.kind,
    status: c.status,
    content: c.content,
    sourceUrl: c.sourceUrl,
    source: c.source,
    capturedAt: c.capturedAt.toISOString(),
    metadata: (c.metadata ?? {}) as Record<string, unknown>,
    projectId: c.projectId,
    projectName: c.projectId ? (projectMap.get(c.projectId) ?? null) : null,
  }));

  const totalCount = facets.kinds.reduce((s, k) => s + k.count, 0);
  const hasFilters = !!(param('q') || param('kind') || param('status') || param('source'));

  const loadOlderHref = page.nextCursor
    ? `/inbox?${new URLSearchParams(
        Object.fromEntries(
          Object.entries({
            q: param('q'),
            kind: param('kind'),
            status: param('status'),
            source: param('source'),
            before: page.nextCursor,
          }).filter(([, v]) => v !== null),
        ) as Record<string, string>,
      ).toString()}`
    : null;

  return (
    <Page>
      <PageHeader
        title="Brain dump"
        description="Universal inbox. Type, paste, record. metu sorts later."
        actions={
          <Badge variant="neutral" size="sm">
            {totalCount} total
          </Badge>
        }
      />

      <BrainDump />

      <ImportConversations projects={projects.map((p) => ({ id: p.id, name: p.name }))} />

      <PageSection>
        <Suspense fallback={null}>
          <InboxFilters facets={facets} totalCount={items.length} />
        </Suspense>
        {items.length === 0 && hasFilters ? (
          <EmptyState
            icon={<Inbox className="h-5 w-5" />}
            title="No captures match"
            description="Adjust filters or clear them to see everything."
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-5 w-5" />}
            title="Nothing captured yet"
            description="Use the input above to start your second brain."
          />
        ) : (
          <CaptureList captures={items} />
        )}
        {loadOlderHref ? (
          <div className="flex justify-center">
            <Link
              href={loadOlderHref}
              className="inline-flex h-9 items-center rounded-[var(--radius)] bg-[var(--color-bg-elevated)] px-4 text-sm font-medium text-[var(--color-fg)] transition-colors hover:bg-[var(--color-bg-card)]"
            >
              Load older
            </Link>
          </div>
        ) : null}
      </PageSection>
    </Page>
  );
}

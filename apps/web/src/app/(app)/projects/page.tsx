import { auth } from '@metu/auth';
import {
  listAvailableStackTags,
  listProjectsCounts,
  listProjectsFiltered,
  listProjectsLinkSummary,
  projectStatusFacets,
} from '@metu/db/queries';
import { Badge, EmptyState, Page, PageHeader } from '@metu/ui';
import { FolderKanban, Plus } from 'lucide-react';
import Link from 'next/link';

const BTN_PRIMARY =
  'inline-flex h-8 items-center gap-2 rounded-md bg-[var(--color-brand)] px-3 text-sm font-medium text-[var(--color-brand-fg)] hover:opacity-90';
import { redirect } from 'next/navigation';
import { ProjectsGrid } from '@/components/projects/projects-grid';
import { ProjectsToolbar } from '@/components/projects/projects-toolbar';
import { SeedDemoButton } from '@/components/dashboard/seed-demo-button';

export const dynamic = 'force-dynamic';

const VALID_SORT = new Set(['momentum', 'name', 'recent']);
const VALID_ACTIVITY = new Set(['today', 'week', 'month', 'stale']);

function asString(v: string | string[] | undefined): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function asList(v: string | string[] | undefined): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.flatMap((x) => x.split(',')).filter(Boolean);
  return v.split(',').filter(Boolean);
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const sp = await searchParams;
  const status = asString(sp.status);
  const sort = (asString(sp.sort) ?? 'momentum') as 'momentum' | 'name' | 'recent';
  const safeSort = VALID_SORT.has(sort) ? sort : 'momentum';
  const search = asString(sp.q);
  const hasLinkRaw = asString(sp.hasLink);
  const hasLink = hasLinkRaw === 'yes' ? true : hasLinkRaw === 'no' ? false : undefined;
  const linkProviders = asList(sp.linkProviders);
  const stack = asList(sp.stack);
  const lastActivityRaw = asString(sp.lastActivity);
  const lastActivity =
    lastActivityRaw && VALID_ACTIVITY.has(lastActivityRaw)
      ? (lastActivityRaw as 'today' | 'week' | 'month' | 'stale')
      : undefined;
  const hasOpenTasks = sp.hasOpenTasks === 'yes' ? true : undefined;
  const hasBlockedTasks = sp.hasBlockedTasks === 'yes' ? true : undefined;
  const hasGoal = sp.hasGoal === 'yes' ? true : undefined;

  const hasFilters =
    status !== null ||
    !!search ||
    hasLink !== undefined ||
    linkProviders.length > 0 ||
    stack.length > 0 ||
    lastActivity !== undefined ||
    hasOpenTasks !== undefined ||
    hasBlockedTasks !== undefined ||
    hasGoal !== undefined;

  const [projects, facets, availableStack] = await Promise.all([
    listProjectsFiltered({
      workspaceId: session.user.workspaceId,
      status,
      sort: safeSort,
      includeArchived: status !== null,
      search,
      hasLink,
      linkProviders: linkProviders.length > 0 ? linkProviders : undefined,
      stack: stack.length > 0 ? stack : undefined,
      lastActivity,
      hasOpenTasks,
      hasBlockedTasks,
      hasGoal,
    }),
    projectStatusFacets(session.user.workspaceId),
    listAvailableStackTags(session.user.workspaceId),
  ]);

  const ids = projects.map((p) => p.id);
  const [linkSummary, counts] = await Promise.all([
    listProjectsLinkSummary(session.user.workspaceId, ids),
    listProjectsCounts(session.user.workspaceId, ids),
  ]);

  const total = facets.reduce((s, f) => s + f.count, 0);

  return (
    <Page>
      <PageHeader
        title="Projects"
        description="Each project has its own memory, decisions, links, and pulse."
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="neutral" size="sm">
              {total} total
            </Badge>
            <Link href="/projects/new" className={BTN_PRIMARY}>
              <Plus className="h-4 w-4" />
              New project
            </Link>
          </div>
        }
      />

      <ProjectsToolbar
        facets={facets}
        resultCount={projects.length}
        availableStack={availableStack}
      />

      {projects.length === 0 && hasFilters ? (
        <EmptyState
          icon={<FolderKanban className="h-5 w-5" />}
          title="No projects match"
          description="Try a different filter combination or clear them."
        />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<FolderKanban className="h-5 w-5" />}
          title="No projects yet"
          description="Create your first project, or seed a sample one so you can poke around."
          action={
            <div className="flex items-center gap-2">
              <Link href="/projects/new" className={BTN_PRIMARY}>
                <Plus className="h-4 w-4" />
                New project
              </Link>
              <SeedDemoButton />
            </div>
          }
        />
      ) : (
        <ProjectsGrid
          projects={projects.map((p) => {
            const c = counts.get(p.id) ?? { openTasks: 0, blockedTasks: 0, goals: 0 };
            return {
              id: p.id,
              name: p.name,
              slug: p.slug,
              summary: p.summary,
              stateSummary: p.stateSummary,
              status: p.status,
              momentumScore: p.momentumScore ?? 0,
              lastMeaningfulActivityAt: p.lastMeaningfulActivityAt
                ? p.lastMeaningfulActivityAt.toISOString()
                : null,
              color: ((p.metadata as { color?: string })?.color ?? null) as string | null,
              stack: ((p.metadata as { stack?: unknown })?.stack as string[] | undefined) ?? null,
              links: linkSummary.get(p.id) ?? [],
              openTasks: c.openTasks,
              blockedTasks: c.blockedTasks,
              goals: c.goals,
            };
          })}
        />
      )}
    </Page>
  );
}

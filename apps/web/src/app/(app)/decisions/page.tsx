/**
 * /decisions — cross-project decision log.
 *
 * Every decision the user (or Conductor via `propose_decision`) records
 * across all projects, searchable + filterable. Surfaced separately from
 * the per-project view because over time the meta-pattern of decisions
 * is itself a navigation aid.
 */
import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { ScrollText, ArrowRight } from 'lucide-react';
import { Page, PageHeader, Card, Badge, cn } from '@metu/ui';
import { getDb } from '@metu/db';
import { decision, project } from '@metu/db/schema';
import { formatDistanceToNow } from 'date-fns';
import { DecisionForm } from './decision-form';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ q?: string; projectId?: string }>;
}

export default async function DecisionsPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect('/sign-in');

  const sp = await searchParams;
  const q = sp.q?.trim() ?? '';
  const projectFilter = sp.projectId?.trim() ?? '';
  const workspaceId = session.user.workspaceId;
  const db = getDb();

  const conditions = [
    eq(decision.workspaceId, workspaceId),
    isNull(decision.deletedAt),
    q.length > 0
      ? or(ilike(decision.title, `%${q}%`), ilike(decision.rationale, `%${q}%`))
      : undefined,
    projectFilter.length > 0 ? eq(decision.projectId, projectFilter) : undefined,
  ].filter(Boolean);

  const rows = await db
    .select({
      id: decision.id,
      title: decision.title,
      rationale: decision.rationale,
      alternatives: decision.alternatives,
      projectId: decision.projectId,
      projectName: project.name,
      decidedAt: decision.decidedAt,
    })
    .from(decision)
    .leftJoin(project, eq(decision.projectId, project.id))
    .where(and(...conditions))
    .orderBy(desc(decision.decidedAt))
    .limit(100);

  const projectCounts = await db
    .select({
      projectId: decision.projectId,
      projectName: project.name,
      count: sql<number>`count(*)::int`,
    })
    .from(decision)
    .leftJoin(project, eq(decision.projectId, project.id))
    .where(and(eq(decision.workspaceId, workspaceId), isNull(decision.deletedAt)))
    .groupBy(decision.projectId, project.name)
    .orderBy(desc(sql`count(*)`))
    .limit(10);

  // Active projects for the inline form's dropdown.
  const projectsForForm = await db
    .select({ id: project.id, name: project.name })
    .from(project)
    .where(
      and(
        eq(project.workspaceId, workspaceId),
        isNull(project.deletedAt),
        eq(project.status, 'active'),
      ),
    )
    .orderBy(desc(project.lastMeaningfulActivityAt))
    .limit(50);

  return (
    <Page className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <ScrollText className="h-3.5 w-3.5" />
            Decision log
          </span>
        }
        title="Decisions"
        description="Why you (or the Conductor) chose what you chose. Searchable across every project."
      />

      <form className="mb-4" action="/decisions" method="get">
        {projectFilter ? <input type="hidden" name="projectId" value={projectFilter} /> : null}
        <input
          name="q"
          defaultValue={q}
          placeholder="Search title or rationale…"
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]"
        />
      </form>

      <DecisionForm projects={projectsForForm} />

      {projectCounts.length > 0 ? (
        <div className="mb-4 flex flex-wrap gap-1.5">
          <Link
            href={q ? `/decisions?q=${encodeURIComponent(q)}` : '/decisions'}
            className={cn(
              'rounded-full border px-2.5 py-1 text-xs transition-colors',
              !projectFilter
                ? 'bg-[var(--color-brand)]/10 border-[var(--color-brand)] text-[var(--color-brand)]'
                : 'border-[var(--color-border)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-overlay)]',
            )}
          >
            All projects
          </Link>
          {projectCounts.map((p) => {
            if (!p.projectId) return null;
            const href = `/decisions?projectId=${p.projectId}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
            const active = projectFilter === p.projectId;
            return (
              <Link
                key={p.projectId}
                href={href}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs transition-colors',
                  active
                    ? 'bg-[var(--color-brand)]/10 border-[var(--color-brand)] text-[var(--color-brand)]'
                    : 'border-[var(--color-border)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-overlay)]',
                )}
              >
                {p.projectName ?? 'Untitled'} · {p.count}
              </Link>
            );
          })}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <Card className="text-sm text-[var(--color-fg-muted)]">
          {q || projectFilter
            ? 'No decisions match those filters.'
            : 'No decisions logged yet. Use /decision in the Conductor or the propose_decision tool to record one.'}
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((d) => {
            const alternatives = Array.isArray(d.alternatives)
              ? (d.alternatives as Array<{ title?: string; reason?: string } | string>)
              : [];
            return (
              <Card key={d.id} className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span>{d.title}</span>
                      {d.projectName ? (
                        <Badge variant="neutral">{d.projectName}</Badge>
                      ) : (
                        <Badge variant="neutral">Workspace</Badge>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-[var(--color-fg-muted)]">
                      {d.rationale}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-[var(--color-fg-subtle)]">
                    {formatDistanceToNow(new Date(d.decidedAt), { addSuffix: true })}
                  </span>
                </div>
                {alternatives.length > 0 ? (
                  <details className="text-xs text-[var(--color-fg-muted)]">
                    <summary className="cursor-pointer select-none text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]">
                      {alternatives.length} alternative{alternatives.length === 1 ? '' : 's'}{' '}
                      considered
                    </summary>
                    <ul className="mt-2 space-y-1 pl-3">
                      {alternatives.map((a, i) => (
                        <li key={i} className="list-disc">
                          {typeof a === 'string' ? a : (a?.title ?? JSON.stringify(a))}
                          {typeof a === 'object' && a?.reason ? (
                            <span className="text-[var(--color-fg-subtle)]"> — {a.reason}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {d.projectId ? (
                  <Link
                    href={`/projects/${d.projectId}`}
                    className="inline-flex items-center gap-1 text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-brand)]"
                  >
                    Go to project <ArrowRight className="h-3 w-3" />
                  </Link>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </Page>
  );
}

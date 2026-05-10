import { auth } from '@metu/auth';
import { notFound, redirect } from 'next/navigation';
import {
  getProject,
  listCaptures,
  listGithubRepoStatsForProject,
  listProjectDecisions,
  listProjectLinks,
  listProjectTasks,
} from '@metu/db/queries';
import {
  Badge,
  Card,
  CardTitle,
  EmptyState,
  MomentumBar,
  Page,
  PageHeader,
  PageSection,
} from '@metu/ui';
import { Pencil, ListTodo, Lightbulb, Link2, Github, Inbox } from 'lucide-react';
import Link from 'next/link';
import { TaskRow } from '@/components/projects/task-row';
import { AddTaskInline } from '@/components/projects/add-task-inline';
import { DecisionCard } from '@/components/projects/decision-card';
import { CreateDecisionForm } from '@/components/create-decision-form';
import { LinkedResourcesPanel } from '@/components/projects/linked-resources-panel';
import { GitHubActivityPanel } from '@/components/projects/github-activity-panel';
import { ContinuityCard } from '@/components/projects/continuity-card';
import { ProjectArchiveButton } from '@/components/projects/project-archive-button';
import { getLatestBriefing } from '@/app/actions/continuity';

interface PageProps {
  params: Promise<{ id: string }>;
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral' | 'danger'> = {
  active: 'success',
  paused: 'warning',
  archived: 'neutral',
  killed: 'danger',
};

export default async function ProjectPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const { id } = await params;
  const proj = await getProject(session.user.workspaceId, id);
  if (!proj) notFound();

  const [tasks, decisions, links, githubStats, briefing, captures] = await Promise.all([
    listProjectTasks(session.user.workspaceId, id),
    listProjectDecisions(session.user.workspaceId, id),
    listProjectLinks(session.user.workspaceId, id),
    listGithubRepoStatsForProject(session.user.workspaceId, id),
    getLatestBriefing(id),
    listCaptures({ workspaceId: session.user.workspaceId, projectId: id, limit: 8 }),
  ]);
  const openTasks = tasks.filter((t) => t.status !== 'done' && t.status !== 'dropped');
  const doneTasks = tasks.filter((t) => t.status === 'done');
  const meta = (proj.metadata ?? {}) as { color?: string; stack?: string[] };

  return (
    <Page>
      <PageHeader
        back={{ href: '/projects', label: 'All projects' }}
        accent={
          <span
            aria-hidden
            className="h-3 w-3 shrink-0 rounded-full"
            style={{ background: meta.color ?? 'var(--color-brand)' }}
          />
        }
        title={proj.name}
        eyebrow={
          <Badge variant={STATUS_TONE[proj.status] ?? 'neutral'} size="sm">
            {proj.status}
          </Badge>
        }
        description={proj.summary ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            <ProjectArchiveButton projectId={id} status={proj.status} />
            <Link
              href={`/projects/${id}/edit`}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 text-sm hover:bg-[var(--color-bg-elevated)]"
            >
              <Pencil className="h-4 w-4" />
              Edit
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardTitle>Momentum</CardTitle>
          <div className="mt-2 text-3xl font-semibold tabular-nums">
            {Math.round((proj.momentumScore ?? 0) * 100)}
          </div>
          <MomentumBar value={proj.momentumScore ?? 0} className="mt-3" />
          {proj.lastMeaningfulActivityAt && (
            <p className="mt-2 text-[11px] text-[var(--color-fg-subtle)]">
              Last activity{' '}
              {new Date(proj.lastMeaningfulActivityAt).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
            </p>
          )}
        </Card>
        <Card className="md:col-span-2">
          <CardTitle>Pulse</CardTitle>
          <p className="mt-2 text-pretty text-sm text-[var(--color-fg)]">
            {proj.stateSummary ?? (
              <span className="italic text-[var(--color-fg-subtle)]">
                No pulse generated yet — capture some context or log a decision.
              </span>
            )}
          </p>
        </Card>
      </div>

      <ContinuityCard projectId={id} initial={briefing} />

      <PageSection
        id="links"
        icon={<Link2 className="h-4 w-4" />}
        title={
          <span className="flex items-center gap-2">
            Links
            <Badge variant="neutral" size="xs">
              {links.length}
            </Badge>
          </span>
        }
      >
        <LinkedResourcesPanel
          editHref={`/projects/${id}/edit`}
          links={links.map((l) => ({
            id: l.id,
            provider: l.provider,
            kind: l.kind,
            title: l.title,
            url: l.url,
            metadata: (l.metadata ?? {}) as Record<string, unknown>,
          }))}
        />
      </PageSection>

      {links.some((l) => l.provider === 'github' && l.kind === 'repo') && (
        <PageSection
          id="github"
          icon={<Github className="h-4 w-4" />}
          title={
            <span className="flex items-center gap-2">
              GitHub activity
              <Badge variant="neutral" size="xs">
                {githubStats.length}
              </Badge>
            </span>
          }
        >
          <GitHubActivityPanel stats={githubStats} projectId={id} />
        </PageSection>
      )}

      <PageSection
        id="tasks"
        icon={<ListTodo className="h-4 w-4" />}
        title={
          <span className="flex items-center gap-2">
            Tasks
            <Badge variant="neutral" size="xs">
              {openTasks.length} open
            </Badge>
            {doneTasks.length > 0 && (
              <Badge variant="success" size="xs">
                {doneTasks.length} done
              </Badge>
            )}
          </span>
        }
      >
        <AddTaskInline projectId={id} />
        {openTasks.length === 0 && doneTasks.length === 0 ? (
          <EmptyState
            icon={<ListTodo className="h-5 w-5" />}
            title="No tasks yet"
            description="Add the first task above. Press Enter to save."
            size="sm"
          />
        ) : (
          <ul className="space-y-2">
            {openTasks.map((t, i) => (
              <TaskRow
                key={t.id}
                index={i}
                href={`/projects/${id}/tasks/${t.id}`}
                task={{
                  id: t.id,
                  title: t.title,
                  status: t.status,
                  kind: t.kind,
                  leverageScore: t.leverageScore,
                  blockedReason: t.blockedReason,
                  dueAt: t.dueAt ? t.dueAt.toISOString() : null,
                  sourceApp: t.sourceApp,
                  sourceUrl: t.sourceUrl,
                }}
              />
            ))}
            {doneTasks.length > 0 && (
              <details className="bg-[var(--color-bg-card)]/50 group rounded-lg border border-[var(--color-border)]">
                <summary className="cursor-pointer list-none px-3 py-2 text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">
                  Show {doneTasks.length} completed
                </summary>
                <ul className="space-y-2 p-2">
                  {doneTasks.map((t, i) => (
                    <TaskRow
                      key={t.id}
                      index={i}
                      href={`/projects/${id}/tasks/${t.id}`}
                      task={{
                        id: t.id,
                        title: t.title,
                        status: t.status,
                        kind: t.kind,
                        leverageScore: t.leverageScore,
                        blockedReason: t.blockedReason,
                        dueAt: t.dueAt ? t.dueAt.toISOString() : null,
                        sourceApp: t.sourceApp,
                        sourceUrl: t.sourceUrl,
                      }}
                    />
                  ))}
                </ul>
              </details>
            )}
          </ul>
        )}
      </PageSection>

      <PageSection
        id="captures"
        icon={<Inbox className="h-4 w-4" />}
        title={
          <span className="flex items-center gap-2">
            Recent captures
            <Badge variant="neutral" size="xs">
              {captures.rows.length}
            </Badge>
          </span>
        }
      >
        {captures.rows.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-5 w-5" />}
            title="Nothing captured for this project yet"
            description="When you capture a thought, link, or note tied to this project, it shows up here."
            size="sm"
          />
        ) : (
          <ul className="space-y-2">
            {captures.rows.map((c) => {
              const preview = (c.content ?? '').trim().slice(0, 240);
              return (
                <li
                  key={c.id}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3"
                >
                  <div className="mb-1 flex items-center gap-2 text-[11px] text-[var(--color-fg-subtle)]">
                    <Badge variant="neutral" size="xs">
                      {c.kind}
                    </Badge>
                    <span>
                      {new Date(c.capturedAt).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                    {c.source ? <span className="truncate">· {c.source}</span> : null}
                  </div>
                  {preview ? (
                    <p className="line-clamp-3 whitespace-pre-wrap text-pretty text-sm text-[var(--color-fg)]">
                      {preview}
                      {(c.content ?? '').length > preview.length ? '…' : ''}
                    </p>
                  ) : c.sourceUrl ? (
                    <a
                      href={c.sourceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-sm text-[var(--color-brand)] underline-offset-2 hover:underline"
                    >
                      {c.sourceUrl}
                    </a>
                  ) : (
                    <p className="text-sm italic text-[var(--color-fg-subtle)]">No content</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </PageSection>

      <PageSection
        id="decisions"
        icon={<Lightbulb className="h-4 w-4" />}
        title={
          <span className="flex items-center gap-2">
            Decisions
            <Badge variant="neutral" size="xs">
              {decisions.length}
            </Badge>
          </span>
        }
      >
        <CreateDecisionForm projectId={id} />
        {decisions.length === 0 ? (
          <EmptyState
            icon={<Lightbulb className="h-5 w-5" />}
            title="No decisions logged"
            description="Capture trade-offs, alternatives, and rationale as they happen."
            size="sm"
          />
        ) : (
          <ul className="space-y-2">
            {decisions.map((d, i) => (
              <DecisionCard
                key={d.id}
                index={i}
                href={`/projects/${id}/decisions/${d.id}`}
                decision={{
                  id: d.id,
                  title: d.title,
                  rationale: d.rationale,
                  decidedAt: d.decidedAt ? d.decidedAt.toISOString() : null,
                }}
              />
            ))}
          </ul>
        )}
      </PageSection>
    </Page>
  );
}

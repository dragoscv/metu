/**
 * /restore — explicit "I'm back, catch me up" wizard.
 *
 * Distinct from /resume (which is a passive surface). This page is the
 * active form of the north star: I tell metu I just got back, it asks me
 * which window, then walks me through:
 *   1. What you'd remember if you hadn't been gone (auto-summary).
 *   2. The one smallest thing to do next.
 *   3. A "show me what I missed" expandable.
 *
 * Phase 1 (this commit): server-rendered, deterministic — pulls the
 * most-recent briefing, top blocked tasks, and the highest-momentum
 * project. The Conductor narrative is the most-recent assistant message
 * in the Conductor thread.
 *
 * Phase 2 (future): "Generate fresh briefing" button that fires
 * `briefing.generate` + waits.
 */
import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { and, desc, eq, gte, isNull, sql, ne } from 'drizzle-orm';
import { ArrowRight, Coffee, Clock, AlertOctagon, ChevronDown, Sparkles } from 'lucide-react';
import { Page, PageHeader, PageSection, Card, CardTitle, Badge } from '@metu/ui';
import { getDb } from '@metu/db';
import { conversation, message, project, task, timelineEvent } from '@metu/db/schema';
import { listRecentBriefings } from '@metu/db/queries';
import { formatDistanceToNow } from 'date-fns';
import { GenerateBriefingButton } from '@/components/generate-briefing-button';

const WINDOWS = [
  { key: 'today', label: 'A few hours', hours: 8 },
  { key: 'yesterday', label: 'A day or two', hours: 48 },
  { key: 'week', label: 'A week', hours: 24 * 7 },
  { key: 'long', label: 'Longer than that', hours: 24 * 30 },
] as const;

type WindowKey = (typeof WINDOWS)[number]['key'];

interface PageProps {
  searchParams: Promise<{ window?: string }>;
}

function parseWindow(s: string | undefined): WindowKey | null {
  if (s === 'today' || s === 'yesterday' || s === 'week' || s === 'long') return s;
  return null;
}

export default async function RestorePage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const sp = await searchParams;
  const windowKey = parseWindow(sp.window);
  const workspaceId = session.user.workspaceId;

  if (!windowKey) return <RestoreLanding />;

  const w = WINDOWS.find((x) => x.key === windowKey)!;
  const since = new Date(Date.now() - w.hours * 60 * 60 * 1000);
  const db = getDb();

  // What did the world do while I was away?
  const [briefings, blockedTasks, topProjects, lastConductorMsg, recentImportantEvents] =
    await Promise.all([
      listRecentBriefings(workspaceId, 3).catch(() => []),
      db
        .select({
          id: task.id,
          title: task.title,
          status: task.status,
          projectId: task.projectId,
          projectName: project.name,
          leverageScore: task.leverageScore,
          updatedAt: task.updatedAt,
        })
        .from(task)
        .leftJoin(project, eq(task.projectId, project.id))
        .where(
          and(
            eq(task.workspaceId, workspaceId),
            isNull(task.deletedAt),
            ne(task.status, 'done'),
            ne(task.status, 'dropped'),
          ),
        )
        .orderBy(desc(task.leverageScore))
        .limit(5),
      db
        .select({
          id: project.id,
          name: project.name,
          status: project.status,
          momentumScore: project.momentumScore,
          stateSummary: project.stateSummary,
        })
        .from(project)
        .where(
          and(
            eq(project.workspaceId, workspaceId),
            isNull(project.deletedAt),
            eq(project.status, 'active'),
          ),
        )
        .orderBy(desc(project.momentumScore))
        .limit(3),
      db
        .select({
          id: message.id,
          content: message.content,
          createdAt: message.createdAt,
        })
        .from(message)
        .innerJoin(conversation, eq(message.conversationId, conversation.id))
        .where(
          and(
            eq(conversation.workspaceId, workspaceId),
            eq(conversation.kind, 'conductor'),
            eq(message.role, 'assistant'),
          ),
        )
        .orderBy(desc(message.createdAt))
        .limit(1),
      db
        .select({
          id: timelineEvent.id,
          kind: timelineEvent.kind,
          title: timelineEvent.title,
          importance: timelineEvent.importance,
          projectName: project.name,
          occurredAt: timelineEvent.occurredAt,
        })
        .from(timelineEvent)
        .leftJoin(project, eq(timelineEvent.projectId, project.id))
        .where(
          and(
            eq(timelineEvent.workspaceId, workspaceId),
            gte(timelineEvent.occurredAt, since),
            sql`${timelineEvent.importance} >= 0.6`,
          ),
        )
        .orderBy(desc(timelineEvent.occurredAt))
        .limit(15),
    ]);

  const latestBriefing = briefings[0] ?? null;
  const pulse = lastConductorMsg[0]?.content ?? null;
  const nextStep = blockedTasks[0] ?? null;

  return (
    <Page className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <Coffee className="h-3.5 w-3.5" />
            Welcome back
          </span>
        }
        title="Here's where you left off"
        description={`Catching you up on the last ${w.label.toLowerCase()}.`}
        actions={
          <Link
            href="/restore"
            className="text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-brand)]"
          >
            ← Wrong window?
          </Link>
        }
      />

      {/* The one thing — biggest, most cinematic. */}
      {nextStep ? (
        <PageSection>
          <Card className="border-[var(--color-brand)]/40 from-[var(--color-brand)]/8 bg-gradient-to-br via-transparent to-transparent p-6">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-[var(--color-fg-muted)]">
                <Sparkles className="h-3.5 w-3.5 text-[var(--color-brand)]" />
                The single smallest next step
              </div>
              <h2 className="text-2xl font-medium leading-tight">{nextStep.title}</h2>
              <div className="flex items-center gap-2 text-xs text-[var(--color-fg-muted)]">
                {nextStep.projectName ? (
                  <Badge variant="neutral">{nextStep.projectName}</Badge>
                ) : null}
                <span>Status: {nextStep.status}</span>
                {nextStep.leverageScore ? (
                  <span>· Leverage {Number(nextStep.leverageScore).toFixed(2)}</span>
                ) : null}
              </div>
              <div className="flex gap-2 pt-2">
                {nextStep.projectId ? (
                  <Link
                    href={`/projects/${nextStep.projectId}/tasks/${nextStep.id}`}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-brand)] px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
                  >
                    Open task <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                ) : null}
                <Link
                  href={`/chat?prompt=${encodeURIComponent('/focus')}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-[var(--color-bg-overlay)]"
                >
                  Something else
                </Link>
              </div>
            </div>
          </Card>
        </PageSection>
      ) : (
        <PageSection>
          <Card className="text-sm text-[var(--color-fg-muted)]">
            No open tasks. Either you're caught up, or you haven't told metu what you're working on
            yet. Try creating a project from{' '}
            <Link href="/projects/new" className="text-[var(--color-brand)] hover:underline">
              /projects/new
            </Link>
            .
          </Card>
        </PageSection>
      )}

      {/* The Conductor's most-recent thought. */}
      {pulse ? (
        <PageSection title="What the Conductor was thinking">
          <Card>
            <p className="whitespace-pre-wrap text-sm text-[var(--color-fg)]">
              {pulse.slice(0, 600)}
              {pulse.length > 600 ? '…' : ''}
            </p>
            <p className="mt-2 text-[11px] text-[var(--color-fg-subtle)]">
              {formatDistanceToNow(new Date(lastConductorMsg[0]!.createdAt), { addSuffix: true })}
            </p>
          </Card>
        </PageSection>
      ) : null}

      <PageSection title="Want a fresh take?">
        <Card>
          <p className="text-sm text-[var(--color-fg-muted)]">
            Generate a workspace-wide briefing right now. The Conductor reads your active projects,
            recent timeline, and blocked tasks, then writes 3 short paragraphs ending in the single
            smallest next step.
          </p>
          <GenerateBriefingButton className="mt-3" />
        </Card>
      </PageSection>

      {/* Briefing snippet — already AI-written. */}
      {latestBriefing ? (
        <PageSection title="Last continuity briefing">
          <Card>
            <p className="line-clamp-6 whitespace-pre-wrap text-sm text-[var(--color-fg-muted)]">
              {latestBriefing.briefing}
            </p>
            <Link
              href="/resume"
              className="mt-3 inline-flex items-center gap-1 text-xs text-[var(--color-brand)] hover:underline"
            >
              Open Resume for the full picture <ArrowRight className="h-3 w-3" />
            </Link>
          </Card>
        </PageSection>
      ) : null}

      {/* Top projects — at-a-glance momentum. */}
      {topProjects.length > 0 ? (
        <PageSection title="Active projects, by momentum">
          <div className="grid gap-2 md:grid-cols-3">
            {topProjects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`}>
                <Card className="hover:border-[var(--color-brand)]/40 h-full transition-colors">
                  <CardTitle>{p.name}</CardTitle>
                  {p.stateSummary ? (
                    <p className="mt-1 line-clamp-3 text-xs text-[var(--color-fg-muted)]">
                      {p.stateSummary}
                    </p>
                  ) : null}
                  <div className="mt-2 text-[11px] text-[var(--color-fg-subtle)]">
                    Momentum {Number(p.momentumScore ?? 0).toFixed(2)}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </PageSection>
      ) : null}

      {/* The "show me what I missed" panel. */}
      {recentImportantEvents.length > 0 ? (
        <PageSection>
          <details className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3">
            <summary className="cursor-pointer select-none text-sm font-medium">
              <ChevronDown className="mr-1 inline h-3.5 w-3.5" />
              {recentImportantEvents.length} high-signal events while you were away
            </summary>
            <ol className="mt-3 space-y-1.5 border-l border-[var(--color-border)] pl-3">
              {recentImportantEvents.map((e) => (
                <li key={e.id} className="text-sm">
                  <Link
                    href={`/timeline/${e.id}`}
                    className="flex items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-[var(--color-bg-overlay)]"
                  >
                    <span className="truncate">
                      {e.title}
                      {e.projectName ? (
                        <span className="text-[11px] text-[var(--color-fg-subtle)]">
                          {' '}
                          · {e.projectName}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-[11px] text-[var(--color-fg-subtle)]">
                      {formatDistanceToNow(new Date(e.occurredAt), { addSuffix: true })}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </details>
        </PageSection>
      ) : null}

      <p className="mt-8 text-center text-[11px] text-[var(--color-fg-subtle)]">
        <Clock className="mr-1 inline h-3 w-3" />
        Computed live from your timeline.{' '}
        <Link href="/resume" className="hover:text-[var(--color-brand)]">
          See /resume for the passive view
        </Link>
        .
      </p>
    </Page>
  );
}

function RestoreLanding() {
  return (
    <Page className="mx-auto max-w-2xl">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <Coffee className="h-3.5 w-3.5" />
            Welcome back
          </span>
        }
        title="How long has it been?"
        description="Tell metu the rough size of the gap and you'll get a tailored catch-up."
      />
      <div className="grid gap-2 md:grid-cols-2">
        {WINDOWS.map((w) => (
          <Link key={w.key} href={`/restore?window=${w.key}`}>
            <Card className="hover:border-[var(--color-brand)]/40 h-full transition-colors">
              <CardTitle>{w.label}</CardTitle>
              <p className="mt-1 text-xs text-[var(--color-fg-muted)]">
                Catch up on the last {w.label.toLowerCase()}.
              </p>
            </Card>
          </Link>
        ))}
      </div>
      <div className="mt-6 flex items-center justify-center gap-2 text-xs text-[var(--color-fg-muted)]">
        <AlertOctagon className="h-3.5 w-3.5" />
        Looking for the passive overview instead?{' '}
        <Link href="/resume" className="text-[var(--color-brand)] hover:underline">
          Open /resume
        </Link>
      </div>
    </Page>
  );
}

/**
 * /resume — the north-star surface.
 *
 * "After 3 days, 3 weeks, or 3 months — metu knows where I left off, why,
 * and the next minimum-viable step." This page composes the existing
 * continuity primitives (briefings, momentum, timeline, blocked tasks)
 * into a single answer to that question.
 *
 * Tabs: ?since=3d | 3w | 3m (default 3d). All-server-rendered; the tabs
 * are plain links so there is no client JS for the switch itself.
 */
import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { ArrowRight, Clock, Sparkles, AlertOctagon, History } from 'lucide-react';
import { Page, PageHeader, PageSection, Card, CardTitle, Badge, StatusDot } from '@metu/ui';
import { getDb } from '@metu/db';
import { project, task, timelineEvent } from '@metu/db/schema';
import { listRecentBriefings } from '@metu/db/queries';
import { RegenerateBriefingButton } from './regenerate-button';
import { PresencePill } from '@/components/presence-pill';
import { GenerateBriefingButton } from '@/components/generate-briefing-button';

export const dynamic = 'force-dynamic';

type Window = '3d' | '3w' | '3m';
const WINDOWS: { key: Window; label: string; days: number }[] = [
  { key: '3d', label: '3 days', days: 3 },
  { key: '3w', label: '3 weeks', days: 21 },
  { key: '3m', label: '3 months', days: 90 },
];

interface PageProps {
  searchParams: Promise<{ since?: string }>;
}

function parseWindow(s: string | undefined): Window | null {
  if (s === '3d' || s === '3w' || s === '3m') return s;
  return null;
}

/**
 * Pick the smallest window that fully contains the user's gap. If the
 * last meaningful activity was 12d ago, '3d' would show nothing — bump
 * to '3w'. If it was 45d ago, bump to '3m'. Falls back to '3d'.
 */
function autoWindow(lastActivity: Date | null): Window {
  if (!lastActivity) return '3d';
  const days = (Date.now() - lastActivity.getTime()) / (24 * 60 * 60 * 1000);
  if (days > 21) return '3m';
  if (days > 3) return '3w';
  return '3d';
}

function relativeTime(d: Date): string {
  const diffSec = Math.round((Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.round(diffSec / 60)} min ago`;
  if (diffSec < 86_400) return `${Math.round(diffSec / 3600)} h ago`;
  if (diffSec < 86_400 * 30) return `${Math.round(diffSec / 86_400)} d ago`;
  return `${Math.round(diffSec / (86_400 * 30))} mo ago`;
}

function snippet(text: string, max = 280): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

/** Pull the "smallest next step" from the briefing's last paragraph. */
function nextStep(briefing: string): string | null {
  const paras = briefing
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paras.length === 0) return null;
  return snippet(paras[paras.length - 1]!, 220);
}

export default async function ResumePage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const wsId = session.user.workspaceId;
  const sp = await searchParams;

  const parsed = parseWindow(sp.since);
  if (!parsed) {
    // Auto-detect the gap from the latest timeline event and redirect.
    const db0 = getDb();
    const [latest] = await db0
      .select({ at: sql<Date>`max(${timelineEvent.occurredAt})` })
      .from(timelineEvent)
      .where(eq(timelineEvent.workspaceId, wsId));
    const detected = autoWindow(latest?.at ? new Date(latest.at) : null);
    redirect(`/resume?since=${detected}`);
  }
  const win: Window = parsed;

  const days = WINDOWS.find((w) => w.key === win)!.days;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const db = getDb();

  const [briefings, activeProjects, blockedTasks, eventCount] = await Promise.all([
    listRecentBriefings(wsId, 10),
    // Active projects with meaningful activity inside the window, by momentum.
    db
      .select({
        id: project.id,
        name: project.name,
        stateSummary: project.stateSummary,
        momentumScore: project.momentumScore,
        lastMeaningfulActivityAt: project.lastMeaningfulActivityAt,
        status: project.status,
      })
      .from(project)
      .where(
        and(
          eq(project.workspaceId, wsId),
          isNull(project.deletedAt),
          sql`${project.status} in ('active', 'paused')`,
          gte(project.lastMeaningfulActivityAt, cutoff),
        ),
      )
      .orderBy(desc(project.momentumScore), desc(project.lastMeaningfulActivityAt))
      .limit(8),
    // Open loops = blocked tasks across the workspace, newest first.
    db
      .select({
        id: task.id,
        title: task.title,
        blockedReason: task.blockedReason,
        projectId: task.projectId,
        updatedAt: task.updatedAt,
      })
      .from(task)
      .where(and(eq(task.workspaceId, wsId), isNull(task.deletedAt), eq(task.status, 'blocked')))
      .orderBy(desc(task.updatedAt))
      .limit(6),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(timelineEvent)
      .where(and(eq(timelineEvent.workspaceId, wsId), gte(timelineEvent.occurredAt, cutoff)))
      .then((r) => r[0]?.n ?? 0),
  ]);

  const briefingByProject = new Map(briefings.map((b) => [b.projectId, b]));

  return (
    <Page className="space-y-6">
      <PageHeader
        title="Resume"
        description="Where you left off, why, and the smallest next step. Pick the gap you're returning from."
        actions={
          <div className="flex items-center gap-2">
            <PresencePill workspaceId={session.user.workspaceId} />
            <nav className="flex items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-1 text-xs">
              {WINDOWS.map((w) => {
                const active = w.key === win;
                return (
                  <Link
                    key={w.key}
                    href={`/resume?since=${w.key}`}
                    aria-current={active ? 'page' : undefined}
                    className={
                      active
                        ? 'rounded-md bg-[var(--color-brand)] px-3 py-1 font-medium text-white'
                        : 'rounded-md px-3 py-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]'
                    }
                  >
                    {w.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        }
      />

      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--color-fg-subtle)]">
              Past {WINDOWS.find((w) => w.key === win)!.label}
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--color-fg)]">
              {eventCount}
              <span className="ml-2 text-sm font-normal text-[var(--color-fg-subtle)]">
                meaningful event{eventCount === 1 ? '' : 's'}
              </span>
            </p>
          </div>
          <Link
            href={`/timeline?since=${days}d`}
            className="inline-flex items-center gap-1 text-sm text-[var(--color-fg-subtle)] hover:text-[var(--color-brand)]"
          >
            <History className="h-4 w-4" />
            Open timeline
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </Card>

      <Card className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="from-[var(--color-brand)]/8 pointer-events-none absolute inset-0 bg-gradient-to-br via-transparent to-transparent"
        />
        <div className="relative">
          <p className="text-xs uppercase tracking-wide text-[var(--color-fg-subtle)]">
            <Sparkles className="-mt-0.5 mr-1 inline h-3 w-3 text-[var(--color-brand)]" />
            Conductor narrative
          </p>
          <p className="mt-2 text-sm text-[var(--color-fg-muted)]">
            One paragraph across all your active projects, ending in the single smallest next step.
            Read-only — costs a small AI call.
          </p>
          <GenerateBriefingButton className="mt-3" variant="ghost" />
        </div>
      </Card>

      <PageSection
        title="Where you left off"
        description="Active projects with movement in this window, ordered by momentum."
      >
        {activeProjects.length === 0 ? (
          <Card>
            <p className="text-sm text-[var(--color-fg-subtle)]">
              Nothing meaningful happened in this window. Try a longer one above.
            </p>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {activeProjects.map((p) => {
              const b = briefingByProject.get(p.id);
              const step = b ? nextStep(b.briefing) : null;
              return (
                <Card key={p.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="flex items-center gap-2">
                        <StatusDot state={p.status === 'active' ? 'success' : 'neutral'} />
                        <Link
                          href={`/projects/${p.id}`}
                          className="truncate hover:text-[var(--color-brand)]"
                        >
                          {p.name}
                        </Link>
                      </CardTitle>
                      {p.stateSummary ? (
                        <p className="mt-2 line-clamp-2 text-xs text-[var(--color-fg-subtle)]">
                          {p.stateSummary}
                        </p>
                      ) : null}
                    </div>
                    {typeof p.momentumScore === 'number' ? (
                      <Badge variant="neutral">{Math.round(p.momentumScore * 100)}%</Badge>
                    ) : null}
                  </div>

                  {step ? (
                    <div className="mt-3 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-3">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-fg-subtle)]">
                        <Sparkles className="-mt-0.5 mr-1 inline h-3 w-3 text-[var(--color-brand)]" />
                        Next step
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-[var(--color-fg)]">{step}</p>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-[var(--color-fg-subtle)]">
                      No briefing yet — open the project to generate one.
                    </p>
                  )}

                  <div className="mt-3 flex items-center justify-between text-[11px] text-[var(--color-fg-subtle)]">
                    {p.lastMeaningfulActivityAt ? (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {relativeTime(p.lastMeaningfulActivityAt)}
                      </span>
                    ) : (
                      <span />
                    )}
                    <div className="flex items-center gap-1">
                      <RegenerateBriefingButton projectId={p.id} hasBriefing={!!b} />
                      <Link
                        href={`/projects/${p.id}`}
                        className="inline-flex items-center gap-1 hover:text-[var(--color-brand)]"
                      >
                        Resume
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </PageSection>

      <PageSection
        title="Open loops"
        description="Blocked tasks waiting on you. Each one is a thread you can close in a single decision."
      >
        {blockedTasks.length === 0 ? (
          <Card>
            <p className="text-sm text-[var(--color-fg-subtle)]">
              Nothing is blocked. Clean slate — good time to start something new.
            </p>
          </Card>
        ) : (
          <Card>
            <ul className="divide-y divide-[var(--color-border)]">
              {blockedTasks.map((t) => (
                <li key={t.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-sm font-medium text-[var(--color-fg)]">
                      {t.title}
                    </p>
                    {t.blockedReason ? (
                      <p className="mt-0.5 line-clamp-2 text-xs text-[var(--color-fg-subtle)]">
                        {t.blockedReason}
                      </p>
                    ) : null}
                  </div>
                  {t.projectId ? (
                    <Link
                      href={`/projects/${t.projectId}`}
                      className="shrink-0 text-xs text-[var(--color-fg-subtle)] hover:text-[var(--color-brand)]"
                    >
                      Open
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </PageSection>
    </Page>
  );
}

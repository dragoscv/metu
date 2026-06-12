/**
 * /journal — auto-generated daily journal from the timeline.
 *
 * Groups timeline events by day and produces a human-readable digest:
 *   - what was captured
 *   - what was decided
 *   - what moved (project status changes)
 *   - what the Conductor did
 *
 * Pure server rendering; the actual narrative comes straight from
 * `timeline_event.title` + `body`. The grouping is the value-add.
 */
import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { and, desc, eq, gte } from 'drizzle-orm';
import { CalendarDays, Sparkles, Download } from 'lucide-react';
import { Page, PageHeader, Card, Badge } from '@metu/ui';
import { getDb } from '@metu/db';
import { timelineEvent, project } from '@metu/db/schema';
import { format, isSameDay, startOfDay } from 'date-fns';
import {
  JOURNAL_RANGES as RANGES,
  parseJournalRange as parseRange,
  labelForKind as labelFor,
} from '@/lib/journal-helpers';

interface PageProps {
  searchParams: Promise<{ range?: string }>;
}

export default async function JournalPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect('/sign-in');

  const sp = await searchParams;
  const range = parseRange(sp.range);
  const days = RANGES.find((r) => r.key === range)!.days;
  const since = startOfDay(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
  const workspaceId = session.user.workspaceId;
  const db = getDb();

  const rows = await db
    .select({
      id: timelineEvent.id,
      kind: timelineEvent.kind,
      title: timelineEvent.title,
      body: timelineEvent.body,
      importance: timelineEvent.importance,
      projectId: timelineEvent.projectId,
      projectName: project.name,
      occurredAt: timelineEvent.occurredAt,
    })
    .from(timelineEvent)
    .leftJoin(project, eq(timelineEvent.projectId, project.id))
    .where(and(eq(timelineEvent.workspaceId, workspaceId), gte(timelineEvent.occurredAt, since)))
    .orderBy(desc(timelineEvent.occurredAt))
    .limit(500);

  // Group by day (descending).
  const days_groups: Array<{ day: Date; events: typeof rows }> = [];
  for (const e of rows) {
    const eventDay = startOfDay(new Date(e.occurredAt));
    const last = days_groups[days_groups.length - 1];
    if (last && isSameDay(last.day, eventDay)) {
      last.events.push(e);
    } else {
      days_groups.push({ day: eventDay, events: [e] });
    }
  }

  return (
    <Page className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" />
            Journal
          </span>
        }
        title="Your story, day by day"
        description={`Auto-rendered from the timeline. ${rows.length} events across ${days_groups.length} day${days_groups.length === 1 ? '' : 's'}.`}
        actions={
          <Link
            href={`/journal/export.md?range=${range}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-xs hover:bg-[var(--color-bg-overlay)]"
          >
            <Download className="h-3 w-3" />
            Export markdown
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {RANGES.map((r) => {
          const active = r.key === range;
          return (
            <Link
              key={r.key}
              href={`/journal?range=${r.key}`}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                active
                  ? 'bg-[var(--color-brand)]/10 border-[var(--color-brand)] text-[var(--color-brand)]'
                  : 'border-[var(--color-border)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-overlay)]'
              }`}
            >
              {r.label}
            </Link>
          );
        })}
      </div>

      {days_groups.length === 0 ? (
        <Card className="text-sm text-[var(--color-fg-muted)]">
          Nothing in your timeline yet for this range. As you capture, decide, and ship, this page
          fills itself in.
        </Card>
      ) : (
        <div className="space-y-6">
          {days_groups.map((g) => {
            const isToday = isSameDay(g.day, new Date());
            return (
              <section key={g.day.toISOString()} className="space-y-2">
                <div className="bg-[var(--color-bg)]/95 supports-[backdrop-filter]:bg-[var(--color-bg)]/70 sticky top-0 z-10 -mx-3 px-3 py-2 backdrop-blur">
                  <h2 className="flex items-baseline gap-2 text-sm font-medium">
                    <span>{format(g.day, 'EEEE, MMM d')}</span>
                    {isToday ? (
                      <span className="text-[11px] uppercase tracking-wide text-[var(--color-brand)]">
                        today
                      </span>
                    ) : null}
                    <span className="text-[11px] text-[var(--color-fg-subtle)]">
                      {g.events.length} event{g.events.length === 1 ? '' : 's'}
                    </span>
                  </h2>
                </div>
                <ol className="space-y-1.5 border-l border-[var(--color-border)] pl-4">
                  {g.events.map((e) => {
                    const { label, tone } = labelFor(e.kind);
                    const big = e.importance >= 0.7;
                    return (
                      <li key={e.id} className="relative">
                        <span
                          className={`absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ${
                            big ? 'bg-[var(--color-brand)]' : 'bg-[var(--color-border)]'
                          }`}
                        />
                        <Link
                          href={`/timeline/${e.id}`}
                          className="block rounded-md px-2 py-1.5 hover:bg-[var(--color-bg-overlay)]"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-sm">
                              <Badge variant={tone}>{label}</Badge>
                              <span className={big ? 'font-medium' : ''}>{e.title}</span>
                              {e.projectName ? (
                                <span className="text-[11px] text-[var(--color-fg-subtle)]">
                                  · {e.projectName}
                                </span>
                              ) : null}
                            </div>
                            <span className="shrink-0 text-[11px] text-[var(--color-fg-subtle)]">
                              {format(new Date(e.occurredAt), 'HH:mm')}
                            </span>
                          </div>
                          {e.body ? (
                            <p className="mt-0.5 line-clamp-2 text-xs text-[var(--color-fg-muted)]">
                              {e.body}
                            </p>
                          ) : null}
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              </section>
            );
          })}
        </div>
      )}

      <p className="mt-8 text-center text-[11px] text-[var(--color-fg-subtle)]">
        <Sparkles className="mr-1 inline h-3 w-3" />
        Future: weekly auto-summary written by the Conductor.
      </p>
    </Page>
  );
}

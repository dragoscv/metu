/**
 * /people/[name] — person detail page.
 *
 * Heuristic: surface every capture + timeline event mentioning this token,
 * plus a "Recall" deep link into /memory. The "person" is just a string here;
 * we re-extract the same regex over recent content and filter to rows whose
 * text contains the token (case-insensitive).
 */
import { auth } from '@metu/auth';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { and, desc, eq, ilike, isNull, or } from 'drizzle-orm';
import { ArrowLeft, Calendar, MessageSquare, Sparkles } from 'lucide-react';
import { Page, PageHeader, Card, Badge } from '@metu/ui';
import { getDb } from '@metu/db';
import { capture, project, timelineEvent } from '@metu/db/schema';
import { formatDistanceToNow } from 'date-fns';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ name: string }>;
}

export default async function PersonDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const { name: encoded } = await params;
  const name = decodeURIComponent(encoded);
  if (!name || name.length < 2 || name.length > 80) notFound();

  const workspaceId = session.user.workspaceId;
  const db = getDb();

  // Use ilike for case-insensitive substring match. Capture content and
  // timeline title/body are both relevant.
  const needle = `%${name}%`;

  const [captures, events] = await Promise.all([
    db
      .select({
        id: capture.id,
        content: capture.content,
        kind: capture.kind,
        projectId: capture.projectId,
        projectName: project.name,
        capturedAt: capture.capturedAt,
      })
      .from(capture)
      .leftJoin(project, eq(capture.projectId, project.id))
      .where(
        and(
          eq(capture.workspaceId, workspaceId),
          isNull(capture.deletedAt),
          ilike(capture.content, needle),
        ),
      )
      .orderBy(desc(capture.capturedAt))
      .limit(40),
    db
      .select({
        id: timelineEvent.id,
        kind: timelineEvent.kind,
        title: timelineEvent.title,
        body: timelineEvent.body,
        importance: timelineEvent.importance,
        projectName: project.name,
        occurredAt: timelineEvent.occurredAt,
      })
      .from(timelineEvent)
      .leftJoin(project, eq(timelineEvent.projectId, project.id))
      .where(
        and(
          eq(timelineEvent.workspaceId, workspaceId),
          or(ilike(timelineEvent.title, needle), ilike(timelineEvent.body, needle)),
        ),
      )
      .orderBy(desc(timelineEvent.occurredAt))
      .limit(40),
  ]);

  const initial = name.replace(/^@/, '').slice(0, 1).toUpperCase();
  const totalMentions = captures.length + events.length;

  return (
    <Page className="mx-auto max-w-3xl">
      <Link
        href="/people"
        className="mb-3 inline-flex items-center gap-1 text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-brand)]"
      >
        <ArrowLeft className="h-3 w-3" />
        All people
      </Link>

      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <div className="bg-[var(--color-brand)]/10 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium text-[var(--color-brand)]">
              {initial}
            </div>
            Person
          </span>
        }
        title={name}
        description={`${totalMentions} mention${totalMentions === 1 ? '' : 's'} across captures and timeline.`}
        actions={
          <Link
            href={`/memory?q=${encodeURIComponent(name)}`}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-brand)] px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:opacity-90"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Recall everything
          </Link>
        }
      />

      {totalMentions === 0 ? (
        <Card className="text-sm text-[var(--color-fg-muted)]">
          No mentions of {name} found. They may have been mentioned with a different alias.
        </Card>
      ) : null}

      {events.length > 0 ? (
        <section className="mt-4 space-y-2">
          <h2 className="flex items-center gap-1.5 text-sm font-medium">
            <Calendar className="h-3.5 w-3.5" />
            Timeline events ({events.length})
          </h2>
          <div className="space-y-1.5">
            {events.map((e) => (
              <Link
                key={e.id}
                href={`/timeline/${e.id}`}
                className="hover:border-[var(--color-brand)]/40 block rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Badge variant="neutral">{e.kind.split('.')[0]}</Badge>
                    <span>{e.title}</span>
                    {e.projectName ? (
                      <span className="text-[11px] text-[var(--color-fg-subtle)]">
                        · {e.projectName}
                      </span>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-[11px] text-[var(--color-fg-subtle)]">
                    {formatDistanceToNow(new Date(e.occurredAt), { addSuffix: true })}
                  </span>
                </div>
                {e.body ? (
                  <p className="mt-1 line-clamp-2 text-xs text-[var(--color-fg-muted)]">{e.body}</p>
                ) : null}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {captures.length > 0 ? (
        <section className="mt-6 space-y-2">
          <h2 className="flex items-center gap-1.5 text-sm font-medium">
            <MessageSquare className="h-3.5 w-3.5" />
            Captures ({captures.length})
          </h2>
          <div className="space-y-1.5">
            {captures.map((c) => (
              <Link
                key={c.id}
                href={`/inbox/${c.id}`}
                className="hover:border-[var(--color-brand)]/40 block rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Badge variant="neutral">{c.kind}</Badge>
                    {c.projectName ? (
                      <span className="text-[11px] text-[var(--color-fg-subtle)]">
                        · {c.projectName}
                      </span>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-[11px] text-[var(--color-fg-subtle)]">
                    {formatDistanceToNow(new Date(c.capturedAt), { addSuffix: true })}
                  </span>
                </div>
                {c.content ? (
                  <p className="mt-1 line-clamp-3 text-xs text-[var(--color-fg-muted)]">
                    {c.content}
                  </p>
                ) : null}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </Page>
  );
}

import { auth } from '@metu/auth';
import { getTimelineEventById } from '@metu/db/queries';
import { Card, Page, PageHeader } from '@metu/ui';
import { format } from 'date-fns';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { kindMeta, resolveSourceLink } from '@/components/timeline/kind-meta';

interface PageProps {
  params: Promise<{ id: string }>;
}

const TONE_BG: Record<string, string> = {
  success: 'bg-[var(--color-success-bg)] text-[var(--color-success)]',
  warning: 'bg-[var(--color-warning-bg)] text-[var(--color-warning)]',
  danger: 'bg-[var(--color-danger-bg)] text-[var(--color-danger)]',
  info: 'bg-[var(--color-info-bg)] text-[var(--color-info)]',
  brand: 'bg-[var(--color-brand)]/10 text-[var(--color-brand)]',
  neutral: 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)]',
};

export default async function TimelineEventPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const { id } = await params;
  const event = await getTimelineEventById(session.user.workspaceId, id);
  if (!event) notFound();

  const meta = kindMeta(event.kind);
  const Icon = meta.icon;
  const tone = TONE_BG[meta.tone] ?? TONE_BG.neutral;
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const sourceLink = resolveSourceLink(event.kind, payload, event.projectId);

  return (
    <Page className="mx-auto max-w-3xl">
      <PageHeader
        size="sm"
        back={{ href: '/timeline', label: 'Timeline' }}
        accent={
          <span
            className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${tone}`}
          >
            <Icon className="h-6 w-6" />
          </span>
        }
        eyebrow={
          <span className="text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            {meta.label} · {event.kind}
          </span>
        }
        title={event.title}
        description={
          <span className="text-xs text-[var(--color-fg-subtle)]">
            <time dateTime={event.occurredAt.toISOString()}>
              {format(event.occurredAt, 'EEEE, MMM d, yyyy · HH:mm:ss')}
            </time>
            {event.importance > 0.7 && (
              <span className="bg-[var(--color-brand)]/15 ml-2 rounded-sm px-1 text-[10px] font-semibold text-[var(--color-brand)]">
                IMPORTANT
              </span>
            )}
          </span>
        }
        actions={
          sourceLink ? (
            <Link
              href={sourceLink}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 text-sm hover:bg-[var(--color-bg-elevated)]"
            >
              <ExternalLink className="h-4 w-4" />
              Open source
            </Link>
          ) : undefined
        }
      />

      {event.body && (
        <Card>
          <h2 className="text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            Description
          </h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--color-fg)]">{event.body}</p>
        </Card>
      )}

      <Card>
        <h2 className="text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
          Payload
        </h2>
        {Object.keys(payload).length === 0 ? (
          <p className="mt-2 text-sm italic text-[var(--color-fg-subtle)]">No payload.</p>
        ) : (
          <pre className="mt-2 overflow-x-auto rounded-md bg-[var(--color-bg-elevated)] p-3 text-xs">
            <code>{JSON.stringify(payload, null, 2)}</code>
          </pre>
        )}
      </Card>

      <dl className="grid gap-3 text-xs sm:grid-cols-2">
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3">
          <dt className="uppercase tracking-wider text-[var(--color-fg-subtle)]">Importance</dt>
          <dd className="mt-1 font-mono tabular-nums">{event.importance.toFixed(2)}</dd>
        </div>
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3">
          <dt className="uppercase tracking-wider text-[var(--color-fg-subtle)]">Project</dt>
          <dd className="mt-1">
            {event.projectId ? (
              <Link href={`/projects/${event.projectId}`} className="underline">
                {event.projectId.slice(0, 8)}…
              </Link>
            ) : (
              <span className="italic text-[var(--color-fg-subtle)]">none</span>
            )}
          </dd>
        </div>
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3">
          <dt className="uppercase tracking-wider text-[var(--color-fg-subtle)]">Event ID</dt>
          <dd className="mt-1 font-mono text-[10px]">{event.id}</dd>
        </div>
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3">
          <dt className="uppercase tracking-wider text-[var(--color-fg-subtle)]">User</dt>
          <dd className="mt-1 font-mono text-[10px]">
            {event.userId ?? <span className="italic">system</span>}
          </dd>
        </div>
      </dl>
    </Page>
  );
}

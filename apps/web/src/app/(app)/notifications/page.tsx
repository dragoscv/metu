import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { and, asc, desc, eq, like, or, sql } from 'drizzle-orm';
import { Page, PageHeader, Card, Badge, cn } from '@metu/ui';
import { Bell } from 'lucide-react';
import { getDb } from '@metu/db';
import { notification, project } from '@metu/db/schema';
import { NotificationsActions } from '@/components/notifications-actions';
import { DismissNotificationButton } from '@/components/dismiss-notification-button';
import { SnoozeNotificationButton } from '@/components/snooze-notification-button';
import { ProposalActions } from '@/components/proposal-actions';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

const URGENCY_VALUES = ['low', 'normal', 'high', 'critical'] as const;
type Urgency = (typeof URGENCY_VALUES)[number];

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ urgency?: string; source?: string; project?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');

  const sp = await searchParams;
  const urgencyFilter: Urgency | null = (URGENCY_VALUES as readonly string[]).includes(
    sp.urgency ?? '',
  )
    ? (sp.urgency as Urgency)
    : null;

  const sourceParam = sp.source ?? null;
  // project=none → only rows with no projectId set;
  // project=<uuid> → rows whose metadata.projectId matches.
  const projectParam = sp.project ?? null;
  const projectFilter =
    projectParam === 'none'
      ? sql`${notification.metadata} ->> 'projectId' IS NULL`
      : projectParam && /^[0-9a-f-]{36}$/i.test(projectParam)
        ? sql`${notification.metadata} ->> 'projectId' = ${projectParam}`
        : undefined;
  const sourceFilter: { kind: 'exact'; value: string } | { kind: 'prefix'; value: string } | null =
    sourceParam === 'conductor'
      ? { kind: 'exact', value: 'conductor' }
      : sourceParam === 'integration'
        ? { kind: 'prefix', value: 'integration:' }
        : sourceParam === 'app'
          ? { kind: 'prefix', value: 'app:' }
          : null;

  const db = getDb();
  const [rows, projects] = await Promise.all([
    db
      .select({
        id: notification.id,
        title: notification.title,
        body: notification.body,
        urgency: notification.urgency,
        source: notification.source,
        actionUrl: notification.actionUrl,
        actions: notification.actions,
        metadata: notification.metadata,
        readAt: notification.readAt,
        acknowledgedAt: notification.acknowledgedAt,
        createdAt: notification.createdAt,
      })
      .from(notification)
      .where(
        and(
          eq(notification.userId, session.user.id),
          eq(notification.workspaceId, session.user.workspaceId),
          urgencyFilter ? eq(notification.urgency, urgencyFilter) : undefined,
          sourceFilter
            ? sourceFilter.kind === 'exact'
              ? eq(notification.source, sourceFilter.value)
              : like(notification.source, `${sourceFilter.value}%`)
            : undefined,
          projectFilter,
          or(
            sql`${notification.metadata} ->> 'snoozedUntil' IS NULL`,
            sql`(${notification.metadata} ->> 'snoozedUntil')::timestamptz <= now()`,
          ),
        ),
      )
      .orderBy(desc(notification.createdAt))
      .limit(100),
    db
      .select({ id: project.id, name: project.name })
      .from(project)
      .where(and(eq(project.workspaceId, session.user.workspaceId), eq(project.status, 'active')))
      .orderBy(asc(project.name))
      .limit(50),
  ]);

  const unread = rows.filter((r) => r.acknowledgedAt === null);

  // Collapse adjacent same-source bursts (e.g. a flurry of commit pushes
  // from `integration:github`) into a single grouped item with a count.
  // Boundary: same source, same urgency, within a 30-minute window of
  // the previous row (rows are already desc by createdAt).
  type Row = (typeof rows)[number];
  type Group = { lead: Row; rest: Row[] };
  const grouped: Group[] = [];
  const WINDOW_MS = 30 * 60 * 1000;
  for (const r of rows) {
    const last = grouped[grouped.length - 1];
    if (
      last &&
      last.lead.source === r.source &&
      last.lead.urgency === r.urgency &&
      last.lead.source.startsWith('integration:') &&
      new Date(last.lead.createdAt).getTime() - new Date(r.createdAt).getTime() < WINDOW_MS
    ) {
      last.rest.push(r);
    } else {
      grouped.push({ lead: r, rest: [] });
    }
  }

  return (
    <Page className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <Bell className="h-3.5 w-3.5" />
            Inbox
          </span>
        }
        title="Notifications"
        description={`${unread.length} unread of ${rows.length} recent${urgencyFilter ? ` · filtered: ${urgencyFilter}` : ''}`}
        actions={
          <NotificationsActions
            hasUnread={unread.length > 0}
            urgency={urgencyFilter ?? undefined}
            source={
              sourceParam === 'conductor' || sourceParam === 'integration' || sourceParam === 'app'
                ? sourceParam
                : undefined
            }
          />
        }
      />
      <UrgencyFilterChips active={urgencyFilter} />
      <SourceFilterChips active={sourceParam} urgency={urgencyFilter} />
      <ProjectFilterChips
        active={projectParam}
        projects={projects}
        urgency={urgencyFilter}
        source={sourceParam}
      />
      {rows.length === 0 ? (
        <Card className="text-sm text-[var(--color-fg-muted)]">
          No notifications yet. The Conductor will surface things here as they happen.
        </Card>
      ) : (
        <div className="space-y-2">
          {grouped.map(({ lead: r, rest }) => {
            const groupCount = rest.length;
            const Body = (
              <Card
                className={`space-y-1 ${
                  r.acknowledgedAt === null ? 'border-[var(--color-brand)]/40' : 'opacity-70'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {r.urgency === 'critical' ? (
                      <Badge variant="danger">!</Badge>
                    ) : r.urgency === 'high' ? (
                      <Badge variant="warning">↑</Badge>
                    ) : null}
                    <span>{r.title}</span>
                    {groupCount > 0 && (
                      <Badge variant="neutral" size="xs">
                        +{groupCount} more
                      </Badge>
                    )}
                  </div>
                  <span className="text-[11px] text-[var(--color-fg-subtle)]">
                    {formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}
                  </span>
                </div>
                {r.body ? <p className="text-sm text-[var(--color-fg-muted)]">{r.body}</p> : null}
                {groupCount > 0 && (
                  <ul className="mt-1 space-y-0.5 border-l-2 border-[var(--color-border)] pl-2 text-[11px] text-[var(--color-fg-subtle)]">
                    {rest.slice(0, 5).map((g) => (
                      <li key={g.id} className="truncate">
                        {g.title}
                      </li>
                    ))}
                    {rest.length > 5 && <li className="italic">… and {rest.length - 5} more</li>}
                  </ul>
                )}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-[var(--color-fg-subtle)]">{r.source}</span>
                  {r.acknowledgedAt === null ? (
                    <span className="flex items-center gap-1">
                      <SnoozeNotificationButton id={r.id} />
                      <DismissNotificationButton id={r.id} />
                    </span>
                  ) : null}
                </div>
                <ProposalActions
                  notificationId={r.id}
                  actions={
                    (r.actions as Array<{
                      id: string;
                      label: string;
                      kind: 'approve' | 'reject' | 'open' | 'custom';
                    }>) ?? []
                  }
                  hasToolProposal={
                    !!(r.metadata as { toolProposal?: unknown } | null)?.toolProposal &&
                    r.acknowledgedAt === null
                  }
                  toolCallId={
                    r.acknowledgedAt === null
                      ? (r.metadata as { toolCallId?: string } | null)?.toolCallId
                      : undefined
                  }
                />
              </Card>
            );
            return r.actionUrl ? (
              <Link key={r.id} href={r.actionUrl} className="block">
                {Body}
              </Link>
            ) : (
              <div key={r.id}>{Body}</div>
            );
          })}
        </div>
      )}
    </Page>
  );
}

function UrgencyFilterChips({ active }: { active: Urgency | null }) {
  const chips: { label: string; href: string; value: Urgency | null }[] = [
    { label: 'All', href: '/notifications', value: null },
    { label: 'Critical', href: '/notifications?urgency=critical', value: 'critical' },
    { label: 'High', href: '/notifications?urgency=high', value: 'high' },
    { label: 'Normal', href: '/notifications?urgency=normal', value: 'normal' },
    { label: 'Low', href: '/notifications?urgency=low', value: 'low' },
  ];
  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {chips.map((c) => {
        const isActive = c.value === active;
        return (
          <Link
            key={c.label}
            href={c.href}
            className={cn(
              'rounded-full border px-2.5 py-1 text-xs transition-colors',
              isActive
                ? 'bg-[var(--color-brand)]/10 border-[var(--color-brand)] text-[var(--color-brand)]'
                : 'border-[var(--color-border)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-overlay)]',
            )}
          >
            {c.label}
          </Link>
        );
      })}
    </div>
  );
}

function SourceFilterChips({
  active,
  urgency,
}: {
  active: string | null;
  urgency: Urgency | null;
}) {
  const u = urgency ? `&urgency=${urgency}` : '';
  const ub = urgency ? `?urgency=${urgency}` : '';
  const chips: { label: string; href: string; value: string | null }[] = [
    { label: 'Any source', href: `/notifications${ub}`, value: null },
    { label: 'Conductor', href: `/notifications?source=conductor${u}`, value: 'conductor' },
    {
      label: 'Integrations',
      href: `/notifications?source=integration${u}`,
      value: 'integration',
    },
    { label: 'Apps', href: `/notifications?source=app${u}`, value: 'app' },
  ];
  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {chips.map((c) => {
        const isActive = c.value === active;
        return (
          <Link
            key={c.label}
            href={c.href}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
              isActive
                ? 'border-[var(--color-fg-muted)] bg-[var(--color-bg-overlay)] text-[var(--color-fg)]'
                : 'border-dashed border-[var(--color-border)] text-[var(--color-fg-subtle)] hover:bg-[var(--color-bg-overlay)]',
            )}
          >
            {c.label}
          </Link>
        );
      })}
    </div>
  );
}

function ProjectFilterChips({
  active,
  projects,
  urgency,
  source,
}: {
  active: string | null;
  projects: Array<{ id: string; name: string }>;
  urgency: Urgency | null;
  source: string | null;
}) {
  if (projects.length === 0) return null;
  const carry: string[] = [];
  if (urgency) carry.push(`urgency=${urgency}`);
  if (source) carry.push(`source=${source}`);
  const carryQs = carry.length ? `&${carry.join('&')}` : '';
  const baseQs = carry.length ? `?${carry.join('&')}` : '';
  const chips: { label: string; href: string; value: string | null }[] = [
    { label: 'Any project', href: `/notifications${baseQs}`, value: null },
    { label: 'No project', href: `/notifications?project=none${carryQs}`, value: 'none' },
    ...projects.slice(0, 8).map((p) => ({
      label: p.name,
      href: `/notifications?project=${p.id}${carryQs}`,
      value: p.id,
    })),
  ];
  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {chips.map((c) => {
        const isActive = c.value === active;
        return (
          <Link
            key={c.label}
            href={c.href}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
              isActive
                ? 'border-[var(--color-fg-muted)] bg-[var(--color-bg-overlay)] text-[var(--color-fg)]'
                : 'border-dashed border-[var(--color-border)] text-[var(--color-fg-subtle)] hover:bg-[var(--color-bg-overlay)]',
            )}
          >
            {c.label}
          </Link>
        );
      })}
    </div>
  );
}

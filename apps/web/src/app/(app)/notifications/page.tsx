import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { and, desc, eq, like } from 'drizzle-orm';
import { Page, PageHeader, Card, Badge, cn } from '@metu/ui';
import { Bell } from 'lucide-react';
import { getDb } from '@metu/db';
import { notification } from '@metu/db/schema';
import { NotificationsActions } from '@/components/notifications-actions';
import { DismissNotificationButton } from '@/components/dismiss-notification-button';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

export const dynamic = 'force-dynamic';

const URGENCY_VALUES = ['low', 'normal', 'high', 'critical'] as const;
type Urgency = (typeof URGENCY_VALUES)[number];

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ urgency?: string; source?: string }>;
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
  const sourceFilter: { kind: 'exact'; value: string } | { kind: 'prefix'; value: string } | null =
    sourceParam === 'conductor'
      ? { kind: 'exact', value: 'conductor' }
      : sourceParam === 'integration'
        ? { kind: 'prefix', value: 'integration:' }
        : sourceParam === 'app'
          ? { kind: 'prefix', value: 'app:' }
          : null;

  const db = getDb();
  const rows = await db
    .select({
      id: notification.id,
      title: notification.title,
      body: notification.body,
      urgency: notification.urgency,
      source: notification.source,
      actionUrl: notification.actionUrl,
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
      ),
    )
    .orderBy(desc(notification.createdAt))
    .limit(100);

  const unread = rows.filter((r) => r.acknowledgedAt === null);

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
        actions={<NotificationsActions hasUnread={unread.length > 0} />}
      />
      <UrgencyFilterChips active={urgencyFilter} />
      <SourceFilterChips active={sourceParam} urgency={urgencyFilter} />
      {rows.length === 0 ? (
        <Card className="text-sm text-[var(--color-fg-muted)]">
          No notifications yet. The Conductor will surface things here as they happen.
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
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
                  </div>
                  <span className="text-[11px] text-[var(--color-fg-subtle)]">
                    {formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}
                  </span>
                </div>
                {r.body ? <p className="text-sm text-[var(--color-fg-muted)]">{r.body}</p> : null}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-[var(--color-fg-subtle)]">{r.source}</span>
                  {r.acknowledgedAt === null ? <DismissNotificationButton id={r.id} /> : null}
                </div>
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

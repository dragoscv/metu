import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { timelineEvent, user, workspaceMember } from '@metu/db/schema';
import { Page, PageHeader, Card, Badge, EmptyState } from '@metu/ui';
import { ScrollText } from 'lucide-react';

export const dynamic = 'force-dynamic';

const AUDIT_KINDS = [
  'workspace.member.added',
  'workspace.member.role_changed',
  'workspace.member.removed',
  'workspace.invite.sent',
  'workspace.invite.revoked',
  'workspace.invite.claimed',
  'workspace.ownership.transferred',
] as const;

const KIND_TONE: Record<string, 'success' | 'warning' | 'neutral' | 'danger'> = {
  'workspace.member.added': 'success',
  'workspace.member.role_changed': 'neutral',
  'workspace.member.removed': 'warning',
  'workspace.invite.sent': 'neutral',
  'workspace.invite.revoked': 'warning',
  'workspace.invite.claimed': 'success',
  'workspace.ownership.transferred': 'danger',
};

const KIND_LABEL: Record<string, string> = {
  'workspace.member.added': 'Member added',
  'workspace.member.role_changed': 'Role changed',
  'workspace.member.removed': 'Member removed',
  'workspace.invite.sent': 'Invite sent',
  'workspace.invite.revoked': 'Invite revoked',
  'workspace.invite.claimed': 'Invite accepted',
  'workspace.ownership.transferred': 'Ownership transferred',
};

export default async function WorkspaceAuditPage() {
  const session = await auth();
  if (!session) redirect('/sign-in');

  const db = getDb();
  const workspaceId = session.user.workspaceId;

  // Admin gate (owner or admin). Plain members shouldn't see the audit
  // trail of governance actions on the workspace.
  const [me] = await db
    .select({ role: workspaceMember.role })
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.userId, session.user.id),
        eq(workspaceMember.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!me || (me.role !== 'owner' && me.role !== 'admin')) {
    return (
      <Page className="mx-auto max-w-3xl">
        <PageHeader title="Workspace audit" description="Owner or admin role required." />
      </Page>
    );
  }

  const rows = await db
    .select({
      id: timelineEvent.id,
      kind: timelineEvent.kind,
      title: timelineEvent.title,
      occurredAt: timelineEvent.occurredAt,
      payload: timelineEvent.payload,
      actorId: timelineEvent.userId,
    })
    .from(timelineEvent)
    .where(
      and(
        eq(timelineEvent.workspaceId, workspaceId),
        inArray(timelineEvent.kind, AUDIT_KINDS as unknown as string[]),
      ),
    )
    .orderBy(desc(timelineEvent.occurredAt))
    .limit(200);

  // Resolve actor display names in one round-trip.
  const actorIds = Array.from(
    new Set(rows.map((r) => r.actorId).filter((x): x is string => Boolean(x))),
  );
  const actors =
    actorIds.length > 0
      ? await db
          .select({ id: user.id, email: user.email, name: user.name })
          .from(user)
          .where(inArray(user.id, actorIds))
      : [];
  const actorById = new Map(actors.map((a) => [a.id, a]));

  return (
    <Page className="mx-auto max-w-3xl">
      <PageHeader
        title="Workspace audit"
        description="Last 200 governance events: invites, role changes, ownership transfers."
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <ScrollText className="h-3.5 w-3.5" />
            Admin
          </span>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<ScrollText className="h-5 w-5" />}
          title="No admin events yet"
          description="Adding members, sending invites, and transferring ownership will show up here."
          size="sm"
        />
      ) : (
        <Card>
          <ul className="divide-y divide-[var(--color-border)]">
            {rows.map((r) => {
              const actor = r.actorId ? actorById.get(r.actorId) : null;
              return (
                <li key={r.id} className="flex items-start gap-3 py-3 text-sm">
                  <Badge variant={KIND_TONE[r.kind] ?? 'neutral'} size="xs">
                    {KIND_LABEL[r.kind] ?? r.kind}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[var(--color-fg)]">{r.title}</div>
                    <div className="truncate text-[11px] text-[var(--color-fg-subtle)]">
                      {actor ? (actor.name ?? actor.email) : 'System'} ·{' '}
                      {new Date(r.occurredAt).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </Page>
  );
}

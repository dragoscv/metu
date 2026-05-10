import { auth } from '@metu/auth';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { Page, PageHeader } from '@metu/ui';
import { getDb } from '@metu/db';
import { user, workspaceMember } from '@metu/db/schema';
import { TeamManager, type TeamMember, type PendingInvite } from '@/components/team-manager';
import { listPendingInvites } from '@/app/actions/team';

export default async function TeamSettingsPage() {
  const session = await auth();
  if (!session) redirect('/sign-in');

  const db = getDb();
  const workspaceId = session.user.workspaceId;

  // Owner gate. Members + admins still see Settings, but team
  // management is restricted to the owner role.
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
  if (!me || me.role !== 'owner') {
    return (
      <Page className="mx-auto max-w-3xl">
        <PageHeader title="Team" description="Owner role required to manage members." />
      </Page>
    );
  }

  const rows = await db
    .select({
      userId: workspaceMember.userId,
      role: workspaceMember.role,
      joinedAt: workspaceMember.joinedAt,
      email: user.email,
      name: user.name,
    })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(eq(workspaceMember.workspaceId, workspaceId))
    .orderBy(asc(workspaceMember.joinedAt));

  const members: TeamMember[] = rows.map((r) => ({
    userId: r.userId,
    email: r.email,
    name: r.name,
    role: r.role,
    joinedAt: new Date(r.joinedAt).toISOString(),
    isSelf: r.userId === session.user.id,
  }));

  const inviteRows = await listPendingInvites(workspaceId);
  const invites: PendingInvite[] = inviteRows.map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    expiresAt: i.expiresAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
  }));

  return (
    <Page className="mx-auto max-w-3xl">
      <PageHeader
        title="Team"
        description="People who can act inside this workspace. Owners manage roles and billing."
      />
      <div className="mb-4 flex justify-end">
        <Link
          href="/settings/audit"
          className="text-xs text-[var(--color-fg-subtle)] underline-offset-4 hover:underline"
        >
          View audit log →
        </Link>
      </div>
      <TeamManager members={members} invites={invites} />
    </Page>
  );
}

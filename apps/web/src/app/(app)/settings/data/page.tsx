import { auth } from '@metu/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { Page, PageHeader } from '@metu/ui';
import { getDb } from '@metu/db';
import { workspace, workspaceMember } from '@metu/db/schema';
import { DangerZone } from '@/components/danger-zone';
import { CalendarFeedCard } from '@/components/calendar-feed-card';
import { getCalendarFeedToken } from '@/app/actions/calendar-feed';

export default async function DataSettingsPage() {
  const session = await auth();
  if (!session) redirect('/sign-in');

  const db = getDb();
  const workspaceId = session.user.workspaceId;

  const [ws] = await db
    .select({ id: workspace.id, name: workspace.name })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  if (!ws) redirect('/');

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

  const calendarToken = await getCalendarFeedToken();
  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:24890';
  const baseUrl = `${proto}://${host}`;
  const canManage = me?.role === 'owner' || me?.role === 'admin';

  return (
    <Page className="mx-auto max-w-3xl">
      <PageHeader
        title="Data"
        description="Take your data with you, or take it down. Both are your right."
      />
      <CalendarFeedCard initialToken={calendarToken} baseUrl={baseUrl} canManage={canManage} />
      <DangerZone workspaceId={ws.id} workspaceName={ws.name} isOwner={me?.role === 'owner'} />
    </Page>
  );
}

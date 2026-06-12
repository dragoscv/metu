import { auth } from '@metu/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { Card, CardTitle, Page, PageHeader } from '@metu/ui';
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
      {canManage ? (
        <Card className="space-y-2 p-5">
          <CardTitle>Export workspace</CardTitle>
          <p className="text-sm text-[var(--color-fg-subtle)]">
            Download everything — captures, tasks, projects, decisions, timeline, goals, and memory
            chunks (embeddings included) — as a single JSON file.
          </p>
          <a
            href="/settings/data/export"
            download
            className="inline-flex w-fit items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-bg-subtle)]"
          >
            Download takeout (.json)
          </a>
        </Card>
      ) : null}
      <DangerZone workspaceId={ws.id} workspaceName={ws.name} isOwner={me?.role === 'owner'} />
    </Page>
  );
}

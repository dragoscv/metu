import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { Page, PageHeader, Card } from '@metu/ui';
import { Building2 } from 'lucide-react';
import { getDb } from '@metu/db';
import { workspace, workspaceMember } from '@metu/db/schema';
import { WorkspaceSettingsForm } from '@/components/workspace-settings-form';

export const dynamic = 'force-dynamic';

export default async function WorkspaceSettingsPage() {
  const session = await auth();
  if (!session) redirect('/sign-in');

  const db = getDb();
  const workspaceId = session.user.workspaceId;

  const [ws] = await db
    .select({ id: workspace.id, name: workspace.name, slug: workspace.slug })
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
  const canManage = me?.role === 'owner' || me?.role === 'admin';

  return (
    <Page className="mx-auto max-w-2xl">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5" />
            Workspace
          </span>
        }
        title="Workspace settings"
        description="Rename your workspace or change its slug."
      />
      {canManage ? (
        <WorkspaceSettingsForm initialName={ws.name} initialSlug={ws.slug} />
      ) : (
        <Card className="text-sm text-[var(--color-fg-muted)]">
          Owner or admin role required to edit workspace settings.
        </Card>
      )}
    </Page>
  );
}

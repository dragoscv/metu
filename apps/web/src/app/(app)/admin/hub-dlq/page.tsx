import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { hubDlqEnvelope, workspaceMember } from '@metu/db/schema';
import { Page, PageHeader, Card, Badge } from '@metu/ui';
import { Inbox } from 'lucide-react';
import { ReplayDlqButton } from '@/components/admin/replay-dlq-button';

export default async function HubDlqAdminPage() {
  const session = await auth();
  if (!session) redirect('/sign-in');

  const db = getDb();
  const workspaceId = session.user.workspaceId;

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
        <PageHeader title="Hub DLQ" description="Owner or admin role required." />
      </Page>
    );
  }

  const rows = await db
    .select()
    .from(hubDlqEnvelope)
    .where(and(eq(hubDlqEnvelope.workspaceId, workspaceId), isNull(hubDlqEnvelope.replayedAt)))
    .orderBy(asc(hubDlqEnvelope.createdAt))
    .limit(200);

  return (
    <Page className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <Inbox className="h-3.5 w-3.5" />
            Operator
          </span>
        }
        title="Hub DLQ"
        description="Envelopes that failed to broadcast — replay after the cause is fixed."
      />
      {rows.length === 0 ? (
        <Card className="text-sm text-[var(--color-fg-muted)]">
          Nothing pending. The hub is delivering everything cleanly.
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-left text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
              <tr>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Attempts</th>
                <th className="px-3 py-2">First seen</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const env = r.envelope as { type?: string };
                return (
                  <tr key={r.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-3 py-2">
                      <Badge variant="warning">{r.reason}</Badge>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{env.type ?? '?'}</td>
                    <td className="px-3 py-2">{r.attempts}</td>
                    <td className="px-3 py-2 text-[var(--color-fg-muted)]">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <ReplayDlqButton id={r.id} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </Page>
  );
}

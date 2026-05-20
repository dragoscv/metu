/**
 * /proposals — pending Conductor tool-call proposals (notifications with
 * `metadata.toolProposal` and not yet acknowledged). Approve invokes
 * `agent.runTool()` through the policy gate; reject just acknowledges.
 */
import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { Page, PageHeader, Card, EmptyState } from '@metu/ui';
import { Sparkles } from 'lucide-react';
import { getDb } from '@metu/db';
import { notification } from '@metu/db/schema';
import { ProposalActions } from '@/components/proposal-actions';
import { formatDistanceToNow } from 'date-fns';

export const dynamic = 'force-dynamic';

interface ToolProposal {
  tool: string;
  args: Record<string, unknown>;
}

interface NotificationAction {
  id: string;
  label: string;
  kind: 'approve' | 'reject' | 'open' | 'custom';
}

export default async function ProposalsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const db = getDb();
  const rows = await db
    .select({
      id: notification.id,
      title: notification.title,
      body: notification.body,
      source: notification.source,
      actions: notification.actions,
      metadata: notification.metadata,
      createdAt: notification.createdAt,
    })
    .from(notification)
    .where(
      and(
        eq(notification.workspaceId, session.user.workspaceId),
        eq(notification.userId, session.user.id),
        isNull(notification.acknowledgedAt),
        sql`${notification.metadata} ? 'toolProposal'`,
      ),
    )
    .orderBy(desc(notification.createdAt))
    .limit(50);

  return (
    <Page className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            Conductor
          </span>
        }
        title="Proposals"
        description={`${rows.length} pending tool ${rows.length === 1 ? 'proposal' : 'proposals'}`}
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="h-6 w-6" />}
          title="No pending proposals"
          description="When the Conductor wants to act on your behalf, suggestions land here for approval."
        />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const proposal = (r.metadata as { toolProposal?: ToolProposal } | null)?.toolProposal;
            const actions = (r.actions as NotificationAction[]) ?? [];
            return (
              <Card key={r.id} className="border-[var(--color-brand)]/40 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">{r.title}</div>
                  <span className="text-[11px] text-[var(--color-fg-subtle)]">
                    {formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}
                  </span>
                </div>
                {r.body ? <p className="text-sm text-[var(--color-fg-muted)]">{r.body}</p> : null}
                {proposal ? (
                  <div className="rounded-md bg-[var(--color-bg-elevated)] px-2 py-1 font-mono text-[11px] text-[var(--color-fg-subtle)]">
                    <span className="text-[var(--color-fg)]">{proposal.tool}</span>
                    {Object.keys(proposal.args).length > 0
                      ? `(${Object.keys(proposal.args).join(', ')})`
                      : '()'}
                  </div>
                ) : null}
                <ProposalActions
                  notificationId={r.id}
                  actions={actions}
                  hasToolProposal={!!proposal}
                />
                <div className="text-[11px] text-[var(--color-fg-subtle)]">{r.source}</div>
              </Card>
            );
          })}
        </div>
      )}
    </Page>
  );
}

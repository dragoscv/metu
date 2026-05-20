/**
 * Tool-call detail view — read-only inspector for a single
 * `tool_call` row, with an undo button when the call succeeded
 * and persisted an `undoPayload`.
 *
 * Linked from /agents and from any timeline event whose payload
 * carries a `toolCallId`. Workspace-scoped read.
 */
import { auth } from '@metu/auth';
import { redirect, notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { Page, PageHeader, PageSection, Card, Badge } from '@metu/ui';
import { Wrench } from 'lucide-react';
import { getDb } from '@metu/db';
import { toolCall } from '@metu/db/schema';
import { ToolCallUndoButton } from '@/components/tool-call-undo-button';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, string> = {
  success: 'text-emerald-300',
  failed: 'text-red-300',
  rejected: 'text-amber-300',
  pending: 'text-zinc-300',
  awaiting_approval: 'text-amber-300',
};

export default async function ToolCallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const db = getDb();
  const [row] = await db
    .select()
    .from(toolCall)
    .where(and(eq(toolCall.id, id), eq(toolCall.workspaceId, session.user.workspaceId)))
    .limit(1);
  if (!row) notFound();

  const canUndo = row.status === 'success' && !!row.undoPayload;

  return (
    <Page>
      <PageHeader
        accent={<Wrench className="h-5 w-5 text-[var(--color-brand)]" />}
        eyebrow="Conductor"
        title={row.tool}
        description={`requested ${new Date(row.requestedAt).toLocaleString()}${row.aclMode ? ` · acl: ${row.aclMode}` : ''}`}
        back={{ href: '/agents', label: 'Agents' }}
        actions={canUndo ? <ToolCallUndoButton toolCallId={row.id} /> : null}
      />

      <PageSection title="Status">
        <Card>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>
              <span className={STATUS_TONE[row.status] ?? ''}>{row.status}</span>
            </Badge>
            {row.actualCostUsd != null ? (
              <span className="text-xs text-[var(--color-fg-subtle)]">
                cost: ${Number(row.actualCostUsd).toFixed(4)}
              </span>
            ) : null}
            {row.finishedAt ? (
              <span className="text-xs text-[var(--color-fg-subtle)]">
                finished {new Date(row.finishedAt).toLocaleString()}
              </span>
            ) : null}
          </div>
          {row.error ? (
            <pre className="mt-3 max-h-40 overflow-auto rounded bg-[var(--color-bg-elevated)] p-2 font-mono text-xs text-red-300">
              {row.error}
            </pre>
          ) : null}
        </Card>
      </PageSection>

      <PageSection title="Arguments">
        <Card>
          <pre className="max-h-96 overflow-auto font-mono text-xs">
            {JSON.stringify(row.args, null, 2)}
          </pre>
        </Card>
      </PageSection>

      {row.result != null ? (
        <PageSection title="Result">
          <Card>
            <pre className="max-h-96 overflow-auto font-mono text-xs">
              {JSON.stringify(row.result, null, 2)}
            </pre>
          </Card>
        </PageSection>
      ) : null}

      {row.undoPayload != null ? (
        <PageSection title="Undo payload" description="Snapshot used to reverse this action.">
          <Card>
            <pre className="max-h-96 overflow-auto font-mono text-xs">
              {JSON.stringify(row.undoPayload, null, 2)}
            </pre>
          </Card>
        </PageSection>
      ) : null}
    </Page>
  );
}

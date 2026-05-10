/**
 * /audit/[id] — detail view of a single tool call. Shows the full row
 * (args, result, error, ACL mode, costs, timestamps) plus a chain of
 * sibling tool calls from the same conversation or agent run, and
 * action buttons (approve / reject / undo) gated on status + undoPayload.
 */
import { auth } from '@metu/auth';
import { getToolCallById, listRelatedToolCalls } from '@metu/db/queries';
import { Card, CardTitle, Page, PageHeader } from '@metu/ui';
import { format } from 'date-fns';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ToolCallActions } from '@/components/audit/tool-call-actions';

interface PageProps {
  params: Promise<{ id: string }>;
}

const STATUS_TONE: Record<string, string> = {
  success: 'bg-[var(--color-success-bg)] text-[var(--color-success)]',
  failed: 'bg-[var(--color-danger-bg)] text-[var(--color-danger)]',
  rejected: 'bg-[var(--color-danger-bg)] text-[var(--color-danger)]',
  awaiting_approval: 'bg-[var(--color-warning-bg)] text-[var(--color-warning)]',
  approved: 'bg-[var(--color-info-bg,rgba(59,130,246,0.15))] text-[var(--color-info,#3b82f6)]',
  pending: 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)]',
  running: 'bg-[var(--color-brand)]/10 text-[var(--color-brand)]',
  undone: 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)]',
  cancelled: 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)]',
};

const RELATED_TONE: Record<string, string> = {
  success: 'text-[var(--color-success)]',
  failed: 'text-[var(--color-danger)]',
  rejected: 'text-[var(--color-danger)]',
  awaiting_approval: 'text-[var(--color-warning)]',
  approved: 'text-[var(--color-info,#3b82f6)]',
  pending: 'text-[var(--color-fg-subtle)]',
  running: 'text-[var(--color-brand)]',
  undone: 'text-[var(--color-fg-subtle)]',
  cancelled: 'text-[var(--color-fg-subtle)]',
};

export default async function ToolCallDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const { id } = await params;
  const row = await getToolCallById(session.user.workspaceId, id);
  if (!row) notFound();

  const related = await listRelatedToolCalls({
    workspaceId: session.user.workspaceId,
    excludeId: row.id,
    conversationId: row.conversationId,
    agentRunId: row.agentRunId,
    limit: 30,
  });

  const tone = STATUS_TONE[row.status] ?? STATUS_TONE.pending;
  const hasUndoPayload = row.undoPayload !== null && row.undoPayload !== undefined;
  const cost = row.actualCostUsd ?? row.estimatedCostUsd;

  return (
    <Page className="mx-auto max-w-3xl">
      <PageHeader
        size="sm"
        back={{ href: '/audit', label: 'Audit' }}
        eyebrow={
          <span className="text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            Tool call · {row.aclMode ?? 'no acl'}
          </span>
        }
        title={<span className="font-mono">{row.tool}</span>}
        description={
          <span className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-fg-subtle)]">
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${tone}`}
            >
              {row.status}
            </span>
            <time dateTime={row.requestedAt.toISOString()}>
              {format(row.requestedAt, 'EEE, MMM d, yyyy · HH:mm:ss')}
            </time>
            {cost && cost > 0 ? <span>· ${cost.toFixed(4)}</span> : null}
          </span>
        }
      />

      <ToolCallActions toolCallId={row.id} status={row.status} hasUndoPayload={hasUndoPayload} />

      <Card>
        <CardTitle>Arguments</CardTitle>
        <pre className="mt-2 max-h-72 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 font-mono text-[11px] leading-relaxed">
          {safeStringify(row.args)}
        </pre>
      </Card>

      {row.result !== null ? (
        <Card>
          <CardTitle>Result</CardTitle>
          <pre className="mt-2 max-h-96 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 font-mono text-[11px] leading-relaxed">
            {safeStringify(row.result)}
          </pre>
        </Card>
      ) : null}

      {row.error ? (
        <Card>
          <CardTitle className="text-[var(--color-danger)]">Error</CardTitle>
          <pre className="border-[var(--color-danger)]/40 mt-2 max-h-72 overflow-auto rounded border bg-[var(--color-bg-elevated)] px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--color-danger)]">
            {row.error}
          </pre>
        </Card>
      ) : null}

      {hasUndoPayload ? (
        <Card>
          <CardTitle>Undo payload</CardTitle>
          <pre className="mt-2 max-h-56 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 font-mono text-[11px] leading-relaxed">
            {safeStringify(row.undoPayload)}
          </pre>
        </Card>
      ) : null}

      <Card>
        <CardTitle>Timestamps</CardTitle>
        <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
          <Stamp label="Requested" iso={row.requestedAt.toISOString()} />
          {row.decidedAt ? <Stamp label="Decided" iso={row.decidedAt.toISOString()} /> : null}
          {row.finishedAt ? <Stamp label="Finished" iso={row.finishedAt.toISOString()} /> : null}
          <dt className="text-[var(--color-fg-subtle)]">ID</dt>
          <dd className="font-mono">{row.id}</dd>
          {row.conversationId ? (
            <>
              <dt className="text-[var(--color-fg-subtle)]">Conversation</dt>
              <dd>
                <Link
                  href={`/chat?c=${row.conversationId}`}
                  className="font-mono text-[var(--color-brand)] hover:underline"
                >
                  {row.conversationId}
                </Link>
              </dd>
            </>
          ) : null}
          {row.agentRunId ? (
            <>
              <dt className="text-[var(--color-fg-subtle)]">Agent run</dt>
              <dd className="font-mono">{row.agentRunId}</dd>
            </>
          ) : null}
        </dl>
      </Card>

      {related.length > 0 ? (
        <Card>
          <CardTitle>
            Related tool calls
            <span className="ml-2 text-[10px] font-normal uppercase tracking-wider text-[var(--color-fg-subtle)]">
              same {row.conversationId ? 'conversation' : 'agent run'} · {related.length}
            </span>
          </CardTitle>
          <ul className="mt-2 divide-y divide-[var(--color-border)]">
            {related.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/audit/${r.id}`}
                  className="flex items-center gap-3 px-1 py-2 text-sm hover:bg-[var(--color-bg-elevated)]"
                >
                  <span className="w-20 shrink-0 text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
                    {format(r.requestedAt, 'HH:mm:ss')}
                  </span>
                  <span className="flex-1 truncate font-mono">{r.tool}</span>
                  <span
                    className={`text-[10px] uppercase tracking-wider ${
                      RELATED_TONE[r.status] ?? RELATED_TONE.pending
                    }`}
                  >
                    {r.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </Page>
  );
}

function Stamp({ label, iso }: { label: string; iso: string }) {
  return (
    <>
      <dt className="text-[var(--color-fg-subtle)]">{label}</dt>
      <dd>
        <time dateTime={iso}>{format(new Date(iso), 'MMM d, yyyy · HH:mm:ss')}</time>
      </dd>
    </>
  );
}

function safeStringify(v: unknown): string {
  if (v == null) return 'null';
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

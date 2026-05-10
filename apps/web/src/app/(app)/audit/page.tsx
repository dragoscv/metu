/**
 * Audit page — workspace-wide observability over every `tool_call` row.
 *
 * Reads the existing audit trail produced by the Conductor, MCP server,
 * companion device tools, and any SDK invocation. Server-rendered with
 * URL-driven filters (tools, statuses, since, q) — no client store.
 */
import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import {
  listToolCalls,
  toolCallByAclMode,
  toolCallDailyCost,
  toolCallStatusFacets,
  toolCallSummary,
  toolCallTopByCost,
  toolCallToolFacets,
  type ToolCallStatusFilter,
} from '@metu/db/queries';
import { Card, Page, PageHeader } from '@metu/ui';
import { AuditToolbar } from '@/components/audit/audit-toolbar';
import { AuditList } from '@/components/audit/audit-list';
import { AuditAclPanel } from '@/components/audit/audit-acl-panel';
import { AuditCostPanel } from '@/components/audit/audit-cost-panel';
import { CompanionAgentPanel } from '@/components/audit/companion-agent-panel';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    tools?: string;
    statuses?: string;
    since?: string;
    q?: string;
  }>;
}

const DEFAULT_SINCE_DAYS = 7;

function parseSince(since: string | undefined): Date {
  const m = since?.match(/^(\d+)d$/);
  const days = m ? Number(m[1]) : DEFAULT_SINCE_DAYS;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

const VALID_STATUSES: ToolCallStatusFilter[] = [
  'pending',
  'awaiting_approval',
  'approved',
  'rejected',
  'running',
  'success',
  'failed',
  'undone',
  'cancelled',
];

export default async function AuditPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const wsId = session.user.workspaceId;
  const sp = await searchParams;

  const since = parseSince(sp.since);
  const tools = sp.tools ? sp.tools.split(',').filter(Boolean) : [];
  const statuses = (sp.statuses ? sp.statuses.split(',').filter(Boolean) : []).filter(
    (s): s is ToolCallStatusFilter => (VALID_STATUSES as string[]).includes(s),
  );

  const [{ items, nextCursor }, toolFacets, statusFacets, summary, dailyCost, topByCost, aclRows] =
    await Promise.all([
      listToolCalls({
        workspaceId: wsId,
        tools: tools.length > 0 ? tools : undefined,
        statuses: statuses.length > 0 ? statuses : undefined,
        since,
        search: sp.q || null,
        limit: 60,
      }),
      toolCallToolFacets(wsId, since),
      toolCallStatusFacets(wsId, since),
      toolCallSummary(wsId, since),
      toolCallDailyCost(wsId, since),
      toolCallTopByCost(wsId, since, 5),
      toolCallByAclMode(wsId, since),
    ]);

  const initialItems = items.map((r) => ({
    id: r.id,
    tool: r.tool,
    status: r.status,
    aclMode: r.aclMode,
    error: r.error,
    estimatedCostUsd: r.estimatedCostUsd,
    actualCostUsd: r.actualCostUsd,
    requestedAt: r.requestedAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
    conversationId: r.conversationId,
    conversationTitle: r.conversationTitle,
    agentRunId: r.agentRunId,
    agentRunKind: r.agentRunKind,
    args: r.args,
    result: r.result,
    hasUndoPayload: r.hasUndoPayload,
  }));

  return (
    <Page className="space-y-5">
      <PageHeader
        title="Audit"
        description="Every tool the Conductor — and every connected agent — has touched in this workspace."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryStat label="Calls" value={summary.total} />
        <SummaryStat
          label="Awaiting approval"
          value={summary.awaiting}
          tone={summary.awaiting > 0 ? 'warn' : 'muted'}
        />
        <SummaryStat
          label="Failed"
          value={summary.failed}
          tone={summary.failed > 0 ? 'danger' : 'muted'}
        />
        <SummaryStat
          label="Cost (USD)"
          value={summary.cost > 0 ? `$${summary.cost.toFixed(3)}` : '—'}
        />
      </div>

      <AuditCostPanel daily={dailyCost} top={topByCost} totalCost={summary.cost} />

      <CompanionAgentPanel workspaceId={wsId} since={since} />

      <AuditAclPanel rows={aclRows} />

      <AuditToolbar toolFacets={toolFacets} statusFacets={statusFacets} />

      <AuditList items={initialItems} hasMore={nextCursor !== null} />
    </Page>
  );
}

function SummaryStat({
  label,
  value,
  tone = 'muted',
}: {
  label: string;
  value: string | number;
  tone?: 'muted' | 'warn' | 'danger';
}) {
  const toneCls =
    tone === 'danger'
      ? 'text-[var(--color-danger)]'
      : tone === 'warn'
        ? 'text-[var(--color-warning)]'
        : 'text-[var(--color-fg)]';
  return (
    <Card>
      <div className="text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
        {label}
      </div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${toneCls}`}>{value}</div>
    </Card>
  );
}

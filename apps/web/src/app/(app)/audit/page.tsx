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
  agentRunSummary,
  listToolCalls,
  toolCallByAclMode,
  toolCallDailyCost,
  toolCallRunKindFacets,
  toolCallStatusFacets,
  toolCallSummary,
  toolCallTopByCost,
  toolCallToolFacets,
  type ToolCallStatusFilter,
} from '@metu/db/queries';
import { Card, EmptyState, Page, PageHeader } from '@metu/ui';
import { ScrollText } from 'lucide-react';
import { AuditToolbar } from '@/components/audit/audit-toolbar';
import { KeyboardFocus } from '@/components/keyboard-focus';
import { AuditList } from '@/components/audit/audit-list';
import { AuditAclPanel } from '@/components/audit/audit-acl-panel';
import { AuditCostPanel } from '@/components/audit/audit-cost-panel';
import { AuditFailureClusters } from '@/components/audit/audit-failure-clusters';
import { AuditMtdCost } from '@/components/audit/audit-mtd-cost';
import { AgentRunPanel } from '@/components/audit/agent-run-panel';
import { CompanionAgentPanel } from '@/components/audit/companion-agent-panel';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    tools?: string;
    statuses?: string;
    kinds?: string;
    since?: string;
    q?: string;
  }>;
}

const DEFAULT_SINCE_DAYS = 7;

function parseSince(since: string | undefined): Date {
  if (since === 'today') {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
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
  const runKinds = sp.kinds ? sp.kinds.split(',').filter(Boolean) : [];

  const [
    { items, nextCursor },
    toolFacets,
    statusFacets,
    runKindFacets,
    summary,
    dailyCost,
    topByCost,
    aclRows,
    runRows,
  ] = await Promise.all([
    listToolCalls({
      workspaceId: wsId,
      tools: tools.length > 0 ? tools : undefined,
      statuses: statuses.length > 0 ? statuses : undefined,
      runKinds: runKinds.length > 0 ? runKinds : undefined,
      since,
      search: sp.q || null,
      limit: 60,
    }),
    toolCallToolFacets(wsId, since),
    toolCallStatusFacets(wsId, since),
    toolCallRunKindFacets(wsId, since),
    toolCallSummary(wsId, since),
    toolCallDailyCost(wsId, since),
    toolCallTopByCost(wsId, since, 5),
    toolCallByAclMode(wsId, since),
    agentRunSummary(wsId, since),
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

      <AuditMtdCost workspaceId={wsId} />

      <AuditCostPanel daily={dailyCost} top={topByCost} totalCost={summary.cost} />

      <AuditFailureClusters workspaceId={wsId} since={since} />

      <AgentRunPanel rows={runRows} />

      <CompanionAgentPanel workspaceId={wsId} since={since} />

      <AuditAclPanel rows={aclRows} />

      <AuditToolbar
        toolFacets={toolFacets}
        statusFacets={statusFacets}
        runKindFacets={runKindFacets}
      />
      <KeyboardFocus targetId="audit-search" />

      {summary.total === 0 &&
      tools.length === 0 &&
      statuses.length === 0 &&
      runKinds.length === 0 &&
      !sp.q ? (
        <EmptyState
          icon={<ScrollText className="h-5 w-5" />}
          title="The Conductor hasn’t acted yet"
          description="Once you start a conversation or an agent triggers a tool, every call will be logged here — args, result, ACL decision, cost, the lot."
        />
      ) : (
        <AuditList items={initialItems} hasMore={nextCursor !== null} />
      )}
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

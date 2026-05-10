/**
 * Tool-call audit queries — list + facets for the workspace-wide
 * observability page (apps/web /audit). Joins lightly to `agentRun`
 * and `conversation` so the UI can show "what triggered this".
 */
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '../client';
import { toolCall, agentRun, conversation } from '../schema';

export type ToolCallStatusFilter =
  | 'pending'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'running'
  | 'success'
  | 'failed'
  | 'undone'
  | 'cancelled';

export interface ListToolCallsParams {
  workspaceId: string;
  tools?: string[];
  statuses?: ToolCallStatusFilter[];
  since?: Date | null;
  search?: string | null;
  cursor?: { requestedAt: Date; id: string } | null;
  limit?: number;
}

export async function listToolCalls({
  workspaceId,
  tools,
  statuses,
  since,
  search,
  cursor,
  limit = 50,
}: ListToolCallsParams) {
  const db = getDb();
  const conditions: SQL[] = [eq(toolCall.workspaceId, workspaceId)];
  if (tools && tools.length > 0) conditions.push(inArray(toolCall.tool, tools));
  if (statuses && statuses.length > 0)
    conditions.push(sql`${toolCall.status} = ANY(${statuses}::text[])`);
  if (since) conditions.push(sql`${toolCall.requestedAt} >= ${since}`);
  if (search && search.trim()) {
    const q = `%${search.trim()}%`;
    const orClause = or(ilike(toolCall.tool, q), ilike(toolCall.error, q));
    if (orClause) conditions.push(orClause);
  }
  if (cursor) {
    conditions.push(
      sql`(${toolCall.requestedAt}, ${toolCall.id}) < (${cursor.requestedAt}, ${cursor.id})`,
    );
  }

  const rows = await db
    .select({
      id: toolCall.id,
      tool: toolCall.tool,
      status: toolCall.status,
      args: toolCall.args,
      result: toolCall.result,
      error: toolCall.error,
      aclMode: toolCall.aclMode,
      estimatedCostUsd: toolCall.estimatedCostUsd,
      actualCostUsd: toolCall.actualCostUsd,
      hasUndoPayload: sql<boolean>`${toolCall.undoPayload} is not null`,
      requestedAt: toolCall.requestedAt,
      decidedAt: toolCall.decidedAt,
      finishedAt: toolCall.finishedAt,
      conversationId: toolCall.conversationId,
      agentRunId: toolCall.agentRunId,
      agentRunKind: agentRun.kind,
      conversationTitle: conversation.title,
    })
    .from(toolCall)
    .leftJoin(
      agentRun,
      and(eq(toolCall.agentRunId, agentRun.id), eq(agentRun.workspaceId, toolCall.workspaceId)),
    )
    .leftJoin(
      conversation,
      and(
        eq(toolCall.conversationId, conversation.id),
        eq(conversation.workspaceId, toolCall.workspaceId),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(toolCall.requestedAt), desc(toolCall.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last ? { requestedAt: last.requestedAt.toISOString(), id: last.id } : null;
  return { items, nextCursor };
}

/**
 * Export-friendly query — same filters as `listToolCalls` but no
 * cursor and a hard cap. Powers the `/api/audit/export` CSV endpoint.
 * The cap is intentionally generous (50k rows ≈ a few MB of CSV) but
 * non-infinite so a runaway filter can't OOM the route handler.
 */
export interface ExportToolCallsParams {
  workspaceId: string;
  tools?: string[];
  statuses?: ToolCallStatusFilter[];
  since?: Date | null;
  search?: string | null;
  limit?: number;
}

export async function exportToolCalls({
  workspaceId,
  tools,
  statuses,
  since,
  search,
  limit = 50_000,
}: ExportToolCallsParams) {
  const db = getDb();
  const conditions: SQL[] = [eq(toolCall.workspaceId, workspaceId)];
  if (tools && tools.length > 0) conditions.push(inArray(toolCall.tool, tools));
  if (statuses && statuses.length > 0)
    conditions.push(sql`${toolCall.status} = ANY(${statuses}::text[])`);
  if (since) conditions.push(sql`${toolCall.requestedAt} >= ${since}`);
  if (search && search.trim()) {
    const q = `%${search.trim()}%`;
    const orClause = or(ilike(toolCall.tool, q), ilike(toolCall.error, q));
    if (orClause) conditions.push(orClause);
  }
  return db
    .select({
      id: toolCall.id,
      tool: toolCall.tool,
      status: toolCall.status,
      aclMode: toolCall.aclMode,
      estimatedCostUsd: toolCall.estimatedCostUsd,
      actualCostUsd: toolCall.actualCostUsd,
      error: toolCall.error,
      requestedAt: toolCall.requestedAt,
      decidedAt: toolCall.decidedAt,
      finishedAt: toolCall.finishedAt,
      conversationId: toolCall.conversationId,
      agentRunId: toolCall.agentRunId,
      agentRunKind: agentRun.kind,
      conversationTitle: conversation.title,
    })
    .from(toolCall)
    .leftJoin(
      agentRun,
      and(eq(toolCall.agentRunId, agentRun.id), eq(agentRun.workspaceId, toolCall.workspaceId)),
    )
    .leftJoin(
      conversation,
      and(
        eq(toolCall.conversationId, conversation.id),
        eq(conversation.workspaceId, toolCall.workspaceId),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(toolCall.requestedAt), desc(toolCall.id))
    .limit(limit);
}

export async function toolCallToolFacets(workspaceId: string, since?: Date | null) {
  const db = getDb();
  const conds: SQL[] = [eq(toolCall.workspaceId, workspaceId)];
  if (since) conds.push(sql`${toolCall.requestedAt} >= ${since}`);
  const rows = await db
    .select({ tool: toolCall.tool, count: sql<number>`count(*)::int` })
    .from(toolCall)
    .where(and(...conds))
    .groupBy(toolCall.tool)
    .orderBy(desc(sql`count(*)`));
  return rows;
}

export async function toolCallStatusFacets(workspaceId: string, since?: Date | null) {
  const db = getDb();
  const conds: SQL[] = [eq(toolCall.workspaceId, workspaceId)];
  if (since) conds.push(sql`${toolCall.requestedAt} >= ${since}`);
  const rows = await db
    .select({ status: toolCall.status, count: sql<number>`count(*)::int` })
    .from(toolCall)
    .where(and(...conds))
    .groupBy(toolCall.status)
    .orderBy(desc(sql`count(*)`));
  return rows;
}

/** Lightweight aggregates for the page header strip. */
export async function toolCallSummary(workspaceId: string, since: Date) {
  const db = getDb();
  const [agg] = await db
    .select({
      total: sql<number>`count(*)::int`,
      failed: sql<number>`count(*) filter (where ${toolCall.status} = 'failed')::int`,
      awaiting: sql<number>`count(*) filter (where ${toolCall.status} = 'awaiting_approval')::int`,
      cost: sql<number>`coalesce(sum(${toolCall.actualCostUsd}), 0)::float8`,
    })
    .from(toolCall)
    .where(and(eq(toolCall.workspaceId, workspaceId), sql`${toolCall.requestedAt} >= ${since}`));
  return agg ?? { total: 0, failed: 0, awaiting: 0, cost: 0 };
}

/**
 * Sidebar badge counter — returns failed + awaiting_approval calls in
 * the window. Both states are user-actionable: failed wants an eyeball,
 * awaiting wants an approve/reject. Fast: single aggregate, indexed
 * by (workspace_id, status).
 */
export async function attentionToolCallCount(workspaceId: string, since: Date) {
  const db = getDb();
  const [row] = await db
    .select({
      n: sql<number>`count(*) filter (where ${toolCall.status} in ('failed', 'awaiting_approval'))::int`,
    })
    .from(toolCall)
    .where(and(eq(toolCall.workspaceId, workspaceId), sql`${toolCall.requestedAt} >= ${since}`));
  return row?.n ?? 0;
}

/**
 * Daily cost rollup over a window. Returns one row per UTC day from
 * `since` to today (zeros included for empty days). Used by the
 * sparkline on `/audit` so the timeline reads continuously even when
 * nothing ran.
 */
export async function toolCallDailyCost(workspaceId: string, since: Date) {
  const db = getDb();
  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${toolCall.requestedAt}), 'YYYY-MM-DD')`,
      cost: sql<number>`coalesce(sum(${toolCall.actualCostUsd}), 0)::float8`,
      calls: sql<number>`count(*)::int`,
    })
    .from(toolCall)
    .where(and(eq(toolCall.workspaceId, workspaceId), sql`${toolCall.requestedAt} >= ${since}`))
    .groupBy(sql`date_trunc('day', ${toolCall.requestedAt})`);

  const byDay = new Map<string, { cost: number; calls: number }>();
  for (const r of rows) {
    byDay.set(r.day, {
      cost: typeof r.cost === 'string' ? Number(r.cost) : r.cost,
      calls: typeof r.calls === 'string' ? Number(r.calls) : r.calls,
    });
  }

  // Fill zeros for empty days so the sparkline is continuous.
  const out: { day: string; cost: number; calls: number }[] = [];
  const start = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()));
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  for (let d = start; d <= end; d = new Date(d.getTime() + 86_400_000)) {
    const key = d.toISOString().slice(0, 10);
    const hit = byDay.get(key);
    out.push({ day: key, cost: hit?.cost ?? 0, calls: hit?.calls ?? 0 });
  }
  return out;
}

/**
 * Top-N most expensive tools in the window, aggregated across calls.
 * Sorted by total `actual_cost_usd` descending; tools with zero cost
 * are excluded so the panel only surfaces actual spend.
 */
export async function toolCallTopByCost(workspaceId: string, since: Date, limit = 5) {
  const db = getDb();
  const rows = await db
    .select({
      tool: toolCall.tool,
      total: sql<number>`coalesce(sum(${toolCall.actualCostUsd}), 0)::float8`,
      calls: sql<number>`count(*)::int`,
    })
    .from(toolCall)
    .where(
      and(
        eq(toolCall.workspaceId, workspaceId),
        sql`${toolCall.requestedAt} >= ${since}`,
        sql`${toolCall.actualCostUsd} > 0`,
      ),
    )
    .groupBy(toolCall.tool)
    .orderBy(desc(sql`coalesce(sum(${toolCall.actualCostUsd}), 0)`))
    .limit(limit);
  return rows;
}

/**
 * Per-(tool, aclMode) aggregates over the window. Powers the "ACL
 * mode comparison" panel — at a glance, see whether autopilot tools
 * cost more per call than the same tool in `ask`/`auto-with-undo`,
 * or whether `observe`-only invocations dominate volume without
 * landing any spend.
 *
 * Returns rows sorted by total cost desc, then call count desc, so
 * the highest-spend pairs surface first. Includes zero-cost rows
 * (unlike `toolCallTopByCost`) because volume-without-spend is
 * itself a useful signal — e.g. "we observed 200 device.capture
 * calls, none of them metered".
 */
export async function toolCallByAclMode(workspaceId: string, since: Date) {
  const db = getDb();
  const rows = await db
    .select({
      tool: toolCall.tool,
      aclMode: toolCall.aclMode,
      calls: sql<number>`count(*)::int`,
      successCalls: sql<number>`count(*) filter (where ${toolCall.status} = 'success')::int`,
      failedCalls: sql<number>`count(*) filter (where ${toolCall.status} = 'failed')::int`,
      rejectedCalls: sql<number>`count(*) filter (where ${toolCall.status} = 'rejected')::int`,
      totalCost: sql<number>`coalesce(sum(${toolCall.actualCostUsd}), 0)::float8`,
      avgCost: sql<number>`coalesce(avg(${toolCall.actualCostUsd}) filter (where ${toolCall.actualCostUsd} > 0), 0)::float8`,
      maxCost: sql<number>`coalesce(max(${toolCall.actualCostUsd}), 0)::float8`,
    })
    .from(toolCall)
    .where(and(eq(toolCall.workspaceId, workspaceId), sql`${toolCall.requestedAt} >= ${since}`))
    .groupBy(toolCall.tool, toolCall.aclMode)
    .orderBy(desc(sql`coalesce(sum(${toolCall.actualCostUsd}), 0)`), desc(sql`count(*)`));
  return rows;
}

/**
 * Tools where the autopilot avg cost meaningfully exceeds the cheaper
 * `ask` / `auto_with_undo` mode for the same tool. Surfaces actionable
 * "consider downgrading" hints inline in /settings/autonomy.
 *
 * Filters:
 *   - Both autopilot AND a baseline mode (ask or auto_with_undo) must
 *     have at least `minCalls` metered calls in the window. Otherwise
 *     the multiplier is statistical noise.
 *   - The baseline avg cost must be > 0 (no point comparing to free).
 *   - The multiplier must be ≥ `minMultiplier` (default 2×).
 *
 * Returns one row per affected tool with the cheapest baseline mode
 * and the multiplier, sorted by multiplier desc.
 */
export async function toolCallAclWarnings(params: {
  workspaceId: string;
  since: Date;
  minCalls?: number;
  minMultiplier?: number;
}) {
  const { workspaceId, since, minCalls = 3, minMultiplier = 2 } = params;
  const db = getDb();
  // Per (tool, aclMode) avg of metered calls + metered call count.
  const rows = await db
    .select({
      tool: toolCall.tool,
      aclMode: toolCall.aclMode,
      meteredCalls: sql<number>`count(*) filter (where ${toolCall.actualCostUsd} > 0)::int`,
      avgCost: sql<number>`coalesce(avg(${toolCall.actualCostUsd}) filter (where ${toolCall.actualCostUsd} > 0), 0)::float8`,
    })
    .from(toolCall)
    .where(
      and(
        eq(toolCall.workspaceId, workspaceId),
        sql`${toolCall.requestedAt} >= ${since}`,
        sql`${toolCall.aclMode} in ('ask', 'auto_with_undo', 'autopilot')`,
      ),
    )
    .groupBy(toolCall.tool, toolCall.aclMode);

  interface ModeStat {
    meteredCalls: number;
    avgCost: number;
  }
  const byTool = new Map<string, Map<string, ModeStat>>();
  for (const r of rows) {
    if (!r.aclMode) continue;
    const m = byTool.get(r.tool) ?? new Map<string, ModeStat>();
    m.set(r.aclMode, { meteredCalls: r.meteredCalls, avgCost: r.avgCost });
    byTool.set(r.tool, m);
  }

  const out: {
    tool: string;
    autopilotAvg: number;
    autopilotCalls: number;
    baselineMode: 'ask' | 'auto_with_undo';
    baselineAvg: number;
    baselineCalls: number;
    multiplier: number;
  }[] = [];

  for (const [tool, modes] of byTool) {
    const ap = modes.get('autopilot');
    if (!ap || ap.meteredCalls < minCalls || ap.avgCost <= 0) continue;

    // Pick the cheapest qualifying baseline mode.
    const candidates: { mode: 'ask' | 'auto_with_undo'; stat: ModeStat }[] = [];
    for (const baseline of ['ask', 'auto_with_undo'] as const) {
      const s = modes.get(baseline);
      if (s && s.meteredCalls >= minCalls && s.avgCost > 0) {
        candidates.push({ mode: baseline, stat: s });
      }
    }
    if (candidates.length === 0) continue;
    const cheapest = candidates.reduce((a, b) => (b.stat.avgCost < a.stat.avgCost ? b : a));

    const multiplier = ap.avgCost / cheapest.stat.avgCost;
    if (multiplier < minMultiplier) continue;

    out.push({
      tool,
      autopilotAvg: ap.avgCost,
      autopilotCalls: ap.meteredCalls,
      baselineMode: cheapest.mode,
      baselineAvg: cheapest.stat.avgCost,
      baselineCalls: cheapest.stat.meteredCalls,
      multiplier,
    });
  }

  return out.sort((a, b) => b.multiplier - a.multiplier);
}

export async function getToolCallById(workspaceId: string, id: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(toolCall)
    .where(and(eq(toolCall.workspaceId, workspaceId), eq(toolCall.id, id)))
    .limit(1);
  return row ?? null;
}

/**
 * Sibling tool calls in the same conversation or agent run, ordered by
 * `requestedAt` ascending so the UI can render the call sequence in
 * temporal order. Excludes the focal row.
 */
export async function listRelatedToolCalls(params: {
  workspaceId: string;
  excludeId: string;
  conversationId?: string | null;
  agentRunId?: string | null;
  limit?: number;
}) {
  const { workspaceId, excludeId, conversationId, agentRunId, limit = 30 } = params;
  if (!conversationId && !agentRunId) return [];
  const db = getDb();
  const scopes: SQL[] = [];
  if (conversationId) scopes.push(eq(toolCall.conversationId, conversationId));
  if (agentRunId) scopes.push(eq(toolCall.agentRunId, agentRunId));
  const scopeOr = or(...scopes);
  const where = and(
    eq(toolCall.workspaceId, workspaceId),
    sql`${toolCall.id} <> ${excludeId}`,
    scopeOr ?? sql`false`,
  );
  const rows = await db
    .select({
      id: toolCall.id,
      tool: toolCall.tool,
      status: toolCall.status,
      error: toolCall.error,
      requestedAt: toolCall.requestedAt,
      finishedAt: toolCall.finishedAt,
    })
    .from(toolCall)
    .where(where)
    .orderBy(desc(toolCall.requestedAt))
    .limit(limit);
  // Re-sort ascending so the chain reads top-to-bottom oldest → newest.
  return rows.slice().reverse();
}

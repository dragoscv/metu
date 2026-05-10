/**
 * Autonomy policy resolver + tool runner.
 *
 * Effective ACL for (workspace, tool):
 *   1. tool_acl row for that tool (explicit override)
 *   2. agent_policy.defaultMode for the workspace
 *   3. fallback by tool kind:
 *        read       → autopilot   (always allowed)
 *        low_risk   → auto_with_undo
 *        high_risk  → ask
 */
import { and, eq, isNull, sql, ne } from 'drizzle-orm';
import { getDb } from '@metu/db';
import {
  agentPolicy,
  toolAcl,
  toolCall as toolCallTable,
  timelineEvent,
  notification,
  workspace,
} from '@metu/db/schema';
import { getTool, type ToolContext, type ToolKind } from './tools';

export type AutonomyMode = 'observe' | 'ask' | 'auto_with_undo' | 'autopilot';

const KIND_DEFAULT: Record<ToolKind, AutonomyMode> = {
  read: 'autopilot',
  low_risk: 'auto_with_undo',
  high_risk: 'ask',
};

/**
 * Effective ACL for (workspace, tool [, integration]).
 *
 * Precedence:
 *   1. tool_acl row scoped to (workspace, tool, integrationId) — most specific.
 *   2. tool_acl row scoped to (workspace, tool) with integrationId IS NULL — workspace-wide override.
 *   3. agent_policy.defaultMode for the workspace.
 *   4. Fallback by tool kind.
 *
 * Workspace-level `observe` always wins (kill-switch semantics).
 */
export async function resolveAcl(
  workspaceId: string,
  toolName: string,
  integrationId?: string | null,
): Promise<AutonomyMode> {
  const tool = getTool(toolName);
  const db = getDb();

  if (integrationId) {
    const [scoped] = await db
      .select({ mode: toolAcl.mode })
      .from(toolAcl)
      .where(
        and(
          eq(toolAcl.workspaceId, workspaceId),
          eq(toolAcl.tool, toolName),
          eq(toolAcl.integrationId, integrationId),
        ),
      )
      .limit(1);
    if (scoped) return scoped.mode as AutonomyMode;
  }

  const [override] = await db
    .select({ mode: toolAcl.mode })
    .from(toolAcl)
    .where(
      and(
        eq(toolAcl.workspaceId, workspaceId),
        eq(toolAcl.tool, toolName),
        isNull(toolAcl.integrationId),
      ),
    )
    .limit(1);
  if (override) return override.mode as AutonomyMode;

  const [policy] = await db
    .select({ defaultMode: agentPolicy.defaultMode })
    .from(agentPolicy)
    .where(eq(agentPolicy.workspaceId, workspaceId))
    .limit(1);

  const policyMode = policy?.defaultMode as AutonomyMode | undefined;
  if (policyMode === 'observe') return 'observe';

  if (tool?.kind === 'read') return 'autopilot';
  return policyMode ?? KIND_DEFAULT[tool?.kind ?? 'high_risk'];
}

/**
 * Tools that carry an `integrationId` in their args want their ACL evaluated
 * scoped to that integration. Add new entries here as more scoped tools land.
 */
function extractIntegrationId(toolName: string, args: unknown): string | null {
  if (toolName !== 'external_invoke') return null;
  if (!args || typeof args !== 'object') return null;
  const v = (args as { integrationId?: unknown }).integrationId;
  return typeof v === 'string' ? v : null;
}

/**
 * Per-workspace daily spend + autonomous-action caps.
 *
 * Counts only non-`ask` modes against the action cap (an `ask` requires a
 * human gate, so it's not "autonomous"). Read-only `read`-kind tools also
 * skip the action count to keep recall/search free.
 *
 * Returns `{ ok: true }` when within budget, or `{ ok: false, reason }`
 * with a short reason string suitable for storing on tool_call.error.
 */
export type CapDecision = { ok: true } | { ok: false; reason: string; kind: 'cost' | 'action' };

export async function checkCaps(
  workspaceId: string,
  toolKind: ToolKind,
  aclMode: AutonomyMode,
): Promise<CapDecision> {
  const db = getDb();
  const [ws] = await db
    .select({ unlimitedAi: workspace.unlimitedAi })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  if (ws?.unlimitedAi) return { ok: true };

  const [policy] = await db
    .select({
      dailyCostCapUsd: agentPolicy.dailyCostCapUsd,
      dailyActionCap: agentPolicy.dailyActionCap,
    })
    .from(agentPolicy)
    .where(eq(agentPolicy.workspaceId, workspaceId))
    .limit(1);

  // No policy row yet — schema defaults are 2 USD / 50 actions; treat as
  // open until the user creates one (autonomy-form seeds it on first save).
  if (!policy) return { ok: true };

  const sinceMidnight = sql`date_trunc('day', now())`;
  const [agg] = await db
    .select({
      cost: sql<number>`coalesce(sum(${toolCallTable.actualCostUsd}), 0)::float8`,
      autonomous: sql<number>`count(*) filter (where ${toolCallTable.aclMode} in ('autopilot','auto_with_undo'))::int`,
    })
    .from(toolCallTable)
    .where(
      and(
        eq(toolCallTable.workspaceId, workspaceId),
        sql`${toolCallTable.requestedAt} >= ${sinceMidnight}`,
        ne(toolCallTable.status, 'rejected'),
      ),
    );
  const spent = Number(agg?.cost ?? 0);
  const autonomous = Number(agg?.autonomous ?? 0);

  if (policy.dailyCostCapUsd != null && spent >= policy.dailyCostCapUsd) {
    return {
      ok: false,
      kind: 'cost',
      reason: `daily cost cap exceeded ($${spent.toFixed(2)} / $${policy.dailyCostCapUsd})`,
    };
  }
  if (
    policy.dailyActionCap != null &&
    aclMode !== 'ask' &&
    toolKind !== 'read' &&
    autonomous >= policy.dailyActionCap
  ) {
    return {
      ok: false,
      kind: 'action',
      reason: `daily action cap exceeded (${autonomous} / ${policy.dailyActionCap})`,
    };
  }
  return { ok: true };
}

export interface RunToolInput {
  workspaceId: string;
  userId: string;
  conversationId?: string | null;
  messageId?: string | null;
  agentRunId?: string | null;
  tool: string;
  args: unknown;
  /** Explicit integration scope for ACL evaluation. Auto-extracted from args when omitted. */
  integrationId?: string | null;
  /** Recursion depth; tools that themselves call runTool should pass depth+1. */
  depth?: number;
}

export const MAX_TOOL_DEPTH = 5;

export interface RunToolResult {
  toolCallId: string;
  status: 'success' | 'awaiting_approval' | 'rejected' | 'failed';
  result?: unknown;
  error?: string;
}

/**
 * Run a tool through the policy gate.
 *
 *  - autopilot           → execute now, return success.
 *  - auto_with_undo      → execute now, undoPayload is captured for later.
 *  - ask                 → insert tool_call(awaiting_approval), return.
 *                          Caller can wait on `conductor/approved` event for completion.
 *  - observe             → insert tool_call(rejected, reason='observe-only'), return.
 */
export async function runTool(input: RunToolInput): Promise<RunToolResult> {
  const tool = getTool(input.tool);
  const db = getDb();

  if ((input.depth ?? 0) > MAX_TOOL_DEPTH) {
    return {
      toolCallId: '',
      status: 'failed',
      error: `tool recursion depth ${input.depth} exceeds max ${MAX_TOOL_DEPTH}`,
    };
  }

  // Validate args even if the tool is unknown — still want an audit row.
  let parsedArgs: unknown = input.args;
  let validationError: string | null = null;
  if (tool) {
    const safe = tool.args.safeParse(input.args);
    if (!safe.success) {
      validationError = safe.error.issues[0]?.message ?? 'invalid args';
    } else {
      parsedArgs = safe.data;
    }
  } else {
    validationError = `unknown tool: ${input.tool}`;
  }

  const aclMode: AutonomyMode = await resolveAcl(
    input.workspaceId,
    input.tool,
    input.integrationId ?? extractIntegrationId(input.tool, parsedArgs),
  );

  const [row] = await db
    .insert(toolCallTable)
    .values({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId ?? null,
      messageId: input.messageId ?? null,
      agentRunId: input.agentRunId ?? null,
      tool: input.tool,
      args: (parsedArgs ?? {}) as Record<string, unknown>,
      status: 'pending',
      aclMode,
    })
    .returning();
  const toolCallId = row!.id;

  if (validationError) {
    await db
      .update(toolCallTable)
      .set({
        status: 'failed',
        error: validationError,
        finishedAt: new Date(),
      })
      .where(
        and(eq(toolCallTable.id, toolCallId), eq(toolCallTable.workspaceId, input.workspaceId)),
      );
    return { toolCallId, status: 'failed', error: validationError };
  }

  if (aclMode === 'observe') {
    await db
      .update(toolCallTable)
      .set({
        status: 'rejected',
        error: 'observe-only mode',
        decidedAt: new Date(),
        finishedAt: new Date(),
      })
      .where(
        and(eq(toolCallTable.id, toolCallId), eq(toolCallTable.workspaceId, input.workspaceId)),
      );
    return { toolCallId, status: 'rejected', error: 'observe-only mode' };
  }

  if (aclMode === 'ask') {
    await db
      .update(toolCallTable)
      .set({ status: 'awaiting_approval' })
      .where(
        and(eq(toolCallTable.id, toolCallId), eq(toolCallTable.workspaceId, input.workspaceId)),
      );
    await db.insert(timelineEvent).values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      kind: 'conductor.tool.proposed',
      title: `Conductor wants to run ${input.tool}`,
      body: JSON.stringify(parsedArgs).slice(0, 500),
      importance: 0.5,
      payload: { toolCallId, tool: input.tool },
    });
    return { toolCallId, status: 'awaiting_approval' };
  }

  // autopilot / auto_with_undo: enforce per-workspace daily caps before exec.
  const cap = await checkCaps(input.workspaceId, tool!.kind, aclMode);
  if (!cap.ok) {
    await db
      .update(toolCallTable)
      .set({
        status: 'failed',
        error: cap.reason,
        decidedAt: new Date(),
        finishedAt: new Date(),
      })
      .where(
        and(eq(toolCallTable.id, toolCallId), eq(toolCallTable.workspaceId, input.workspaceId)),
      );
    await db.insert(timelineEvent).values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      kind: 'conductor.cap.exceeded',
      title:
        cap.kind === 'cost' ? 'Daily AI spend cap reached' : 'Daily autonomous action cap reached',
      body: cap.reason,
      importance: 0.8,
      payload: { toolCallId, tool: input.tool, kind: cap.kind },
    });
    // Also push a notification so the user notices the cap hit, not just an
    // audit row buried in the timeline. Inserted directly (not via
    // `conductor/notify` Inngest event) to keep `@metu/core` free of
    // workflow-engine deps; the notify Inngest function still picks this up
    // via its DB-poll path on the next tick.
    await db.insert(notification).values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      title:
        cap.kind === 'cost' ? 'Daily AI spend cap reached' : 'Daily autonomous action cap reached',
      body: `Skipped ${input.tool} — ${cap.reason}. Adjust caps in Settings → Autonomy.`,
      urgency: 'high',
      source: 'conductor',
      actionUrl: '/settings/autonomy',
      actions: [{ id: 'open-settings', label: 'Open settings', kind: 'open' }],
      metadata: { toolCallId, tool: input.tool, capKind: cap.kind },
    });
    return { toolCallId, status: 'failed', error: cap.reason };
  }

  // autopilot or auto_with_undo: execute now.
  await db
    .update(toolCallTable)
    .set({ status: 'running', decidedAt: new Date() })
    .where(and(eq(toolCallTable.id, toolCallId), eq(toolCallTable.workspaceId, input.workspaceId)));

  try {
    const ctx: ToolContext = {
      workspaceId: input.workspaceId,
      userId: input.userId,
      toolCallId,
    };
    const { result, undoPayload } = await tool!.execute(parsedArgs as never, ctx);
    await db
      .update(toolCallTable)
      .set({
        status: 'success',
        result: result as Record<string, unknown>,
        undoPayload: undoPayload ?? null,
        finishedAt: new Date(),
      })
      .where(
        and(eq(toolCallTable.id, toolCallId), eq(toolCallTable.workspaceId, input.workspaceId)),
      );
    return { toolCallId, status: 'success', result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(toolCallTable)
      .set({ status: 'failed', error: msg, finishedAt: new Date() })
      .where(
        and(eq(toolCallTable.id, toolCallId), eq(toolCallTable.workspaceId, input.workspaceId)),
      );
    return { toolCallId, status: 'failed', error: msg };
  }
}

/** Approve a previously-asked tool call and execute it. */
export async function approveToolCall(
  workspaceId: string,
  toolCallId: string,
  userId: string,
): Promise<RunToolResult> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(toolCallTable)
    .where(and(eq(toolCallTable.id, toolCallId), eq(toolCallTable.workspaceId, workspaceId)))
    .limit(1);
  if (!row) return { toolCallId, status: 'failed', error: 'not found' };
  if (row.status !== 'awaiting_approval') {
    return { toolCallId, status: 'failed', error: `tool call is ${row.status}` };
  }

  const tool = getTool(row.tool);
  if (!tool) return { toolCallId, status: 'failed', error: 'unknown tool' };

  // Re-check ACL: the user (or another admin) may have flipped the workspace
  // into observe-only between proposal and approval. Honour the kill-switch.
  const integrationId = extractIntegrationId(row.tool, row.args as Record<string, unknown> | null);
  const currentMode = await resolveAcl(workspaceId, row.tool, integrationId);
  if (currentMode === 'observe') {
    await db
      .update(toolCallTable)
      .set({
        status: 'rejected',
        error: 'workspace switched to observe-only',
        decidedAt: new Date(),
        finishedAt: new Date(),
      })
      .where(and(eq(toolCallTable.id, toolCallId), eq(toolCallTable.workspaceId, workspaceId)));
    return { toolCallId, status: 'rejected', error: 'workspace switched to observe-only' };
  }

  // Re-check caps so an explicit approval can't bypass the daily budget.
  const cap = await checkCaps(workspaceId, tool.kind, currentMode);
  if (!cap.ok) {
    await db
      .update(toolCallTable)
      .set({
        status: 'failed',
        error: cap.reason,
        decidedAt: new Date(),
        finishedAt: new Date(),
      })
      .where(and(eq(toolCallTable.id, toolCallId), eq(toolCallTable.workspaceId, workspaceId)));
    return { toolCallId, status: 'failed', error: cap.reason };
  }

  await db
    .update(toolCallTable)
    .set({ status: 'running', decidedAt: new Date() })
    .where(and(eq(toolCallTable.id, toolCallId), eq(toolCallTable.workspaceId, workspaceId)));

  try {
    const { result, undoPayload } = await tool.execute(row.args as never, {
      workspaceId,
      userId,
      toolCallId,
    });
    await db
      .update(toolCallTable)
      .set({
        status: 'success',
        result: result as Record<string, unknown>,
        undoPayload: undoPayload ?? null,
        finishedAt: new Date(),
      })
      .where(and(eq(toolCallTable.id, toolCallId), eq(toolCallTable.workspaceId, workspaceId)));
    return { toolCallId, status: 'success', result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(toolCallTable)
      .set({ status: 'failed', error: msg, finishedAt: new Date() })
      .where(and(eq(toolCallTable.id, toolCallId), eq(toolCallTable.workspaceId, workspaceId)));
    return { toolCallId, status: 'failed', error: msg };
  }
}

export async function rejectToolCall(workspaceId: string, toolCallId: string, reason?: string) {
  const db = getDb();
  await db
    .update(toolCallTable)
    .set({
      status: 'rejected',
      error: reason ?? 'rejected by user',
      decidedAt: new Date(),
      finishedAt: new Date(),
    })
    .where(and(eq(toolCallTable.id, toolCallId), eq(toolCallTable.workspaceId, workspaceId)));
}

export async function undoToolCall(workspaceId: string, toolCallId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(toolCallTable)
    .where(and(eq(toolCallTable.id, toolCallId), eq(toolCallTable.workspaceId, workspaceId)))
    .limit(1);
  if (!row || row.status !== 'success' || !row.undoPayload) {
    throw new Error('not undoable');
  }
  const tool = getTool(row.tool);
  if (!tool?.undo) throw new Error('tool has no undo');
  await tool.undo(row.undoPayload as Record<string, unknown>, {
    workspaceId,
    userId: '',
  });
  await db
    .update(toolCallTable)
    .set({ status: 'undone', finishedAt: new Date() })
    .where(and(eq(toolCallTable.id, toolCallId), eq(toolCallTable.workspaceId, workspaceId)));
}

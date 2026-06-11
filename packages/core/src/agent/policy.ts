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
import { and, eq, gte, isNull, sql, ne } from 'drizzle-orm';
import { getDb } from '@metu/db';
import {
  agentPolicy,
  autonomyGrant,
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
 * Tools that always emit a low-urgency notification on success, regardless
 * of autonomy mode, so the user keeps continuous visibility into local
 * tunnels and other high-trust passthroughs. Audit row is written separately.
 */
const VISIBILITY_NOTIFY_TOOLS = new Set<string>(['device.ollama_chat']);

async function emitVisibilityNotification(
  workspaceId: string,
  userId: string,
  toolName: string,
  args: unknown,
  result: unknown,
): Promise<void> {
  const db = getDb();
  let title = `${toolName}`;
  let body = '';
  if (toolName === 'device.ollama_chat') {
    const a = (args ?? {}) as { model?: string; messages?: Array<{ content?: string }> };
    const model = typeof a.model === 'string' ? a.model : 'unknown';
    const promptBytes = Array.isArray(a.messages)
      ? a.messages.reduce(
          (n, m) => n + (typeof m?.content === 'string' ? Buffer.byteLength(m.content) : 0),
          0,
        )
      : 0;
    const r = (result ?? {}) as { outputTokens?: number };
    const outTokens = typeof r.outputTokens === 'number' ? r.outputTokens : null;
    title = `Ollama: model=${model}`;
    body = `prompt-bytes=${promptBytes}${outTokens != null ? ` · out-tokens=${outTokens}` : ''}`;
  }
  await db.insert(notification).values({
    workspaceId,
    userId,
    title,
    body,
    urgency: 'low',
    source: 'conductor:tool-visibility',
    metadata: { tool: toolName },
  });
}

/**
 * Tools that are NEVER permitted to run without an explicit human
 * approval, regardless of `tool_acl` overrides or `agent_policy.defaultMode`.
 * Touch real people (Telegram chat, email inbox) and aren't meaningfully
 * undoable — we refuse to honor any autopilot/auto_with_undo override.
 */
const FORCE_ASK_TOOLS = new Set<string>(['send_telegram', 'send_email']);

/**
 * Earned autonomy (Conductor v2): after this many consecutive APPROVALS of
 * the same tool (no rejections in between), an `ask` resolution is
 * automatically softened to `auto_with_undo`. A single rejection resets
 * the streak. FORCE_ASK tools never participate.
 */
const EARNED_AUTONOMY_STREAK = 3;

/**
 * Session autopilot grant check: an unexpired, unrevoked grant for the
 * workspace (tool IS NULL) or for this specific tool upgrades `ask` →
 * `auto_with_undo`.
 */
async function hasActiveGrant(workspaceId: string, toolName: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ id: autonomyGrant.id })
    .from(autonomyGrant)
    .where(
      and(
        eq(autonomyGrant.workspaceId, workspaceId),
        isNull(autonomyGrant.revokedAt),
        gte(autonomyGrant.expiresAt, sql`now()`),
        sql`(${autonomyGrant.tool} IS NULL OR ${autonomyGrant.tool} = ${toolName})`,
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * Earned-autonomy streak: count consecutive most-recent approvals of this
 * tool. Any rejected/failed-after-approval row breaks the streak.
 */
async function approvalStreak(workspaceId: string, toolName: string): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ status: toolCallTable.status })
    .from(toolCallTable)
    .where(
      and(
        eq(toolCallTable.workspaceId, workspaceId),
        eq(toolCallTable.tool, toolName),
        eq(toolCallTable.aclMode, 'ask'),
        sql`${toolCallTable.status} in ('success', 'rejected')`,
      ),
    )
    .orderBy(sql`${toolCallTable.requestedAt} desc`)
    .limit(EARNED_AUTONOMY_STREAK);
  if (rows.length < EARNED_AUTONOMY_STREAK)
    return rows.filter((r) => r.status === 'success').length;
  let streak = 0;
  for (const r of rows) {
    if (r.status === 'success') streak++;
    else break;
  }
  return streak;
}

/**
 * Once MTD spend crosses this fraction of `workspace.monthlyCostCapUsd`,
 * autopilot/auto_with_undo on mutating tools is bumped down to `ask`.
 * Read-only tools are unaffected.
 */
const MONTHLY_SOFT_BRAKE_FRACTION = 0.5;

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
  const resolved = policyMode ?? KIND_DEFAULT[tool?.kind ?? 'high_risk'];

  if (FORCE_ASK_TOOLS.has(toolName) && resolved !== 'observe') return 'ask';

  // Conductor v2 — soften `ask` before the cost brake so grants/earned
  // autonomy keep the agent fluid. Never applies to FORCE_ASK tools.
  let effective = resolved;
  if (effective === 'ask' && !FORCE_ASK_TOOLS.has(toolName)) {
    if (await hasActiveGrant(workspaceId, toolName)) {
      effective = 'auto_with_undo';
    } else if ((await approvalStreak(workspaceId, toolName)) >= EARNED_AUTONOMY_STREAK) {
      effective = 'auto_with_undo';
    }
  }

  if (effective === 'autopilot' || effective === 'auto_with_undo') {
    if (await monthlyBrakeTripped(workspaceId)) return 'ask';
  }

  return effective;
}

/**
 * `true` when MTD tool-call spend has crossed
 * `MONTHLY_SOFT_BRAKE_FRACTION` of the workspace's monthly cap. Returns
 * false when `unlimitedAi` is set or no cap is configured.
 */
async function monthlyBrakeTripped(workspaceId: string): Promise<boolean> {
  const db = getDb();
  const [ws] = await db
    .select({
      unlimitedAi: workspace.unlimitedAi,
      monthlyCostCapUsd: workspace.monthlyCostCapUsd,
    })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  if (!ws || ws.unlimitedAi) return false;
  const cap = ws.monthlyCostCapUsd != null ? Number(ws.monthlyCostCapUsd) : NaN;
  if (!Number.isFinite(cap) || cap <= 0) return false;

  const [agg] = await db
    .select({
      cost: sql<number>`coalesce(sum(${toolCallTable.actualCostUsd}), 0)::float8`,
    })
    .from(toolCallTable)
    .where(
      and(
        eq(toolCallTable.workspaceId, workspaceId),
        sql`${toolCallTable.requestedAt} >= date_trunc('month', now())`,
        ne(toolCallTable.status, 'rejected'),
      ),
    );
  const spent = Number(agg?.cost ?? 0);
  return spent >= cap * MONTHLY_SOFT_BRAKE_FRACTION;
}

/**
 * Cheap snapshot of today / MTD spend vs configured caps. Surfaced on
 * Conductor tool proposals so the user sees budget impact before
 * approving. Returns `null` if neither cap is configured (no point
 * showing zeros to a user who has opted into unlimited mode).
 */
async function getBudgetSnapshot(workspaceId: string): Promise<{
  todaySpend: number;
  mtdSpend: number;
  dailyCap: number | null;
  monthlyCap: number | null;
} | null> {
  const db = getDb();
  const [ws] = await db
    .select({
      unlimitedAi: workspace.unlimitedAi,
      monthlyCostCapUsd: workspace.monthlyCostCapUsd,
    })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  if (!ws || ws.unlimitedAi) return null;
  const [policy] = await db
    .select({ dailyCostCapUsd: agentPolicy.dailyCostCapUsd })
    .from(agentPolicy)
    .where(eq(agentPolicy.workspaceId, workspaceId))
    .limit(1);
  const dailyCap = policy?.dailyCostCapUsd != null ? Number(policy.dailyCostCapUsd) : null;
  const monthlyCap = ws.monthlyCostCapUsd != null ? Number(ws.monthlyCostCapUsd) : null;
  if (dailyCap == null && monthlyCap == null) return null;

  const [agg] = await db
    .select({
      today: sql<number>`coalesce(sum(${toolCallTable.actualCostUsd}) filter (where ${toolCallTable.requestedAt} >= date_trunc('day', now())), 0)::float8`,
      mtd: sql<number>`coalesce(sum(${toolCallTable.actualCostUsd}) filter (where ${toolCallTable.requestedAt} >= date_trunc('month', now())), 0)::float8`,
    })
    .from(toolCallTable)
    .where(and(eq(toolCallTable.workspaceId, workspaceId), ne(toolCallTable.status, 'rejected')));
  return {
    todaySpend: Number(agg?.today ?? 0),
    mtdSpend: Number(agg?.mtd ?? 0),
    dailyCap,
    monthlyCap,
  };
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
        gte(toolCallTable.requestedAt, sinceMidnight),
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
    const budget = await getBudgetSnapshot(input.workspaceId);
    const budgetLine = budget
      ? ` — today $${budget.todaySpend.toFixed(2)}${
          budget.dailyCap != null ? ` / $${budget.dailyCap.toFixed(2)}` : ''
        }, MTD $${budget.mtdSpend.toFixed(2)}${
          budget.monthlyCap != null ? ` / $${budget.monthlyCap.toFixed(2)}` : ''
        }`
      : '';
    await db.insert(timelineEvent).values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      kind: 'conductor.tool.proposed',
      title: `Conductor wants to run ${input.tool}`,
      body: JSON.stringify(parsedArgs).slice(0, 500) + budgetLine,
      importance: 0.5,
      payload: { toolCallId, tool: input.tool, budget },
    });
    // Push a notification so HITL doesn't require the user to visit /audit.
    // urgency=high for high_risk tools (send_telegram, merge_pr, etc), normal otherwise.
    await db.insert(notification).values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      title: `Approve: ${input.tool}`,
      body: JSON.stringify(parsedArgs).slice(0, 240) + budgetLine,
      urgency: tool!.kind === 'high_risk' ? 'high' : 'normal',
      source: 'conductor:tool-approval',
      actionUrl: `/audit/${toolCallId}`,
      actions: [
        { id: 'approve', label: 'Approve', kind: 'approve' as const, toolCallId },
        { id: 'reject', label: 'Reject', kind: 'reject' as const, toolCallId },
        { id: 'open', label: 'Open audit', kind: 'open' as const, href: `/audit/${toolCallId}` },
      ],
      metadata: { toolCallId, tool: input.tool, kind: tool!.kind, budget },
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
    // Conductor v2: auto_with_undo actions are visible-by-default — a
    // low-urgency notification with an Undo affordance, so autonomy never
    // feels like things happening behind the user's back.
    if (aclMode === 'auto_with_undo' && tool!.kind !== 'read') {
      try {
        await db.insert(notification).values({
          workspaceId: input.workspaceId,
          userId: input.userId,
          title: `Done: ${input.tool}`,
          body: JSON.stringify(parsedArgs).slice(0, 200),
          urgency: 'low',
          source: 'conductor:auto-action',
          actionUrl: `/audit/${toolCallId}`,
          actions: undoPayload
            ? [
                { id: 'undo', label: 'Undo', kind: 'undo' as const, toolCallId },
                {
                  id: 'open',
                  label: 'Details',
                  kind: 'open' as const,
                  href: `/audit/${toolCallId}`,
                },
              ]
            : [
                {
                  id: 'open',
                  label: 'Details',
                  kind: 'open' as const,
                  href: `/audit/${toolCallId}`,
                },
              ],
          metadata: { toolCallId, tool: input.tool, auto: true },
        });
      } catch {
        /* visibility is best-effort */
      }
    }
    if (VISIBILITY_NOTIFY_TOOLS.has(input.tool)) {
      await emitVisibilityNotification(
        input.workspaceId,
        input.userId,
        input.tool,
        parsedArgs,
        result,
      ).catch(() => {
        /* best-effort */
      });
    }
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
    // Continuous-visibility notification for high-trust local tunnels.
    // The audit log already records the call; this just surfaces it.
    if (VISIBILITY_NOTIFY_TOOLS.has(row.tool)) {
      await emitVisibilityNotification(workspaceId, userId, row.tool, row.args, result).catch(
        () => {
          /* best-effort */
        },
      );
    }
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

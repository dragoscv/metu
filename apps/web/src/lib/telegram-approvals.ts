/**
 * Telegram approval helpers — bridge inline buttons / `/approve` to the
 * agent policy's `approveToolCall` / `rejectToolCall`, which re-check ACL,
 * caps, and the kill-switch and record the audit trail + undo payload.
 */
import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { toolCall } from '@metu/db/schema';
import { agent } from '@metu/core';

export interface PendingApproval {
  toolCallId: string;
  tool: string;
}

/** The most recent tool call awaiting approval for a workspace, or null. */
export async function resolvePendingApproval(workspaceId: string): Promise<PendingApproval | null> {
  const [row] = await getDb()
    .select({ id: toolCall.id, tool: toolCall.tool })
    .from(toolCall)
    .where(and(eq(toolCall.workspaceId, workspaceId), eq(toolCall.status, 'awaiting_approval')))
    .orderBy(desc(toolCall.requestedAt))
    .limit(1);
  return row ? { toolCallId: row.id, tool: row.tool } : null;
}

export async function applyApproval(
  workspaceId: string,
  toolCallId: string,
  approve: boolean,
): Promise<{ ok: boolean; message: string }> {
  // The connecting user owns the workspace; use them as the actor.
  const userId = await ownerUserId(workspaceId);
  if (approve) {
    const r = await agent.approveToolCall(workspaceId, toolCallId, userId);
    if (r.status === 'success') return { ok: true, message: '✅ Approved & executed.' };
    return { ok: false, message: `⚠️ Could not run: ${r.error ?? r.status}` };
  }
  await agent.rejectToolCall(workspaceId, toolCallId, 'rejected via Telegram');
  return { ok: true, message: '🚫 Rejected.' };
}

async function ownerUserId(workspaceId: string): Promise<string> {
  // Reuse the bot's connecting user as the actor for audit.
  const { telegramBot } = await import('@metu/db/schema');
  const [row] = await getDb()
    .select({ userId: telegramBot.connectedByUserId })
    .from(telegramBot)
    .where(eq(telegramBot.workspaceId, workspaceId))
    .limit(1);
  return row?.userId ?? '00000000-0000-0000-0000-000000000000';
}

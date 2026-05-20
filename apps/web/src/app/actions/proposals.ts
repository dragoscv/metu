'use server';
/**
 * Proposal actions — approve or reject a Conductor-suggested tool call
 * carried as `notification.metadata.toolProposal = {tool, args}`.
 *
 * Approval pipes through `agent.runTool()` so the policy gate, audit
 * trail, and undo buffer all apply. Rejection just acknowledges the
 * notification without invoking anything.
 *
 * Both paths set `acknowledgedAt` so the proposal disappears from the
 * inbox / `/proposals` queue.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { auth } from '@metu/auth';
import { agent } from '@metu/core';
import { getDb } from '@metu/db';
import { notification } from '@metu/db/schema';

const Input = z.object({
  notificationId: z.string().uuid(),
  decision: z.enum(['approve', 'reject']),
});

export interface ProposalDecisionResult {
  ok: boolean;
  error?: string;
  toolCallId?: string;
  toolStatus?: string;
}

export async function respondToProposalAction(
  input: z.infer<typeof Input>,
): Promise<ProposalDecisionResult> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_input' };
  const session = await auth();
  if (!session) return { ok: false, error: 'unauthenticated' };

  const db = getDb();
  const [row] = await db
    .select({
      id: notification.id,
      metadata: notification.metadata,
      acknowledgedAt: notification.acknowledgedAt,
    })
    .from(notification)
    .where(
      and(
        eq(notification.id, parsed.data.notificationId),
        eq(notification.workspaceId, session.user.workspaceId),
        eq(notification.userId, session.user.id),
      ),
    )
    .limit(1);

  if (!row) return { ok: false, error: 'not_found' };
  if (row.acknowledgedAt) return { ok: false, error: 'already_acknowledged' };

  const meta = (row.metadata ?? {}) as {
    toolProposal?: { tool: string; args: Record<string, unknown> };
  };

  if (parsed.data.decision === 'reject') {
    await db
      .update(notification)
      .set({ acknowledgedAt: new Date(), readAt: new Date() })
      .where(
        and(eq(notification.id, row.id), eq(notification.workspaceId, session.user.workspaceId)),
      );
    revalidatePath('/notifications');
    revalidatePath('/proposals');
    return { ok: true };
  }

  // approve
  if (!meta.toolProposal?.tool) {
    return { ok: false, error: 'no_proposal' };
  }

  const result = await agent.runTool({
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
    tool: meta.toolProposal.tool,
    args: meta.toolProposal.args ?? {},
  });

  await db
    .update(notification)
    .set({
      acknowledgedAt: new Date(),
      readAt: new Date(),
      metadata: {
        ...(row.metadata as Record<string, unknown>),
        decision: 'approve',
        toolCallId: result.toolCallId,
        toolStatus: result.status,
      },
    })
    .where(
      and(eq(notification.id, row.id), eq(notification.workspaceId, session.user.workspaceId)),
    );

  revalidatePath('/notifications');
  revalidatePath('/proposals');
  return {
    ok: result.status === 'success' || result.status === 'awaiting_approval',
    toolCallId: result.toolCallId,
    toolStatus: result.status,
    error: result.error,
  };
}

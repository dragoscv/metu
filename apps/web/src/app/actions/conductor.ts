'use server';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { conversation } from '@metu/db/schema';
import { agent } from '@metu/core';
import { Inngest } from 'inngest';

const inngest = new Inngest({ id: 'metu' });

const CreateSideChatSchema = z.object({ title: z.string().optional() });
const ConversationIdSchema = z.string().uuid();
const ToolCallIdSchema = z.string().uuid();
const RejectToolCallSchema = z.object({
  toolCallId: z.string().uuid(),
  reason: z.string().optional(),
});

export async function createSideChatAction(input: { title?: string }) {
  const parsed = CreateSideChatSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'invalid_input' };
  input = parsed.data;
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const db = getDb();
  const [row] = await db
    .insert(conversation)
    .values({
      workspaceId: session.user.workspaceId,
      userId: session.user.id,
      kind: 'side',
      title: input.title?.trim() || 'New conversation',
    })
    .returning();
  revalidatePath('/chat');
  return { ok: true as const, id: row!.id };
}

export async function archiveConversationAction(id: string) {
  const parsed = ConversationIdSchema.safeParse(id);
  if (!parsed.success) return { ok: false as const, error: 'invalid_input' };
  id = parsed.data;
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const db = getDb();
  await db
    .update(conversation)
    .set({ status: 'archived', archivedAt: new Date() })
    .where(and(eq(conversation.id, id), eq(conversation.workspaceId, session.user.workspaceId)));
  revalidatePath('/chat');
  return { ok: true as const };
}

export async function approveToolCallAction(toolCallId: string) {
  const parsed = ToolCallIdSchema.safeParse(toolCallId);
  if (!parsed.success) return { ok: false as const, error: 'invalid_input' };
  toolCallId = parsed.data;
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const r = await agent.approveToolCall(session.user.workspaceId, toolCallId, session.user.id);
  await inngest
    .send({
      name: 'conductor/approved',
      data: {
        workspaceId: session.user.workspaceId,
        userId: session.user.id,
        toolCallId,
      },
    })
    .catch(() => {});
  revalidatePath('/chat');
  revalidatePath('/audit');
  return { ok: r.status === 'success', status: r.status, error: r.error };
}

export async function rejectToolCallAction(toolCallId: string, reason?: string) {
  const parsed = RejectToolCallSchema.safeParse({ toolCallId, reason });
  if (!parsed.success) return { ok: false as const, error: 'invalid_input' };
  toolCallId = parsed.data.toolCallId;
  reason = parsed.data.reason;
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  await agent.rejectToolCall(session.user.workspaceId, toolCallId, reason);
  await inngest
    .send({
      name: 'conductor/rejected',
      data: {
        workspaceId: session.user.workspaceId,
        userId: session.user.id,
        toolCallId,
        reason,
      },
    })
    .catch(() => {});
  revalidatePath('/chat');
  revalidatePath('/audit');
  return { ok: true as const };
}

export async function undoToolCallAction(toolCallId: string) {
  const parsed = ToolCallIdSchema.safeParse(toolCallId);
  if (!parsed.success) return { ok: false as const, error: 'invalid_input' };
  toolCallId = parsed.data;
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  try {
    await agent.undoToolCall(session.user.workspaceId, toolCallId);
    revalidatePath('/chat');
    revalidatePath('/audit');
    return { ok: true as const };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

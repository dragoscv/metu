'use server';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { conversation, project } from '@metu/db/schema';
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
const PromoteSchema = z.object({
  conversationId: z.string().uuid(),
  projectId: z.string().uuid(),
});
const RenameSchema = z.object({
  conversationId: z.string().uuid(),
  title: z.string().min(1).max(200),
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

/**
 * Promote a side chat into a project chat by attaching it to a project and
 * flipping `kind` to `project`. The Conductor singleton thread is refused;
 * already-project chats are re-pointed (rename project).
 */
export async function promoteSideChatAction(input: { conversationId: string; projectId: string }) {
  const parsed = PromoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'invalid_input' };
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const db = getDb();
  const [convo] = await db
    .select({ id: conversation.id, kind: conversation.kind })
    .from(conversation)
    .where(
      and(
        eq(conversation.id, parsed.data.conversationId),
        eq(conversation.workspaceId, session.user.workspaceId),
      ),
    )
    .limit(1);
  if (!convo) return { ok: false as const, error: 'not_found' };
  if (convo.kind === 'conductor') {
    return { ok: false as const, error: 'cannot_promote_conductor_thread' };
  }
  // Verify project belongs to workspace before pointing at it.
  const [proj] = await db
    .select({ id: project.id })
    .from(project)
    .where(
      and(eq(project.id, parsed.data.projectId), eq(project.workspaceId, session.user.workspaceId)),
    )
    .limit(1);
  if (!proj) return { ok: false as const, error: 'project_not_found' };
  await db
    .update(conversation)
    .set({ kind: 'project', projectId: parsed.data.projectId })
    .where(
      and(
        eq(conversation.id, parsed.data.conversationId),
        eq(conversation.workspaceId, session.user.workspaceId),
      ),
    );
  revalidatePath('/chat');
  return { ok: true as const };
}

export async function renameConversationAction(input: { conversationId: string; title: string }) {
  const parsed = RenameSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'invalid_input' };
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const db = getDb();
  await db
    .update(conversation)
    .set({ title: parsed.data.title.trim() })
    .where(
      and(
        eq(conversation.id, parsed.data.conversationId),
        eq(conversation.workspaceId, session.user.workspaceId),
      ),
    );
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

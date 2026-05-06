/**
 * Conductor / side-chat streaming endpoint.
 *
 * POST /api/conductor/chat
 *   body: { conversationId: string, content: string }
 *
 * Persists the user message, streams the assistant response with tool-use
 * support (Vercel AI SDK), persists the final assistant message and any
 * tool_calls produced. Returns a UI message stream consumed by the client.
 */
import { type NextRequest } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { stepCountIs, streamText, type ModelMessage } from 'ai';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { conversation, message } from '@metu/db/schema';
import { getModel, buildConductorSystem } from '@metu/ai';
import { agent } from '@metu/core';

export const runtime = 'nodejs';
export const maxDuration = 120;

const HISTORY_LIMIT = 60;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return new Response('Unauthenticated', { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    conversationId?: string;
    content?: string;
  } | null;
  if (!body?.conversationId || !body.content?.trim()) {
    return new Response('conversationId + content required', { status: 400 });
  }

  const db = getDb();
  const [convo] = await db
    .select()
    .from(conversation)
    .where(eq(conversation.id, body.conversationId))
    .limit(1);
  if (!convo || convo.workspaceId !== session.user.workspaceId) {
    return new Response('Conversation not found', { status: 404 });
  }

  // 1. persist the user message immediately
  const [userMsg] = await db
    .insert(message)
    .values({
      workspaceId: session.user.workspaceId,
      conversationId: convo.id,
      role: 'user',
      content: body.content.trim(),
    })
    .returning();
  await db
    .update(conversation)
    .set({ lastMessageAt: new Date() })
    .where(eq(conversation.id, convo.id));

  // 2. load history (bounded)
  const history = await db
    .select({
      role: message.role,
      content: message.content,
      blocks: message.blocks,
    })
    .from(message)
    .where(eq(message.conversationId, convo.id))
    .orderBy(asc(message.createdAt))
    .limit(HISTORY_LIMIT);

  // 3. resolve model (intent='agentic')
  const { model, provider, modelId } = await getModel({
    workspaceId: session.user.workspaceId,
    intent: 'agentic',
  });

  // 4. build tools — tied to this conversation for audit
  const tools = agent.buildAiTools({
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
    conversationId: convo.id,
    messageId: userMsg!.id,
  });

  // 5. assemble messages from history
  const modelMessages: ModelMessage[] = history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

  // 6. stream
  const result = streamText({
    model: model as Parameters<typeof streamText>[0]['model'],
    system: buildConductorSystem(
      convo.kind === 'conductor'
        ? 'You are speaking inside the persistent Conductor thread.'
        : `You are speaking in a side chat titled "${convo.title}".`,
    ),
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(8),
    onFinish: async ({ text, usage, finishReason }) => {
      try {
        await db.insert(message).values({
          workspaceId: session.user.workspaceId,
          conversationId: convo.id,
          role: 'assistant',
          content: text ?? '',
          provider,
          model: modelId,
          inputTokens: usage?.inputTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
          metadata: { finishReason },
        });
        await db
          .update(conversation)
          .set({ lastMessageAt: new Date() })
          .where(eq(conversation.id, convo.id));
      } catch (err) {
        console.error('[conductor.chat] persist failed', err);
      }
    },
  });

  return result.toTextStreamResponse();
}

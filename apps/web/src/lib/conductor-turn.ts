/**
 * Non-streaming Conductor turn for external channels (Telegram, etc.).
 *
 * Uses the `chat` intent (CodAI by default) + read-mostly tools so the user
 * can hold a real conversation with METU from Telegram. Persists the exchange
 * into the workspace's Conductor conversation so it shows up in the web app
 * too. Mutating actions still flow through `runTool()` ACL inside buildAiTools.
 */
import 'server-only';
import { and, asc, eq } from 'drizzle-orm';
import { generateText, stepCountIs, type ModelMessage } from 'ai';
import { getDb } from '@metu/db';
import { conversation, message } from '@metu/db/schema';
import { getModel, buildConductorSystem } from '@metu/ai';
import { agent } from '@metu/core';
import { log } from '@/lib/logger';

const HISTORY_LIMIT = 30;

async function getOrCreateConductorConversation(workspaceId: string): Promise<string> {
  const db = getDb();
  const [existing] = await db
    .select({ id: conversation.id })
    .from(conversation)
    .where(and(eq(conversation.workspaceId, workspaceId), eq(conversation.kind, 'conductor')))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(conversation)
    .values({ workspaceId, kind: 'conductor', title: 'Conductor' })
    .returning();
  return created!.id;
}

export interface ConductorTurnInput {
  workspaceId: string;
  userId: string;
  text: string;
  /** Channel label for the system prompt (e.g. 'Telegram'). */
  channel?: string;
  /**
   * Which model lane to use. 'agentic' gives a stronger model + more tool
   * steps for do-things requests; 'chat' is for plain Q&A. Defaults to 'chat'.
   */
  intent?: 'chat' | 'agentic';
}

export interface ConductorTurnResult {
  text: string;
  /** Tool calls that need user approval before they run (ACL = ask). */
  pendingApprovals: { toolCallId: string; tool: string }[];
}

/**
 * Run one Conductor turn and return the reply text. Persists both the user
 * message and the assistant reply to the Conductor thread.
 */
export async function runConductorTurn(
  input: ConductorTurnInput,
): Promise<ConductorTurnResult> {
  const db = getDb();
  const conversationId = await getOrCreateConductorConversation(input.workspaceId);

  const [userMsg] = await db
    .insert(message)
    .values({
      workspaceId: input.workspaceId,
      conversationId,
      role: 'user',
      content: input.text,
      metadata: { channel: input.channel ?? 'telegram' },
    })
    .returning();

  const history = await db
    .select({ role: message.role, content: message.content })
    .from(message)
    .where(eq(message.conversationId, conversationId))
    .orderBy(asc(message.createdAt))
    .limit(HISTORY_LIMIT);

  const { model, provider, modelId } = await getModel({
    workspaceId: input.workspaceId,
    intent: input.intent ?? 'chat',
  });

  const tools = agent.buildAiTools({
    workspaceId: input.workspaceId,
    userId: input.userId,
    conversationId,
    messageId: userMsg!.id,
  });

  const modelMessages: ModelMessage[] = history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  let text = '';
  const pendingApprovals: { toolCallId: string; tool: string }[] = [];
  const agentic = input.intent === 'agentic';
  try {
    const result = await generateText({
      model: model as Parameters<typeof generateText>[0]['model'],
      system: buildConductorSystem(
        `You are replying to the user over ${input.channel ?? 'Telegram'}. Keep replies concise and mobile-friendly (a few short paragraphs max, no markdown tables). Use tools to answer from real workspace data AND to take actions the user asks for (create/update projects, tasks, goals, notes, etc.). If a tool needs approval it will say so — tell the user you've queued it for approval. Never claim you did something you didn't actually do via a tool.`,
      ),
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(agentic ? 12 : 6),
      maxOutputTokens: agentic ? 1200 : 700,
    });
    text = result.text.trim();

    // Surface any tool calls that returned __awaiting_approval so the channel
    // can render inline Approve/Reject buttons.
    for (const step of result.steps ?? []) {
      for (const tr of step.toolResults ?? []) {
        const output = (tr as { output?: unknown }).output as
          | { __awaiting_approval?: boolean; toolCallId?: string }
          | undefined;
        if (output?.__awaiting_approval && output.toolCallId) {
          pendingApprovals.push({
            toolCallId: output.toolCallId,
            tool: (tr as { toolName?: string }).toolName ?? 'action',
          });
        }
      }
    }

    await db.insert(message).values({
      workspaceId: input.workspaceId,
      conversationId,
      role: 'assistant',
      content: text,
      provider,
      model: modelId,
      metadata: { channel: input.channel ?? 'telegram' },
    });
    await db
      .update(conversation)
      .set({ lastMessageAt: new Date() })
      .where(eq(conversation.id, conversationId));
  } catch (err) {
    log.error('conductor.turn.failed', { workspaceId: input.workspaceId }, err);
    return {
      text: 'Sorry — I hit an error reaching my reasoning engine. Try again in a moment.',
      pendingApprovals: [],
    };
  }

  return { text: text || 'Done.', pendingApprovals };
}

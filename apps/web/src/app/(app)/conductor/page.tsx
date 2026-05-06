import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { and, asc, desc, eq, ne } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { conversation, message, toolCall } from '@metu/db/schema';
import { ConductorChat } from '@/components/conductor-chat';
import { ConductorSidebar } from '@/components/conductor-sidebar';

async function ensureConductorThread(workspaceId: string) {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(conversation)
    .where(and(eq(conversation.workspaceId, workspaceId), eq(conversation.kind, 'conductor')))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(conversation)
    .values({
      workspaceId,
      kind: 'conductor',
      status: 'pinned',
      title: 'Conductor',
      summary: 'Your always-on supervisor.',
    })
    .returning();
  return created!;
}

export default async function ConductorPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const session = await auth();
  if (!session) redirect('/sign-in');

  const sp = await searchParams;
  const workspaceId = session.user.workspaceId;
  const db = getDb();

  const conductorThread = await ensureConductorThread(workspaceId);

  const conversations = await db
    .select({
      id: conversation.id,
      kind: conversation.kind,
      title: conversation.title,
      lastMessageAt: conversation.lastMessageAt,
      status: conversation.status,
    })
    .from(conversation)
    .where(and(eq(conversation.workspaceId, workspaceId), ne(conversation.status, 'archived')))
    .orderBy(desc(conversation.lastMessageAt));

  const activeId = sp.id ?? conductorThread.id;
  const active = conversations.find((c) => c.id === activeId) ?? conductorThread;

  const messages = await db
    .select({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      model: message.model,
      provider: message.provider,
    })
    .from(message)
    .where(eq(message.conversationId, active.id))
    .orderBy(asc(message.createdAt))
    .limit(200);

  const toolCalls = await db
    .select({
      id: toolCall.id,
      tool: toolCall.tool,
      args: toolCall.args,
      status: toolCall.status,
      result: toolCall.result,
      error: toolCall.error,
      aclMode: toolCall.aclMode,
      estimatedCostUsd: toolCall.estimatedCostUsd,
      requestedAt: toolCall.requestedAt,
      finishedAt: toolCall.finishedAt,
    })
    .from(toolCall)
    .where(eq(toolCall.conversationId, active.id))
    .orderBy(desc(toolCall.requestedAt))
    .limit(20);

  return (
    <div className="flex gap-4">
      <ConductorSidebar
        conversations={conversations.map((c) => ({
          id: c.id,
          kind: c.kind as 'conductor' | 'side' | 'project' | 'tool',
          title: c.title,
          lastMessageAt: c.lastMessageAt ? new Date(c.lastMessageAt).toISOString() : null,
          status: c.status as 'active' | 'archived' | 'pinned',
        }))}
        activeId={active.id}
      />
      <div className="flex-1">
        <ConductorChat
          conversationId={active.id}
          title={active.title}
          initialMessages={messages.map((m) => ({
            id: m.id,
            role: m.role as 'system' | 'user' | 'assistant' | 'tool',
            content: m.content,
            createdAt: new Date(m.createdAt).toISOString(),
            model: m.model,
            provider: m.provider,
          }))}
          initialToolCalls={toolCalls.map((tc) => ({
            id: tc.id,
            tool: tc.tool,
            args: (tc.args as Record<string, unknown>) ?? {},
            status: tc.status as never,
            result: tc.result,
            error: tc.error,
            aclMode: tc.aclMode,
            estimatedCostUsd: tc.estimatedCostUsd,
            requestedAt: new Date(tc.requestedAt).toISOString(),
            finishedAt: tc.finishedAt ? new Date(tc.finishedAt).toISOString() : null,
          }))}
        />
      </div>
    </div>
  );
}

import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { and, asc, desc, eq, isNull, ne, or } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { conversation, message, project, toolCall } from '@metu/db/schema';
import { ConductorChat } from '@/components/conductor-chat';
import { ConversationSidebar, type ConvoListItem } from '@/components/conversation-sidebar';

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

  const activeId = sp.id ?? conductorThread.id;
  const [active] = await db
    .select({
      id: conversation.id,
      title: conversation.title,
      workspaceId: conversation.workspaceId,
    })
    .from(conversation)
    .where(and(eq(conversation.id, activeId), eq(conversation.workspaceId, workspaceId)))
    .limit(1);
  const target = active ?? conductorThread;

  const messages = await db
    .select({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      model: message.model,
      provider: message.provider,
      metadata: message.metadata,
    })
    .from(message)
    .where(eq(message.conversationId, target.id))
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
    .where(eq(toolCall.conversationId, target.id))
    .orderBy(desc(toolCall.requestedAt))
    .limit(20);

  // Sidebar data: every active conversation in the workspace + a project list
  // for the promote menu. Excludes ephemeral `tool` conversations.
  const sidebarConvos = await db
    .select({
      id: conversation.id,
      title: conversation.title,
      kind: conversation.kind,
      projectId: conversation.projectId,
      projectName: project.name,
      lastMessageAt: conversation.lastMessageAt,
    })
    .from(conversation)
    .leftJoin(project, eq(project.id, conversation.projectId))
    .where(
      and(
        eq(conversation.workspaceId, workspaceId),
        or(eq(conversation.status, 'active'), eq(conversation.status, 'pinned')),
        ne(conversation.kind, 'tool'),
      ),
    )
    .orderBy(desc(conversation.lastMessageAt))
    .limit(100);

  const projects = await db
    .select({ id: project.id, name: project.name })
    .from(project)
    .where(and(eq(project.workspaceId, workspaceId), isNull(project.deletedAt)))
    .orderBy(desc(project.lastMeaningfulActivityAt))
    .limit(50);

  const sideChats: ConvoListItem[] = [];
  const projectChats: ConvoListItem[] = [];
  let conductorThreadItem: ConvoListItem | null = null;
  for (const c of sidebarConvos) {
    const item: ConvoListItem = {
      id: c.id,
      title: c.title,
      kind: c.kind as ConvoListItem['kind'],
      projectId: c.projectId ?? null,
      projectName: c.projectName ?? null,
      lastMessageAt: c.lastMessageAt ? new Date(c.lastMessageAt).toISOString() : null,
    };
    if (c.kind === 'conductor') conductorThreadItem = item;
    else if (c.kind === 'project') projectChats.push(item);
    else if (c.kind === 'side') sideChats.push(item);
  }
  if (!conductorThreadItem) {
    conductorThreadItem = {
      id: conductorThread.id,
      title: conductorThread.title,
      kind: 'conductor',
      projectId: null,
      projectName: null,
      lastMessageAt: null,
    };
  }

  return (
    <div className="flex gap-4">
      <ConversationSidebar
        activeId={target.id}
        conductorThread={conductorThreadItem}
        sideChats={sideChats}
        projectChats={projectChats}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      />
      <div className="min-w-0 flex-1">
        <ConductorChat
          conversationId={target.id}
          title={target.title}
          initialMessages={messages.map((m) => {
            const meta = (m.metadata ?? {}) as Record<string, unknown>;
            const triggerReason =
              typeof meta.triggerReason === 'string' ? meta.triggerReason : null;
            return {
              id: m.id,
              role: m.role as 'system' | 'user' | 'assistant' | 'tool',
              content: m.content,
              createdAt: new Date(m.createdAt).toISOString(),
              model: m.model,
              provider: m.provider,
              triggerReason,
            };
          })}
          initialToolCalls={toolCalls.map((tc) => ({
            id: tc.id,
            tool: tc.tool,
            args: (tc.args as Record<string, unknown>) ?? {},
            status: tc.status as never,
            result: tc.result,
            error: tc.error,
            aclMode: tc.aclMode,
            estimatedCostUsd: tc.estimatedCostUsd,
            requestedAt: tc.requestedAt.toISOString(),
            finishedAt: tc.finishedAt ? tc.finishedAt.toISOString() : null,
          }))}
        />
      </div>
    </div>
  );
}

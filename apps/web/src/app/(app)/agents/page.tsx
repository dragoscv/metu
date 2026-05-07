import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { and, desc, eq, gte } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { agentRun, conversation, toolCall } from '@metu/db/schema';
import { Page, PageHeader } from '@metu/ui';
import { AgentsView, type AgentRunRow } from '@/components/agents-view';

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; status?: string; kind?: string }>;
}) {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const sp = await searchParams;
  const view = (sp.view ?? 'cards') as 'cards' | 'table' | 'kanban' | 'timeline';
  const wsId = session.user.workspaceId;
  const db = getDb();

  // Last 7 days of agent runs.
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const runs = await db
    .select({
      id: agentRun.id,
      kind: agentRun.kind,
      intent: agentRun.intent,
      providerUsed: agentRun.providerUsed,
      modelUsed: agentRun.modelUsed,
      inputTokens: agentRun.inputTokens,
      outputTokens: agentRun.outputTokens,
      costUsd: agentRun.costUsd,
      status: agentRun.status,
      inputPreview: agentRun.inputPreview,
      outputPreview: agentRun.outputPreview,
      error: agentRun.error,
      startedAt: agentRun.startedAt,
      finishedAt: agentRun.finishedAt,
    })
    .from(agentRun)
    .where(and(eq(agentRun.workspaceId, wsId), gte(agentRun.startedAt, since)))
    .orderBy(desc(agentRun.startedAt))
    .limit(200);

  const recentToolCalls = await db
    .select({
      id: toolCall.id,
      tool: toolCall.tool,
      status: toolCall.status,
      requestedAt: toolCall.requestedAt,
      finishedAt: toolCall.finishedAt,
      aclMode: toolCall.aclMode,
      conversationId: toolCall.conversationId,
    })
    .from(toolCall)
    .where(eq(toolCall.workspaceId, wsId))
    .orderBy(desc(toolCall.requestedAt))
    .limit(50);

  const threads = await db
    .select({
      id: conversation.id,
      title: conversation.title,
      kind: conversation.kind,
      lastMessageAt: conversation.lastMessageAt,
      status: conversation.status,
    })
    .from(conversation)
    .where(eq(conversation.workspaceId, wsId))
    .orderBy(desc(conversation.lastMessageAt))
    .limit(30);

  const ui: AgentRunRow[] = runs.map((r) => ({
    ...r,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
  }));

  return (
    <Page>
      <PageHeader
        title="Agents"
        description="Every AI invocation, tool call, and long-running session in one place."
      />
      <AgentsView
        view={view}
        runs={ui}
        toolCalls={recentToolCalls.map((tc) => ({
          ...tc,
          requestedAt: tc.requestedAt.toISOString(),
          finishedAt: tc.finishedAt?.toISOString() ?? null,
        }))}
        threads={threads.map((t) => ({
          ...t,
          lastMessageAt: t.lastMessageAt?.toISOString() ?? null,
        }))}
      />
    </Page>
  );
}

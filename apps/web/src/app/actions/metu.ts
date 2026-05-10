'use server';
/**
 * Server actions for the /metu agent dashboard.
 *
 * - getMetuOverviewAction: status (enabled, mode, model, tick), 24h stats,
 *   pending approvals, latest pulse, autonomy hints.
 * - getRecentAgentActivityAction: tool_call feed for the activity timeline.
 * - kickConductorAction: emits a manual `conductor/tick` for "wake up now".
 * - reindexGithubRepoAction: re-runs github seeding for an existing link.
 */
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import {
  agentPolicy,
  conversation,
  integration,
  integrationResource,
  message,
  project,
  projectLink,
  toolCall,
} from '@metu/db/schema';
import { revalidatePath } from 'next/cache';
import { inngest } from '@/inngest/client';

const RecentActivityLimitSchema = z.number().int().optional();
const ReindexGithubRepoSchema = z.object({
  projectId: z.string().uuid(),
  integrationId: z.string().uuid(),
  repoFullName: z.string().min(1),
  repoUrl: z.string().url(),
});
const KickGithubStatsSyncSchema = z.object({ projectId: z.string().uuid().optional() }).optional();

export interface MetuStatus {
  enabled: boolean;
  defaultMode: string;
  tickIntervalSec: number;
  notificationLevel: number;
  dailyCostCapUsd: number | null;
  dailyActionCap: number | null;
}

export interface MetuStats24h {
  toolCalls: number;
  succeeded: number;
  failed: number;
  pendingApproval: number;
  costUsd: number;
}

export interface MetuPulse {
  id: string;
  content: string;
  createdAt: string;
  provider: string | null;
  model: string | null;
  actionCount: number;
}

export interface MetuPendingApproval {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  conversationId: string | null;
  requestedAt: string;
}

export interface MetuToolCounts {
  tool: string;
  total: number;
}

export interface MetuRepoIntel {
  projectId: string;
  projectName: string;
  repoFullName: string;
  integrationId: string;
  url: string;
  chunkCount: number;
}

export interface MetuOverview {
  status: MetuStatus;
  stats: MetuStats24h;
  pulse: MetuPulse | null;
  pending: MetuPendingApproval[];
  toolMix: MetuToolCounts[];
  integrationsCount: number;
  projectsCount: number;
  repos: MetuRepoIntel[];
  conductorThreadId: string;
}

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

async function ensurePolicy(workspaceId: string) {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(agentPolicy)
    .where(eq(agentPolicy.workspaceId, workspaceId))
    .limit(1);
  if (existing) return existing;
  const [created] = await db.insert(agentPolicy).values({ workspaceId }).returning();
  return created!;
}

export async function getMetuOverviewAction(): Promise<
  { ok: true; data: MetuOverview } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session) return { ok: false, error: 'Unauthenticated' };
  const wsId = session.user.workspaceId;
  const db = getDb();

  const policy = await ensurePolicy(wsId);
  const thread = await ensureConductorThread(wsId);

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  // "Spent today" — calendar day in UTC, matching how `dailyCostCapUsd` is
  // enforced. (Per-user-tz would need session preferences plumbed in here.)
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);

  const [statsRow] = await db
    .select({
      total: sql<number>`count(*)::int`,
      succeeded: sql<number>`count(*) filter (where ${toolCall.status} = 'success')::int`,
      failed: sql<number>`count(*) filter (where ${toolCall.status} = 'failed')::int`,
    })
    .from(toolCall)
    .where(and(eq(toolCall.workspaceId, wsId), gte(toolCall.requestedAt, since)));

  // Pending approval is global (no time window) — older asks should still
  // surface in the count and match the list rendered below.
  const [pendingCountRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(toolCall)
    .where(and(eq(toolCall.workspaceId, wsId), eq(toolCall.status, 'awaiting_approval')));

  // Cost today = LLM spend (assistant messages) + tool-call cost.
  const [toolCostRow] = await db
    .select({
      cost: sql<number>`coalesce(sum(coalesce(${toolCall.actualCostUsd}, ${toolCall.estimatedCostUsd}, 0)), 0)::float`,
    })
    .from(toolCall)
    .where(and(eq(toolCall.workspaceId, wsId), gte(toolCall.requestedAt, startOfToday)));

  const [msgCostRow] = await db
    .select({
      cost: sql<number>`coalesce(sum(coalesce(${message.costUsd}, 0)), 0)::float`,
    })
    .from(message)
    .where(
      and(
        eq(message.workspaceId, wsId),
        eq(message.role, 'assistant'),
        gte(message.createdAt, startOfToday),
      ),
    );

  const stats: MetuStats24h = {
    toolCalls: statsRow?.total ?? 0,
    succeeded: statsRow?.succeeded ?? 0,
    failed: statsRow?.failed ?? 0,
    pendingApproval: pendingCountRow?.n ?? 0,
    costUsd: (toolCostRow?.cost ?? 0) + (msgCostRow?.cost ?? 0),
  };

  const [latestPulse] = await db
    .select({
      id: message.id,
      content: message.content,
      createdAt: message.createdAt,
      provider: message.provider,
      model: message.model,
      metadata: message.metadata,
    })
    .from(message)
    .where(
      and(
        eq(message.workspaceId, wsId),
        eq(message.conversationId, thread.id),
        eq(message.role, 'assistant'),
      ),
    )
    .orderBy(desc(message.createdAt))
    .limit(1);

  const pulse: MetuPulse | null = latestPulse
    ? {
        id: latestPulse.id,
        content: latestPulse.content,
        createdAt: new Date(latestPulse.createdAt).toISOString(),
        provider: latestPulse.provider,
        model: latestPulse.model,
        actionCount: Array.isArray(
          (latestPulse.metadata as { actions?: unknown[] } | null)?.actions,
        )
          ? ((latestPulse.metadata as { actions: unknown[] }).actions.length as number)
          : 0,
      }
    : null;

  const pendingRows = await db
    .select({
      id: toolCall.id,
      tool: toolCall.tool,
      args: toolCall.args,
      conversationId: toolCall.conversationId,
      requestedAt: toolCall.requestedAt,
    })
    .from(toolCall)
    .where(and(eq(toolCall.workspaceId, wsId), eq(toolCall.status, 'awaiting_approval')))
    .orderBy(desc(toolCall.requestedAt))
    .limit(8);
  const pending: MetuPendingApproval[] = pendingRows.map((r) => ({
    id: r.id,
    tool: r.tool,
    args: (r.args as Record<string, unknown>) ?? {},
    conversationId: r.conversationId,
    requestedAt: new Date(r.requestedAt).toISOString(),
  }));

  const toolMixRows = await db
    .select({
      tool: toolCall.tool,
      total: sql<number>`count(*)::int`,
    })
    .from(toolCall)
    .where(and(eq(toolCall.workspaceId, wsId), gte(toolCall.requestedAt, since)))
    .groupBy(toolCall.tool)
    .orderBy(desc(sql`count(*)`))
    .limit(6);

  const integCountRows = await db
    .select({ ic: sql<number>`count(*)::int` })
    .from(integration)
    .where(and(eq(integration.workspaceId, wsId), eq(integration.status, 'active')));
  const integrationsCount = integCountRows[0]?.ic ?? 0;

  const projCountRows = await db
    .select({ pc: sql<number>`count(*)::int` })
    .from(project)
    .where(eq(project.workspaceId, wsId));
  const projectsCount = projCountRows[0]?.pc ?? 0;

  const repoRows = await db
    .select({
      projectId: projectLink.projectId,
      projectName: project.name,
      url: projectLink.url,
      title: projectLink.title,
      integrationId: integrationResource.integrationId,
      externalId: integrationResource.externalId,
      chunkCount: sql<number>`(
        select count(*)::int
        from memory_chunk mc
        where mc.project_id = ${projectLink.projectId}
          and mc.workspace_id = ${projectLink.workspaceId}
      )`,
    })
    .from(projectLink)
    .innerJoin(project, eq(project.id, projectLink.projectId))
    .leftJoin(integrationResource, eq(integrationResource.id, projectLink.resourceId))
    .where(
      and(
        eq(projectLink.workspaceId, wsId),
        eq(projectLink.provider, 'github'),
        eq(projectLink.kind, 'repo'),
      ),
    )
    .limit(20);

  const repos: MetuRepoIntel[] = repoRows
    .filter((r) => r.integrationId)
    .map((r) => ({
      projectId: r.projectId,
      projectName: r.projectName,
      repoFullName: r.externalId ?? r.title,
      integrationId: r.integrationId!,
      url: r.url,
      chunkCount: r.chunkCount ?? 0,
    }));

  return {
    ok: true,
    data: {
      status: {
        enabled: policy.enabled,
        defaultMode: policy.defaultMode,
        tickIntervalSec: policy.tickIntervalSec,
        notificationLevel: policy.notificationLevel,
        dailyCostCapUsd: policy.dailyCostCapUsd,
        dailyActionCap: policy.dailyActionCap,
      },
      stats,
      pulse,
      pending,
      toolMix: toolMixRows.map((r) => ({ tool: r.tool, total: r.total })),
      integrationsCount,
      projectsCount,
      repos,
      conductorThreadId: thread.id,
    },
  };
}

export interface AgentActivityRow {
  id: string;
  tool: string;
  status: string;
  aclMode: string | null;
  conversationId: string | null;
  requestedAt: string;
  finishedAt: string | null;
  estimatedCostUsd: number | null;
  error: string | null;
}

export async function getRecentAgentActivityAction(
  limit = 30,
): Promise<{ ok: true; data: AgentActivityRow[] } | { ok: false; error: string }> {
  const parsed = RecentActivityLimitSchema.safeParse(limit);
  if (!parsed.success) return { ok: false, error: 'invalid_input' };
  limit = parsed.data ?? 30;
  const session = await auth();
  if (!session) return { ok: false, error: 'Unauthenticated' };
  const db = getDb();
  const rows = await db
    .select({
      id: toolCall.id,
      tool: toolCall.tool,
      status: toolCall.status,
      aclMode: toolCall.aclMode,
      conversationId: toolCall.conversationId,
      requestedAt: toolCall.requestedAt,
      finishedAt: toolCall.finishedAt,
      estimatedCostUsd: toolCall.estimatedCostUsd,
      error: toolCall.error,
    })
    .from(toolCall)
    .where(eq(toolCall.workspaceId, session.user.workspaceId))
    .orderBy(desc(toolCall.requestedAt))
    .limit(Math.min(Math.max(limit, 1), 100));
  return {
    ok: true,
    data: rows.map((r) => ({
      id: r.id,
      tool: r.tool,
      status: r.status,
      aclMode: r.aclMode,
      conversationId: r.conversationId,
      requestedAt: new Date(r.requestedAt).toISOString(),
      finishedAt: r.finishedAt ? new Date(r.finishedAt).toISOString() : null,
      estimatedCostUsd: r.estimatedCostUsd,
      error: r.error,
    })),
  };
}

export async function kickConductorAction() {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  await inngest
    .send({
      name: 'conductor/tick',
      data: { workspaceId: session.user.workspaceId, reason: 'manual' },
    })
    .catch(() => {});
  revalidatePath('/metu');
  return { ok: true as const };
}

export async function reindexGithubRepoAction(input: {
  projectId: string;
  integrationId: string;
  repoFullName: string;
  repoUrl: string;
}) {
  const parsed = ReindexGithubRepoSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'invalid_input' };
  input = parsed.data;
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  await inngest
    .send({
      name: 'github/repo.linked',
      data: {
        workspaceId: session.user.workspaceId,
        userId: session.user.id,
        projectId: input.projectId,
        integrationId: input.integrationId,
        repoFullName: input.repoFullName,
        repoUrl: input.repoUrl,
      },
    })
    .catch(() => {});

  // Also refresh stats so the dashboard reflects new commits/PRs/issues.
  const db = getDb();
  const [res] = await db
    .select({ id: integrationResource.id })
    .from(integrationResource)
    .where(
      and(
        eq(integrationResource.workspaceId, session.user.workspaceId),
        eq(integrationResource.provider, 'github'),
        eq(integrationResource.externalId, input.repoFullName),
      ),
    )
    .limit(1);
  if (res) {
    await inngest
      .send({
        name: 'github/stats.sync.repo',
        data: {
          workspaceId: session.user.workspaceId,
          integrationId: input.integrationId,
          resourceId: res.id,
          repoFullName: input.repoFullName,
          reason: 'manual-reindex',
        },
      })
      .catch(() => {});
  }

  return { ok: true as const };
}

/**
 * Kick a stats refresh for every GitHub repo in the workspace, optionally
 * narrowed to a single project. Used by the "Refresh stats" button on
 * /projects/[id] and surfaced as a manual control on /metu.
 */
export async function kickGithubStatsSyncAction(input?: { projectId?: string }) {
  const parsed = KickGithubStatsSyncSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'invalid_input' };
  input = parsed.data;
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const db = getDb();
  const wsId = session.user.workspaceId;

  const conds = [
    eq(projectLink.workspaceId, wsId),
    eq(projectLink.provider, 'github'),
    eq(projectLink.kind, 'repo'),
  ];
  if (input?.projectId) conds.push(eq(projectLink.projectId, input.projectId));

  const rows = await db
    .select({
      resourceId: integrationResource.id,
      integrationId: integrationResource.integrationId,
      repoFullName: integrationResource.externalId,
    })
    .from(projectLink)
    .innerJoin(integrationResource, eq(integrationResource.id, projectLink.resourceId))
    .where(and(...conds));

  let queued = 0;
  for (const r of rows) {
    if (!r.integrationId) continue;
    await inngest
      .send({
        name: 'github/stats.sync.repo',
        data: {
          workspaceId: wsId,
          integrationId: r.integrationId,
          resourceId: r.resourceId,
          repoFullName: r.repoFullName,
          reason: 'manual',
        },
      })
      .catch(() => {});
    queued++;
  }
  if (input?.projectId) revalidatePath(`/projects/${input.projectId}`);
  revalidatePath('/projects');
  return { ok: true as const, queued };
}

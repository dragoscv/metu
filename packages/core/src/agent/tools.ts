/**
 * Tool registry — every action the Conductor (or any agent) can take.
 *
 * Each tool has:
 *  - a zod schema for args (used for both LLM tool-use schema + validation),
 *  - a `kind` tag that drives the default ACL (read / low_risk / high_risk),
 *  - an `execute` function that performs the side effect,
 *  - an optional `undo` function that reverses it.
 *
 * The Conductor never calls execute() directly — it always goes through
 * `runTool()` in policy.ts which enforces the per-workspace ACL, records the
 * tool_call audit row, and writes a timeline event.
 */
import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@metu/db';
import {
  agentPolicy,
  capture,
  continuityBriefing,
  decision,
  goal,
  githubRepoStats,
  integration,
  notification,
  project,
  projectLink,
  task,
  telegramChatLink,
  timelineEvent,
} from '@metu/db/schema';
import { callRemoteTool, type ExternalMcpConfig } from '@metu/integrations/mcp';
import { sendTextMessage as sendTelegramText } from '@metu/integrations/telegram';
import { octokitForToken } from '@metu/integrations/github';
import { open as openSealed, getModel, buildConductorSystem } from '@metu/ai';
import { generateObject, generateText } from 'ai';
import { listRecentBriefings } from '@metu/db/queries';
import * as memoryEngine from '../memory';
import { restoreProjectContext } from '../continuity';
import { DEVICE_TOOLS } from './device-tools';
import { EDITOR_TOOLS } from './editor-tools';

interface RecallRow {
  id: string;
  content: string;
  similarity: number;
  source_kind: string;
  source_id: string;
}

export type ToolKind = 'read' | 'low_risk' | 'high_risk';

export interface ToolContext {
  workspaceId: string;
  userId: string;
  /**
   * The `tool_call.id` row created by `runTool` for this invocation. Device
   * tools use it as the `tool.invoke` envelope id so the eventual
   * `tool.result` from the device matches the awaited promise.
   */
  toolCallId?: string;
}

export interface ToolDefinition<TArgs extends z.ZodTypeAny, TResult = unknown> {
  name: string;
  description: string;
  kind: ToolKind;
  args: TArgs;
  execute: (
    args: z.infer<TArgs>,
    ctx: ToolContext,
  ) => Promise<{ result: TResult; undoPayload?: Record<string, unknown> | null }>;
  /** Reverses the effect of `execute` using the recorded undoPayload. */
  undo?: (undoPayload: Record<string, unknown>, ctx: ToolContext) => Promise<void>;
}

// ─── recall ────────────────────────────────────────────────────────────────

const recallArgs = z.object({
  query: z.string().min(1).describe('Natural-language query.'),
  projectId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(25).default(8),
});

const recallTool: ToolDefinition<typeof recallArgs> = {
  name: 'recall',
  description:
    'Hybrid semantic search across the user second brain. Use it to ground every claim before answering.',
  kind: 'read',
  args: recallArgs,
  async execute(args, ctx) {
    const hits = await memoryEngine.recall({
      workspaceId: ctx.workspaceId,
      query: args.query,
      projectId: args.projectId,
      limit: args.limit ?? 8,
    });
    const rows =
      ((hits as { rows?: unknown[] }).rows as RecallRow[] | undefined) ??
      (hits as unknown as RecallRow[]);
    return {
      result: (rows ?? []).map((h) => ({
        id: h.id,
        content: h.content,
        similarity: h.similarity,
        sourceKind: h.source_kind,
        sourceId: h.source_id,
      })),
    };
  },
};

// ─── github_repo_stats ─────────────────────────────────────────────────────

const githubRepoStatsArgs = z.object({
  projectId: z.string().uuid().optional().describe('Narrow to repos linked to a specific project.'),
  repoFullName: z
    .string()
    .optional()
    .describe('Match a single repo by "owner/name". Takes precedence over projectId.'),
  limit: z.number().int().min(1).max(20).default(10),
});

const githubRepoStatsTool: ToolDefinition<typeof githubRepoStatsArgs> = {
  name: 'github_repo_stats',
  description:
    'Latest GitHub activity snapshot per linked repo: commits 7d/30d, open PRs, open issues, merged PRs 30d, primary language, streak. Use to ground claims about coding work and momentum.',
  kind: 'read',
  args: githubRepoStatsArgs,
  async execute(args, ctx) {
    const db = getDb();
    const baseSelect = {
      repoFullName: githubRepoStats.repoFullName,
      primaryLanguage: githubRepoStats.primaryLanguage,
      stargazers: githubRepoStats.stargazers,
      openIssues: githubRepoStats.openIssues,
      openPullRequests: githubRepoStats.openPullRequests,
      commitsLast7d: githubRepoStats.commitsLast7d,
      commitsLast30d: githubRepoStats.commitsLast30d,
      mergedPrsLast30d: githubRepoStats.mergedPrsLast30d,
      closedIssuesLast30d: githubRepoStats.closedIssuesLast30d,
      currentStreakDays: githubRepoStats.currentStreakDays,
      lastCommitAt: githubRepoStats.lastCommitAt,
      lastSyncedAt: githubRepoStats.lastSyncedAt,
    };

    if (args.repoFullName) {
      const rows = await db
        .select(baseSelect)
        .from(githubRepoStats)
        .where(
          and(
            eq(githubRepoStats.workspaceId, ctx.workspaceId),
            eq(githubRepoStats.repoFullName, args.repoFullName),
          ),
        )
        .limit(args.limit);
      return { result: rows };
    }

    if (args.projectId) {
      const rows = await db
        .select(baseSelect)
        .from(githubRepoStats)
        .innerJoin(projectLink, eq(projectLink.resourceId, githubRepoStats.resourceId))
        .where(
          and(
            eq(githubRepoStats.workspaceId, ctx.workspaceId),
            eq(projectLink.projectId, args.projectId),
          ),
        )
        .orderBy(desc(githubRepoStats.commitsLast7d))
        .limit(args.limit);
      return { result: rows };
    }

    const rows = await db
      .select(baseSelect)
      .from(githubRepoStats)
      .where(eq(githubRepoStats.workspaceId, ctx.workspaceId))
      .orderBy(desc(githubRepoStats.commitsLast7d))
      .limit(args.limit);
    return { result: rows };
  },
};

// ─── list_projects ─────────────────────────────────────────────────────────

const listProjectsArgs = z.object({
  status: z.enum(['active', 'paused', 'archived', 'killed']).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

const listProjectsTool: ToolDefinition<typeof listProjectsArgs> = {
  name: 'list_projects',
  description: 'List the workspace projects with momentum and last activity.',
  kind: 'read',
  args: listProjectsArgs,
  async execute(args, ctx) {
    const db = getDb();
    const rows = await db
      .select({
        id: project.id,
        name: project.name,
        summary: project.summary,
        stateSummary: project.stateSummary,
        status: project.status,
        momentumScore: project.momentumScore,
        lastMeaningfulActivityAt: project.lastMeaningfulActivityAt,
      })
      .from(project)
      .where(
        and(
          eq(project.workspaceId, ctx.workspaceId),
          isNull(project.deletedAt),
          args.status ? eq(project.status, args.status) : sql`true`,
        ),
      )
      .orderBy(desc(project.momentumScore))
      .limit(args.limit);
    return { result: rows };
  },
};

// ─── list_tasks ────────────────────────────────────────────────────────────

const listTasksArgs = z.object({
  projectId: z.string().uuid().optional(),
  status: z.enum(['inbox', 'next', 'doing', 'blocked', 'done', 'dropped']).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

const listTasksTool: ToolDefinition<typeof listTasksArgs> = {
  name: 'list_tasks',
  description: 'List tasks, optionally scoped to a project or status.',
  kind: 'read',
  args: listTasksArgs,
  async execute(args, ctx) {
    const db = getDb();
    const rows = await db
      .select()
      .from(task)
      .where(
        and(
          eq(task.workspaceId, ctx.workspaceId),
          isNull(task.deletedAt),
          args.projectId ? eq(task.projectId, args.projectId) : sql`true`,
          args.status ? eq(task.status, args.status) : sql`true`,
        ),
      )
      .orderBy(desc(task.leverageScore))
      .limit(args.limit);
    return { result: rows };
  },
};

// ─── create_task ───────────────────────────────────────────────────────────

const createTaskArgs = z.object({
  title: z.string().min(2).max(200),
  body: z.string().max(4000).optional(),
  projectId: z.string().uuid().optional(),
  kind: z.enum(['deep', 'shallow', 'creative', 'maintenance']).default('shallow'),
  status: z.enum(['inbox', 'next', 'doing', 'blocked']).default('inbox'),
});

const createTaskTool: ToolDefinition<typeof createTaskArgs> = {
  name: 'create_task',
  description:
    'Create a new task. Use freely — the user can always reject. AI-suggested tasks land in "inbox" by default.',
  kind: 'low_risk',
  args: createTaskArgs,
  async execute(args, ctx) {
    const db = getDb();
    const [row] = await db
      .insert(task)
      .values({
        workspaceId: ctx.workspaceId,
        projectId: args.projectId ?? null,
        title: args.title,
        body: args.body ?? null,
        kind: args.kind,
        status: args.status,
        aiSuggested: 1,
      })
      .returning();
    return {
      result: { id: row!.id, title: args.title },
      undoPayload: { taskId: row!.id },
    };
  },
  async undo(payload, ctx) {
    const db = getDb();
    await db
      .update(task)
      .set({ deletedAt: new Date(), status: 'dropped' })
      .where(and(eq(task.id, String(payload.taskId)), eq(task.workspaceId, ctx.workspaceId)));
  },
};

// ─── pin_to_goal ───────────────────────────────────────────────────────────

const pinToGoalArgs = z.object({
  refKind: z.enum(['task', 'project', 'decision']),
  refId: z.string().uuid(),
  goalId: z.string().uuid().nullable().describe('Goal id to pin to, or null to unpin.'),
});

const pinToGoalTool: ToolDefinition<typeof pinToGoalArgs> = {
  name: 'pin_to_goal',
  description:
    'Pin a task, project, or decision to a goal so it counts toward goal progress and shows on the goal board. Pass goalId=null to unpin.',
  kind: 'low_risk',
  args: pinToGoalArgs,
  async execute(args, ctx) {
    const db = getDb();
    const tableMap = { task, project, decision } as const;
    const t = tableMap[args.refKind];
    // Verify ownership + load previous goal
    const [existing] = await db
      .select({ id: t.id, goalId: t.goalId })
      .from(t)
      .where(and(eq(t.id, args.refId), eq(t.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!existing) throw new Error(`${args.refKind} not found`);
    if (args.goalId) {
      const [g] = await db
        .select({ id: goal.id })
        .from(goal)
        .where(and(eq(goal.id, args.goalId), eq(goal.workspaceId, ctx.workspaceId)))
        .limit(1);
      if (!g) throw new Error('goal not found');
    }
    if (existing.goalId === args.goalId) {
      return { result: { changed: false, previousGoalId: existing.goalId } };
    }
    await db
      .update(t)
      .set({ goalId: args.goalId })
      .where(and(eq(t.id, args.refId), eq(t.workspaceId, ctx.workspaceId)));
    return {
      result: { changed: true, previousGoalId: existing.goalId, newGoalId: args.goalId },
      undoPayload: { refKind: args.refKind, refId: args.refId, previousGoalId: existing.goalId },
    };
  },
  async undo(payload, ctx) {
    const db = getDb();
    const tableMap = { task, project, decision } as const;
    const refKind = String(payload.refKind) as 'task' | 'project' | 'decision';
    const t = tableMap[refKind];
    await db
      .update(t)
      .set({ goalId: (payload.previousGoalId as string | null) ?? null })
      .where(and(eq(t.id, String(payload.refId)), eq(t.workspaceId, ctx.workspaceId)));
  },
};

// ─── propose_decision ──────────────────────────────────────────────────────

const proposeDecisionArgs = z.object({
  title: z.string().min(2).max(200),
  rationale: z.string().min(2).max(4000),
  alternatives: z
    .array(z.object({ option: z.string(), tradeoff: z.string().optional() }))
    .default([]),
  projectId: z.string().uuid().optional(),
});

const proposeDecisionTool: ToolDefinition<typeof proposeDecisionArgs> = {
  name: 'propose_decision',
  description:
    'Log a decision (with rationale + considered alternatives) into the decision log. The decision log is the secret weapon for context restore.',
  kind: 'low_risk',
  args: proposeDecisionArgs,
  async execute(args, ctx) {
    const db = getDb();
    const [row] = await db
      .insert(decision)
      .values({
        workspaceId: ctx.workspaceId,
        projectId: args.projectId ?? null,
        title: args.title,
        rationale: args.rationale,
        alternatives: args.alternatives,
      })
      .returning();
    return {
      result: { id: row!.id, title: args.title },
      undoPayload: { decisionId: row!.id },
    };
  },
  async undo(payload, ctx) {
    const db = getDb();
    await db
      .update(decision)
      .set({ deletedAt: new Date() })
      .where(
        and(eq(decision.id, String(payload.decisionId)), eq(decision.workspaceId, ctx.workspaceId)),
      );
  },
};

// ─── tag_capture ───────────────────────────────────────────────────────────

const tagCaptureArgs = z.object({
  captureId: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string()).default([]),
});

const tagCaptureTool: ToolDefinition<typeof tagCaptureArgs> = {
  name: 'tag_capture',
  description: 'Attach a capture to a project and/or add tags to its metadata.',
  kind: 'low_risk',
  args: tagCaptureArgs,
  async execute(args, ctx) {
    const db = getDb();
    const [before] = await db
      .select({
        id: capture.id,
        projectId: capture.projectId,
        metadata: capture.metadata,
      })
      .from(capture)
      .where(and(eq(capture.id, args.captureId), eq(capture.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!before) throw new Error('capture not found');
    const meta = (before.metadata as Record<string, unknown>) ?? {};
    const nextMeta = { ...meta, tags: args.tags };
    await db
      .update(capture)
      .set({
        projectId: args.projectId === undefined ? before.projectId : args.projectId,
        metadata: nextMeta,
      })
      .where(and(eq(capture.id, args.captureId), eq(capture.workspaceId, ctx.workspaceId)));
    return {
      result: { ok: true },
      undoPayload: {
        captureId: args.captureId,
        prevProjectId: before.projectId,
        prevMetadata: meta,
      },
    };
  },
  async undo(payload, ctx) {
    const db = getDb();
    await db
      .update(capture)
      .set({
        projectId: (payload.prevProjectId as string | null) ?? null,
        metadata: (payload.prevMetadata as Record<string, unknown>) ?? {},
      })
      .where(
        and(eq(capture.id, String(payload.captureId)), eq(capture.workspaceId, ctx.workspaceId)),
      );
  },
};

// ─── notify_user ───────────────────────────────────────────────────────────

const notifyArgs = z.object({
  title: z.string().min(2).max(200),
  body: z.string().max(2000).optional(),
  urgency: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
  actionUrl: z.string().url().optional(),
});

const notifyTool: ToolDefinition<typeof notifyArgs> = {
  name: 'notify_user',
  description:
    'Send the user a notification. Respect the workspace notification slider — only use for high-signal events.',
  kind: 'low_risk',
  args: notifyArgs,
  async execute(args, ctx) {
    const db = getDb();
    const [row] = await db
      .insert(notification)
      .values({
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        title: args.title,
        body: args.body ?? null,
        urgency: args.urgency,
        source: 'conductor',
        actionUrl: args.actionUrl ?? null,
      })
      .returning();
    return { result: { id: row!.id } };
  },
};

// ─── log_observation ───────────────────────────────────────────────────────

const logObservationArgs = z.object({
  title: z.string().min(2).max(200),
  body: z.string().max(2000).optional(),
  importance: z.number().min(0).max(1).default(0.4),
  projectId: z.string().uuid().optional(),
});

const logObservationTool: ToolDefinition<typeof logObservationArgs> = {
  name: 'log_observation',
  description:
    'Append a synthesized observation to the timeline (e.g. "you decided X in chat", "shipping risk on project Y").',
  kind: 'low_risk',
  args: logObservationArgs,
  async execute(args, ctx) {
    const db = getDb();
    await db.insert(timelineEvent).values({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      projectId: args.projectId ?? null,
      kind: 'conductor.observation',
      title: args.title,
      body: args.body ?? null,
      importance: args.importance,
    });
    return { result: { ok: true } };
  },
};

// ─── restore_continuity ────────────────────────────────────────────────────

const restoreContinuityArgs = z.object({
  projectId: z.string().uuid().describe('Project to brief on.'),
});

const restoreContinuityTool: ToolDefinition<typeof restoreContinuityArgs> = {
  name: 'restore_continuity',
  description:
    'Generate a "where was I?" briefing for a project: 4 paragraphs over the last decisions, blockers, captures, and events ending in the smallest next step. Persists the result so future page loads land on it. Use when the user asks "what was I doing on X?" or before proposing the next move on a long-paused project.',
  // Generates derived state and persists it; treated as low_risk so the
  // default ACL is auto-with-undo, but we provide no undo (the briefing
  // is purely informational and superseded by the next regeneration).
  kind: 'low_risk',
  args: restoreContinuityArgs,
  async execute(args, ctx) {
    const db = getDb();
    const [proj] = await db
      .select({ id: project.id, name: project.name })
      .from(project)
      .where(and(eq(project.id, args.projectId), eq(project.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!proj) throw new Error('project_not_found');

    const generated = await restoreProjectContext(ctx.workspaceId, args.projectId);
    const [inserted] = await db
      .insert(continuityBriefing)
      .values({
        workspaceId: ctx.workspaceId,
        projectId: args.projectId,
        briefing: generated.briefing,
        modelProvider: generated.provider,
        modelId: generated.modelId,
      })
      .returning();
    return {
      result: {
        projectId: args.projectId,
        projectName: proj.name,
        briefing: generated.briefing,
        provider: generated.provider,
        modelId: generated.modelId,
        briefingId: inserted?.id ?? null,
      },
    };
  },
};

// ─── send_telegram ─────────────────────────────────────────────────────────

const metuResumeArgs = z.object({
  since: z
    .enum(['3d', '3w', '3m'])
    .default('3d')
    .describe('Time window: 3 days, 3 weeks, or 3 months.'),
  limit: z.number().int().min(1).max(20).default(8),
});

const SINCE_DAYS: Record<'3d' | '3w' | '3m', number> = { '3d': 3, '3w': 21, '3m': 90 };

const metuResumeTool: ToolDefinition<typeof metuResumeArgs> = {
  name: 'metu_resume',
  description:
    'Answer "where did I leave off?" for the user, scoped to a 3-day / 3-week / 3-month window. Returns the latest persisted briefings, the active projects with movement in that window (sorted by momentum), the open blocked tasks, and the count of meaningful timeline events. Read-only — safe to call anywhere.',
  kind: 'read',
  args: metuResumeArgs,
  async execute(args, ctx) {
    const days = SINCE_DAYS[args.since];
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const db = getDb();
    const [briefings, activeProjects, blockedTasks, eventCountRow] = await Promise.all([
      listRecentBriefings(ctx.workspaceId, args.limit),
      db
        .select({
          id: project.id,
          name: project.name,
          stateSummary: project.stateSummary,
          momentumScore: project.momentumScore,
          lastMeaningfulActivityAt: project.lastMeaningfulActivityAt,
          status: project.status,
        })
        .from(project)
        .where(
          and(
            eq(project.workspaceId, ctx.workspaceId),
            isNull(project.deletedAt),
            sql`${project.status} in ('active', 'paused')`,
            gte(project.lastMeaningfulActivityAt, cutoff),
          ),
        )
        .orderBy(desc(project.momentumScore), desc(project.lastMeaningfulActivityAt))
        .limit(args.limit),
      db
        .select({
          id: task.id,
          title: task.title,
          blockedReason: task.blockedReason,
          projectId: task.projectId,
          updatedAt: task.updatedAt,
        })
        .from(task)
        .where(
          and(
            eq(task.workspaceId, ctx.workspaceId),
            isNull(task.deletedAt),
            eq(task.status, 'blocked'),
          ),
        )
        .orderBy(desc(task.updatedAt))
        .limit(args.limit),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(timelineEvent)
        .where(
          and(
            eq(timelineEvent.workspaceId, ctx.workspaceId),
            gte(timelineEvent.occurredAt, cutoff),
          ),
        ),
    ]);
    return {
      result: {
        since: args.since,
        windowDays: days,
        windowStart: cutoff.toISOString(),
        timelineEventCount: eventCountRow[0]?.n ?? 0,
        briefings: briefings.map((b) => ({
          projectId: b.projectId,
          projectName: b.projectName,
          briefing: b.briefing,
          generatedAt: b.generatedAt.toISOString(),
          modelProvider: b.modelProvider,
          momentumScore: b.momentumScore,
        })),
        activeProjects,
        blockedTasks,
      },
    };
  },
};

// ─── send_telegram ─────────────────────────────────────────────────────────

const sendTelegramArgs = z.object({
  text: z.string().min(1).max(4000).describe('Plain-text message body (Telegram caps at 4096).'),
  chatId: z
    .string()
    .optional()
    .describe(
      'External Telegram chat id. When omitted, the most-recently-active linked chat in the workspace is used.',
    ),
  parseMode: z.enum(['Markdown', 'MarkdownV2', 'HTML']).optional(),
  silent: z.boolean().optional().describe('Send without device notification.'),
});

const sendTelegramTool: ToolDefinition<typeof sendTelegramArgs> = {
  name: 'send_telegram',
  description:
    'Send a Telegram message to the user via the linked metu bot. Only works for chats already linked in /settings/integrations/telegram. Inherently non-undoable — default ACL is `ask`.',
  kind: 'high_risk',
  args: sendTelegramArgs,
  async execute(args, ctx) {
    const db = getDb();
    let chatId = args.chatId ?? null;
    if (!chatId) {
      const [link] = await db
        .select({ chatId: telegramChatLink.chatId })
        .from(telegramChatLink)
        .where(eq(telegramChatLink.workspaceId, ctx.workspaceId))
        .orderBy(desc(telegramChatLink.lastInboundAt))
        .limit(1);
      if (!link) throw new Error('no_linked_telegram_chat');
      chatId = link.chatId;
    } else {
      // Verify caller-supplied chatId is actually linked to this workspace
      // — never let the LLM send to an arbitrary chat id.
      const [link] = await db
        .select({ chatId: telegramChatLink.chatId })
        .from(telegramChatLink)
        .where(
          and(
            eq(telegramChatLink.workspaceId, ctx.workspaceId),
            eq(telegramChatLink.chatId, chatId),
          ),
        )
        .limit(1);
      if (!link) throw new Error('chat_not_linked_to_workspace');
    }
    const messageId = await sendTelegramText(chatId, args.text, {
      parseMode: args.parseMode,
      disableNotification: args.silent,
    });
    return {
      result: { chatId, messageId },
      // Telegram does support deleteMessage; we keep the data so a future
      // undo can be wired in if needed. Marked here for traceability.
      undoPayload: { chatId, messageId },
    };
  },
};

// ─── send_email ────────────────────────────────────────────────────────────

const sendEmailArgs = z.object({
  to: z.email().describe('Recipient email address.'),
  subject: z.string().min(1).max(200),
  text: z.string().min(1).max(10000).describe('Plain-text body.'),
  html: z.string().max(50000).optional().describe('Optional HTML body.'),
});

async function sendViaResend(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<{ id: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY not configured');
  const from = process.env.RESEND_FROM ?? 'metu <hello@metu.app>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      ...(input.html ? { html: input.html } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`resend ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return { id: data.id ?? '' };
}

const sendEmailTool: ToolDefinition<typeof sendEmailArgs> = {
  name: 'send_email',
  description:
    'Send an email via Resend. High-risk — default ACL is `ask`. Use sparingly: only when the user has asked for an email or the action is part of an approved workflow.',
  kind: 'high_risk',
  args: sendEmailArgs,
  async execute(args) {
    const sent = await sendViaResend({
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
    });
    return { result: { providerId: sent.id, to: args.to } };
  },
};

// ─── set_task_status ───────────────────────────────────────────────────────

const setTaskStatusArgs = z.object({
  taskId: z.string().uuid(),
  status: z.enum(['inbox', 'next', 'doing', 'blocked', 'done', 'dropped']),
  blockedReason: z.string().max(400).optional(),
});

const setTaskStatusTool: ToolDefinition<typeof setTaskStatusArgs> = {
  name: 'set_task_status',
  description:
    'Move a task to a different status (inbox/next/doing/blocked/done/dropped). When marking blocked, supply blockedReason. Setting done timestamps completedAt; clearing it later restores nulls. Reversible via undo.',
  kind: 'low_risk',
  args: setTaskStatusArgs,
  async execute(args, ctx) {
    const db = getDb();
    const [before] = await db
      .select({
        id: task.id,
        status: task.status,
        blockedReason: task.blockedReason,
        completedAt: task.completedAt,
      })
      .from(task)
      .where(and(eq(task.id, args.taskId), eq(task.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!before) throw new Error('task_not_found');
    const completedAt = args.status === 'done' ? new Date() : null;
    await db
      .update(task)
      .set({
        status: args.status,
        blockedReason: args.status === 'blocked' ? (args.blockedReason ?? null) : null,
        completedAt,
      })
      .where(and(eq(task.id, args.taskId), eq(task.workspaceId, ctx.workspaceId)));
    return {
      result: { taskId: args.taskId, status: args.status },
      undoPayload: {
        taskId: args.taskId,
        previousStatus: before.status,
        previousBlockedReason: before.blockedReason,
        previousCompletedAt: before.completedAt?.toISOString() ?? null,
      },
    };
  },
  async undo(payload, ctx) {
    const db = getDb();
    await db
      .update(task)
      .set({
        status: payload.previousStatus as
          | 'inbox'
          | 'next'
          | 'doing'
          | 'blocked'
          | 'done'
          | 'dropped',
        blockedReason: (payload.previousBlockedReason as string | null) ?? null,
        completedAt: payload.previousCompletedAt
          ? new Date(String(payload.previousCompletedAt))
          : null,
      })
      .where(and(eq(task.id, String(payload.taskId)), eq(task.workspaceId, ctx.workspaceId)));
  },
};

// ─── move_task ─────────────────────────────────────────────────────────────

const moveTaskArgs = z.object({
  taskId: z.string().uuid(),
  projectId: z.string().uuid().nullable().describe('Target project, or null to detach.'),
});

const moveTaskTool: ToolDefinition<typeof moveTaskArgs> = {
  name: 'move_task',
  description:
    'Move a task to a different project (or detach with projectId=null). Workspace-scoped — both task and target project must belong to the active workspace. Reversible via undo.',
  kind: 'low_risk',
  args: moveTaskArgs,
  async execute(args, ctx) {
    const db = getDb();
    const [before] = await db
      .select({ id: task.id, projectId: task.projectId })
      .from(task)
      .where(and(eq(task.id, args.taskId), eq(task.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!before) throw new Error('task_not_found');
    if (args.projectId) {
      const [proj] = await db
        .select({ id: project.id })
        .from(project)
        .where(and(eq(project.id, args.projectId), eq(project.workspaceId, ctx.workspaceId)))
        .limit(1);
      if (!proj) throw new Error('project_not_found');
    }
    await db
      .update(task)
      .set({ projectId: args.projectId })
      .where(and(eq(task.id, args.taskId), eq(task.workspaceId, ctx.workspaceId)));
    return {
      result: { taskId: args.taskId, projectId: args.projectId },
      undoPayload: { taskId: args.taskId, previousProjectId: before.projectId },
    };
  },
  async undo(payload, ctx) {
    const db = getDb();
    await db
      .update(task)
      .set({ projectId: (payload.previousProjectId as string | null) ?? null })
      .where(and(eq(task.id, String(payload.taskId)), eq(task.workspaceId, ctx.workspaceId)));
  },
};

// ─── set_task_due_date ─────────────────────────────────────────────────────

const setTaskDueDateArgs = z.object({
  taskId: z.string().uuid(),
  dueAt: z.string().datetime().nullable().describe('ISO timestamp, or null to clear.'),
});

const setTaskDueDateTool: ToolDefinition<typeof setTaskDueDateArgs> = {
  name: 'set_task_due_date',
  description:
    'Set or clear a task due date. Pass an ISO timestamp to schedule, or null to remove. Reversible via undo.',
  kind: 'low_risk',
  args: setTaskDueDateArgs,
  async execute(args, ctx) {
    const db = getDb();
    const [before] = await db
      .select({ id: task.id, dueAt: task.dueAt })
      .from(task)
      .where(and(eq(task.id, args.taskId), eq(task.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!before) throw new Error('task_not_found');
    const next = args.dueAt ? new Date(args.dueAt) : null;
    await db
      .update(task)
      .set({ dueAt: next })
      .where(and(eq(task.id, args.taskId), eq(task.workspaceId, ctx.workspaceId)));
    return {
      result: { taskId: args.taskId, dueAt: args.dueAt },
      undoPayload: { taskId: args.taskId, previousDueAt: before.dueAt?.toISOString() ?? null },
    };
  },
  async undo(payload, ctx) {
    const db = getDb();
    await db
      .update(task)
      .set({
        dueAt: payload.previousDueAt ? new Date(String(payload.previousDueAt)) : null,
      })
      .where(and(eq(task.id, String(payload.taskId)), eq(task.workspaceId, ctx.workspaceId)));
  },
};

// ─── link_capture_to_project ───────────────────────────────────────────────

const linkCaptureArgs = z.object({
  captureId: z.string().uuid(),
  projectId: z.string().uuid().nullable().describe('Target project, or null to detach.'),
});

const linkCaptureTool: ToolDefinition<typeof linkCaptureArgs> = {
  name: 'link_capture_to_project',
  description:
    'Re-tag a capture with a project (or detach). Useful when the conductor decides a brain-dump capture belongs to a specific project after the fact. Reversible via undo.',
  kind: 'low_risk',
  args: linkCaptureArgs,
  async execute(args, ctx) {
    const db = getDb();
    const [before] = await db
      .select({ id: capture.id, projectId: capture.projectId })
      .from(capture)
      .where(and(eq(capture.id, args.captureId), eq(capture.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!before) throw new Error('capture_not_found');
    if (args.projectId) {
      const [proj] = await db
        .select({ id: project.id })
        .from(project)
        .where(and(eq(project.id, args.projectId), eq(project.workspaceId, ctx.workspaceId)))
        .limit(1);
      if (!proj) throw new Error('project_not_found');
    }
    await db
      .update(capture)
      .set({ projectId: args.projectId })
      .where(and(eq(capture.id, args.captureId), eq(capture.workspaceId, ctx.workspaceId)));
    return {
      result: { captureId: args.captureId, projectId: args.projectId },
      undoPayload: { captureId: args.captureId, previousProjectId: before.projectId },
    };
  },
  async undo(payload, ctx) {
    const db = getDb();
    await db
      .update(capture)
      .set({ projectId: (payload.previousProjectId as string | null) ?? null })
      .where(
        and(eq(capture.id, String(payload.captureId)), eq(capture.workspaceId, ctx.workspaceId)),
      );
  },
};

// ─── snooze_task ───────────────────────────────────────────────────────────

const snoozeTaskArgs = z.object({
  taskId: z.string().uuid(),
  until: z
    .string()
    .datetime()
    .describe('ISO timestamp to wake up at — sets dueAt and moves to inbox.'),
});

const snoozeTaskTool: ToolDefinition<typeof snoozeTaskArgs> = {
  name: 'snooze_task',
  description:
    'Snooze a task: move it back to inbox and set its dueAt to the supplied wake-up time. Use to defer work without losing it.',
  kind: 'low_risk',
  args: snoozeTaskArgs,
  async execute(args, ctx) {
    const db = getDb();
    const [before] = await db
      .select({
        id: task.id,
        status: task.status,
        dueAt: task.dueAt,
      })
      .from(task)
      .where(and(eq(task.id, args.taskId), eq(task.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!before) throw new Error('task_not_found');
    await db
      .update(task)
      .set({ status: 'inbox', dueAt: new Date(args.until) })
      .where(and(eq(task.id, args.taskId), eq(task.workspaceId, ctx.workspaceId)));
    return {
      result: { taskId: args.taskId, until: args.until },
      undoPayload: {
        taskId: args.taskId,
        previousStatus: before.status,
        previousDueAt: before.dueAt?.toISOString() ?? null,
      },
    };
  },
  async undo(payload, ctx) {
    const db = getDb();
    await db
      .update(task)
      .set({
        status: payload.previousStatus as
          | 'inbox'
          | 'next'
          | 'doing'
          | 'blocked'
          | 'done'
          | 'dropped',
        dueAt: payload.previousDueAt ? new Date(String(payload.previousDueAt)) : null,
      })
      .where(and(eq(task.id, String(payload.taskId)), eq(task.workspaceId, ctx.workspaceId)));
  },
};

// ─── archive_project ───────────────────────────────────────────────────────

const archiveProjectArgs = z.object({
  projectId: z.string().uuid(),
});

const archiveProjectTool: ToolDefinition<typeof archiveProjectArgs> = {
  name: 'archive_project',
  description:
    'Archive a project (flips status to "archived"). Reversible via undo. The user can still see archived projects under the "Archived" filter.',
  kind: 'high_risk',
  args: archiveProjectArgs,
  async execute(args, ctx) {
    const db = getDb();
    const [before] = await db
      .select({ id: project.id, status: project.status })
      .from(project)
      .where(and(eq(project.id, args.projectId), eq(project.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!before) throw new Error('project_not_found');
    if (before.status === 'archived') {
      return { result: { changed: false }, undoPayload: null };
    }
    await db
      .update(project)
      .set({ status: 'archived' })
      .where(and(eq(project.id, args.projectId), eq(project.workspaceId, ctx.workspaceId)));
    return {
      result: { changed: true, previousStatus: before.status },
      undoPayload: { projectId: args.projectId, previousStatus: before.status },
    };
  },
  async undo(payload, ctx) {
    const db = getDb();
    const prev =
      (payload.previousStatus as 'active' | 'paused' | 'archived' | 'killed') ?? 'active';
    await db
      .update(project)
      .set({ status: prev })
      .where(
        and(eq(project.id, String(payload.projectId)), eq(project.workspaceId, ctx.workspaceId)),
      );
  },
};

// ─── delete_capture ────────────────────────────────────────────────────────

const deleteCaptureArgs = z.object({
  captureId: z.string().uuid(),
});

const deleteCaptureTool: ToolDefinition<typeof deleteCaptureArgs> = {
  name: 'delete_capture',
  description:
    'Soft-delete a capture (sets deleted_at). The capture stops appearing in the inbox and recall. Reversible via undo.',
  kind: 'high_risk',
  args: deleteCaptureArgs,
  async execute(args, ctx) {
    const db = getDb();
    const [before] = await db
      .select({ id: capture.id, deletedAt: capture.deletedAt })
      .from(capture)
      .where(and(eq(capture.id, args.captureId), eq(capture.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!before) throw new Error('capture_not_found');
    if (before.deletedAt) {
      return { result: { changed: false }, undoPayload: null };
    }
    await db
      .update(capture)
      .set({ deletedAt: new Date() })
      .where(and(eq(capture.id, args.captureId), eq(capture.workspaceId, ctx.workspaceId)));
    return {
      result: { changed: true },
      undoPayload: { captureId: args.captureId },
    };
  },
  async undo(payload, ctx) {
    const db = getDb();
    await db
      .update(capture)
      .set({ deletedAt: null })
      .where(
        and(eq(capture.id, String(payload.captureId)), eq(capture.workspaceId, ctx.workspaceId)),
      );
  },
};

// ─── merge_pr ──────────────────────────────────────────────────────────────

const mergePrArgs = z.object({
  integrationId: z
    .string()
    .uuid()
    .describe('UUID of the active GitHub integration in this workspace.'),
  repoFullName: z.string().regex(/^[^/]+\/[^/]+$/, 'expected "owner/repo"'),
  prNumber: z.number().int().positive(),
  mergeMethod: z.enum(['merge', 'squash', 'rebase']).default('squash'),
  commitTitle: z.string().max(200).optional(),
  commitMessage: z.string().max(4000).optional(),
});

async function resolveGithubToken(workspaceId: string, integrationId: string): Promise<string> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(integration)
    .where(
      and(
        eq(integration.id, integrationId),
        eq(integration.workspaceId, workspaceId),
        eq(integration.kind, 'github'),
      ),
    )
    .limit(1);
  if (!row) throw new Error('integration_not_found');
  if (row.status !== 'active') throw new Error(`integration_${row.status}`);
  if (!row.tokenCiphertext || !row.tokenIv) throw new Error('no_token');
  const tokenTag = (row.config as { tokenTag?: string })?.tokenTag;
  if (!tokenTag) throw new Error('token_tag_missing');
  return openSealed({
    ciphertext: row.tokenCiphertext,
    iv: row.tokenIv,
    tag: tokenTag,
  });
}

const mergePrTool: ToolDefinition<typeof mergePrArgs> = {
  name: 'merge_pr',
  description:
    'Merge a GitHub pull request. High-risk and irreversible — default ACL is `ask`. The default merge method is squash; pass mergeMethod to override.',
  kind: 'high_risk',
  args: mergePrArgs,
  async execute(args, ctx) {
    const token = await resolveGithubToken(ctx.workspaceId, args.integrationId);
    const [owner, repo] = args.repoFullName.split('/') as [string, string];
    const o = octokitForToken(token);
    const res = await o.rest.pulls.merge({
      owner,
      repo,
      pull_number: args.prNumber,
      merge_method: args.mergeMethod,
      commit_title: args.commitTitle,
      commit_message: args.commitMessage,
    });
    return {
      result: { merged: res.data.merged, sha: res.data.sha, message: res.data.message },
    };
  },
};

// ─── commit_file ───────────────────────────────────────────────────────────

const commitFileArgs = z.object({
  integrationId: z.string().uuid(),
  repoFullName: z.string().regex(/^[^/]+\/[^/]+$/, 'expected "owner/repo"'),
  path: z.string().min(1).max(500).describe('Path inside the repo, e.g. "docs/notes.md".'),
  content: z
    .string()
    .max(200_000)
    .describe('Full new file content (plain text, will be base64-encoded).'),
  message: z.string().min(1).max(500),
  branch: z.string().min(1).max(200).optional(),
});

const commitFileTool: ToolDefinition<typeof commitFileArgs> = {
  name: 'commit_file',
  description:
    'Create or overwrite a file in a GitHub repo by committing directly via the contents API. High-risk and effectively irreversible — default ACL is `ask`. Pass branch to target a non-default branch.',
  kind: 'high_risk',
  args: commitFileArgs,
  async execute(args, ctx) {
    const token = await resolveGithubToken(ctx.workspaceId, args.integrationId);
    const [owner, repo] = args.repoFullName.split('/') as [string, string];
    const o = octokitForToken(token);

    let existingSha: string | undefined;
    try {
      const got = await o.rest.repos.getContent({
        owner,
        repo,
        path: args.path,
        ...(args.branch ? { ref: args.branch } : {}),
      });
      const data = got.data as { sha?: string } | Array<unknown>;
      if (!Array.isArray(data) && data.sha) existingSha = data.sha;
    } catch {
      // 404 = file does not exist yet, that's fine
    }

    const res = await o.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: args.path,
      message: args.message,
      content: Buffer.from(args.content, 'utf8').toString('base64'),
      ...(existingSha ? { sha: existingSha } : {}),
      ...(args.branch ? { branch: args.branch } : {}),
    });
    return {
      result: {
        commitSha: res.data.commit.sha,
        contentSha: res.data.content?.sha,
        previousSha: existingSha ?? null,
      },
    };
  },
};

// ─── github_draft_pr ───────────────────────────────────────────────────────

const githubDraftPrArgs = z.object({
  integrationId: z.string().uuid(),
  repoFullName: z.string().regex(/^[^/]+\/[^/]+$/, 'expected "owner/repo"'),
  title: z.string().min(2).max(200),
  body: z.string().max(8000).optional(),
  head: z.string().min(1).max(200).describe('Source branch (e.g. "feat/foo").'),
  base: z.string().min(1).max(200).default('main').describe('Target branch.'),
});

const githubDraftPrTool: ToolDefinition<typeof githubDraftPrArgs> = {
  name: 'github_draft_pr',
  description:
    'Open a draft pull request on GitHub. Useful when the user wraps up work on a branch — Conductor proposes the title/body and the user approves. Default ACL is `ask`.',
  kind: 'high_risk',
  args: githubDraftPrArgs,
  async execute(args, ctx) {
    const token = await resolveGithubToken(ctx.workspaceId, args.integrationId);
    const [owner, repo] = args.repoFullName.split('/') as [string, string];
    const o = octokitForToken(token);
    const res = await o.rest.pulls.create({
      owner,
      repo,
      title: args.title,
      body: args.body,
      head: args.head,
      base: args.base,
      draft: true,
    });
    return {
      result: {
        number: res.data.number,
        url: res.data.html_url,
        state: res.data.state,
      },
    };
  },
};

// ─── linear_add_comment ────────────────────────────────────────────────────

const linearAddCommentArgs = z.object({
  integrationId: z.string().uuid(),
  issueId: z.string().min(1).describe('Linear issue id (UUID) or identifier (e.g. "ENG-123").'),
  body: z.string().min(1).max(8000),
});

async function resolveLinearToken(workspaceId: string, integrationId: string): Promise<string> {
  return resolveIntegrationToken(workspaceId, integrationId, 'linear');
}

async function resolveIntegrationToken(
  workspaceId: string,
  integrationId: string,
  kind: 'slack' | 'linear' | 'gcal' | 'github' | 'notion',
): Promise<string> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(integration)
    .where(
      and(
        eq(integration.id, integrationId),
        eq(integration.workspaceId, workspaceId),
        eq(integration.kind, kind),
      ),
    )
    .limit(1);
  if (!row) throw new Error('integration_not_found');
  if (row.status !== 'active') throw new Error(`integration_${row.status}`);
  if (!row.tokenCiphertext || !row.tokenIv) throw new Error('no_token');
  const tokenTag = (row.config as { tokenTag?: string })?.tokenTag;
  if (!tokenTag) throw new Error('token_tag_missing');
  return openSealed({
    ciphertext: row.tokenCiphertext,
    iv: row.tokenIv,
    tag: tokenTag,
  });
}

const linearAddCommentTool: ToolDefinition<typeof linearAddCommentArgs> = {
  name: 'linear_add_comment',
  description:
    'Add a comment to a Linear issue via GraphQL. Body is plain markdown. Default ACL is `ask`.',
  kind: 'high_risk',
  args: linearAddCommentArgs,
  async execute(args, ctx) {
    const token = await resolveLinearToken(ctx.workspaceId, args.integrationId);
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: token,
      },
      body: JSON.stringify({
        query: `mutation($issueId: String!, $body: String!) {
          commentCreate(input: { issueId: $issueId, body: $body }) {
            success
            comment { id url }
          }
        }`,
        variables: { issueId: args.issueId, body: args.body },
      }),
    });
    if (!res.ok) throw new Error(`linear_http_${res.status}`);
    const json = (await res.json()) as {
      data?: { commentCreate?: { success: boolean; comment?: { id: string; url: string } } };
      errors?: Array<{ message: string }>;
    };
    if (json.errors?.length) throw new Error(json.errors[0]!.message);
    const cc = json.data?.commentCreate;
    if (!cc?.success || !cc.comment) throw new Error('linear_comment_failed');
    return { result: { commentId: cc.comment.id, url: cc.comment.url } };
  },
};

// ─── slack_send_message ────────────────────────────────────────────────────

const slackSendMessageArgs = z.object({
  integrationId: z.string().uuid(),
  channel: z
    .string()
    .min(1)
    .max(120)
    .describe('Slack channel id (e.g. "C0123456") or DM user id ("U0123…").'),
  text: z.string().min(1).max(4000),
  threadTs: z.string().optional().describe('If set, posts as a threaded reply to this parent ts.'),
});

const slackSendMessageTool: ToolDefinition<typeof slackSendMessageArgs> = {
  name: 'slack_send_message',
  description:
    'Post a message to a Slack channel or DM as the connected user. Default ACL is `ask`.',
  kind: 'high_risk',
  args: slackSendMessageArgs,
  async execute(args, ctx) {
    const token = await resolveIntegrationToken(ctx.workspaceId, args.integrationId, 'slack');
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        channel: args.channel,
        text: args.text,
        ...(args.threadTs ? { thread_ts: args.threadTs } : {}),
      }),
    });
    const json = (await res.json()) as { ok?: boolean; ts?: string; error?: string };
    if (!json.ok) throw new Error(json.error ?? `slack_http_${res.status}`);
    return { result: { ts: json.ts ?? null, channel: args.channel } };
  },
};

// ─── gcal_create_event ─────────────────────────────────────────────────────

const gcalCreateEventArgs = z.object({
  integrationId: z.string().uuid(),
  calendarId: z.string().default('primary'),
  summary: z.string().min(1).max(200),
  description: z.string().max(8000).optional(),
  startIso: z.string().describe('ISO 8601 datetime, e.g. "2026-05-08T14:00:00+02:00".'),
  endIso: z.string().describe('ISO 8601 datetime — must be after startIso.'),
  attendees: z.array(z.string().email()).max(50).optional(),
  location: z.string().max(200).optional(),
});

const gcalCreateEventTool: ToolDefinition<typeof gcalCreateEventArgs> = {
  name: 'gcal_create_event',
  description:
    "Create a Google Calendar event on the user's calendar. Default ACL is `ask`. The token must have the calendar.events scope.",
  kind: 'high_risk',
  args: gcalCreateEventArgs,
  async execute(args, ctx) {
    const token = await resolveIntegrationToken(ctx.workspaceId, args.integrationId, 'gcal');
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(args.calendarId)}/events`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        summary: args.summary,
        description: args.description,
        location: args.location,
        start: { dateTime: args.startIso },
        end: { dateTime: args.endIso },
        attendees: args.attendees?.map((email) => ({ email })),
      }),
    });
    const json = (await res.json()) as {
      id?: string;
      htmlLink?: string;
      error?: { message?: string };
    };
    if (!res.ok) throw new Error(json.error?.message ?? `gcal_http_${res.status}`);
    return { result: { id: json.id ?? null, url: json.htmlLink ?? null } };
  },
};

// ─── github_add_comment ────────────────────────────────────────────────────

const githubAddCommentArgs = z.object({
  integrationId: z.string().uuid(),
  repoFullName: z.string().regex(/^[^/]+\/[^/]+$/, 'expected "owner/repo"'),
  issueNumber: z.number().int().positive().describe('Issue OR pull-request number.'),
  body: z.string().min(1).max(60_000),
});

const githubAddCommentTool: ToolDefinition<typeof githubAddCommentArgs> = {
  name: 'github_add_comment',
  description:
    'Post a comment on a GitHub issue or pull request as the connected user. Default ACL is `ask`.',
  kind: 'high_risk',
  args: githubAddCommentArgs,
  async execute(args, ctx) {
    const token = await resolveGithubToken(ctx.workspaceId, args.integrationId);
    const [owner, repo] = args.repoFullName.split('/') as [string, string];
    const o = octokitForToken(token);
    const res = await o.rest.issues.createComment({
      owner,
      repo,
      issue_number: args.issueNumber,
      body: args.body,
    });
    return {
      result: { id: res.data.id, url: res.data.html_url },
    };
  },
};

// ─── github_pr_review_comment ──────────────────────────────────────────────

const githubPrReviewCommentArgs = z.object({
  integrationId: z.string().uuid(),
  repoFullName: z.string().regex(/^[^/]+\/[^/]+$/, 'expected "owner/repo"'),
  pullNumber: z.number().int().positive(),
  body: z.string().min(1).max(60_000),
  event: z
    .enum(['COMMENT', 'APPROVE', 'REQUEST_CHANGES'])
    .default('COMMENT')
    .describe('GitHub review event — APPROVE/REQUEST_CHANGES require non-empty body.'),
});

const githubPrReviewCommentTool: ToolDefinition<typeof githubPrReviewCommentArgs> = {
  name: 'github_pr_review_comment',
  description:
    'Submit a PR-level review on a GitHub pull request. Use COMMENT for plain remarks, APPROVE/REQUEST_CHANGES for blocking decisions. Default ACL is `ask`.',
  kind: 'high_risk',
  args: githubPrReviewCommentArgs,
  async execute(args, ctx) {
    const token = await resolveGithubToken(ctx.workspaceId, args.integrationId);
    const [owner, repo] = args.repoFullName.split('/') as [string, string];
    const o = octokitForToken(token);
    const res = await o.rest.pulls.createReview({
      owner,
      repo,
      pull_number: args.pullNumber,
      body: args.body,
      event: args.event,
    });
    return { result: { id: res.data.id, url: res.data.html_url } };
  },
};

// ─── notion_append_block ───────────────────────────────────────────────────

const notionAppendBlockArgs = z.object({
  integrationId: z.string().uuid(),
  pageId: z.string().min(20).describe('Notion page id (32-char hyphenated UUID or compact form).'),
  text: z.string().min(1).max(2000),
  blockType: z.enum(['paragraph', 'bulleted_list_item', 'to_do', 'heading_3']).default('paragraph'),
});

const notionAppendBlockTool: ToolDefinition<typeof notionAppendBlockArgs> = {
  name: 'notion_append_block',
  description:
    'Append a single block of text to a Notion page. Default ACL is `ask`. The token must have edit access to the page.',
  kind: 'high_risk',
  args: notionAppendBlockArgs,
  async execute(args, ctx) {
    const token = await resolveIntegrationToken(ctx.workspaceId, args.integrationId, 'notion');
    const richText = [{ type: 'text', text: { content: args.text } }];
    const block: Record<string, unknown> =
      args.blockType === 'to_do'
        ? { object: 'block', type: 'to_do', to_do: { rich_text: richText, checked: false } }
        : { object: 'block', type: args.blockType, [args.blockType]: { rich_text: richText } };
    const res = await fetch(
      `https://api.notion.com/v1/blocks/${encodeURIComponent(args.pageId)}/children`,
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${token}`,
          'notion-version': '2022-06-28',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ children: [block] }),
      },
    );
    const json = (await res.json()) as {
      results?: Array<{ id?: string }>;
      message?: string;
    };
    if (!res.ok) throw new Error(json.message ?? `notion_http_${res.status}`);
    return {
      result: { blockId: json.results?.[0]?.id ?? null, pageId: args.pageId },
    };
  },
};

// ─── linear_move_issue ─────────────────────────────────────────────────────

const linearMoveIssueArgs = z.object({
  integrationId: z.string().uuid(),
  issueId: z.string().min(1),
  stateId: z
    .string()
    .min(1)
    .describe('Linear workflow-state id to move the issue into (e.g. "Done", "In Review").'),
});

const linearMoveIssueTool: ToolDefinition<typeof linearMoveIssueArgs> = {
  name: 'linear_move_issue',
  description:
    'Move a Linear issue to a different workflow state by stateId. Default ACL is `ask`.',
  kind: 'high_risk',
  args: linearMoveIssueArgs,
  async execute(args, ctx) {
    const token = await resolveLinearToken(ctx.workspaceId, args.integrationId);
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: token,
      },
      body: JSON.stringify({
        query: `mutation($id: String!, $stateId: String!) {
          issueUpdate(id: $id, input: { stateId: $stateId }) {
            success
            issue { id identifier state { id name } }
          }
        }`,
        variables: { id: args.issueId, stateId: args.stateId },
      }),
    });
    if (!res.ok) throw new Error(`linear_http_${res.status}`);
    const json = (await res.json()) as {
      data?: {
        issueUpdate?: {
          success: boolean;
          issue?: { id: string; identifier: string; state?: { id: string; name: string } };
        };
      };
      errors?: Array<{ message: string }>;
    };
    if (json.errors?.length) throw new Error(json.errors[0]!.message);
    const iu = json.data?.issueUpdate;
    if (!iu?.success || !iu.issue) throw new Error('linear_move_failed');
    return {
      result: {
        issueId: iu.issue.id,
        identifier: iu.issue.identifier,
        state: iu.issue.state?.name ?? null,
      },
    };
  },
};

// ─── github_merge_pr ───────────────────────────────────────────────────────

const githubMergePrArgs = z.object({
  integrationId: z.string().uuid(),
  repoFullName: z.string().regex(/^[^/]+\/[^/]+$/, 'expected "owner/repo"'),
  pullNumber: z.number().int().positive(),
  mergeMethod: z.enum(['merge', 'squash', 'rebase']).default('squash'),
  commitTitle: z.string().max(256).optional(),
  commitMessage: z.string().max(4000).optional(),
});

const githubMergePrTool: ToolDefinition<typeof githubMergePrArgs> = {
  name: 'github_merge_pr',
  description:
    'Merge a GitHub pull request. Refuses if the PR is not mergeable. Default ACL is `ask`.',
  kind: 'high_risk',
  args: githubMergePrArgs,
  async execute(args, ctx) {
    const token = await resolveGithubToken(ctx.workspaceId, args.integrationId);
    const [owner, repo] = args.repoFullName.split('/') as [string, string];
    const o = octokitForToken(token);
    const res = await o.rest.pulls.merge({
      owner,
      repo,
      pull_number: args.pullNumber,
      merge_method: args.mergeMethod,
      ...(args.commitTitle ? { commit_title: args.commitTitle } : {}),
      ...(args.commitMessage ? { commit_message: args.commitMessage } : {}),
    });
    return {
      result: { sha: res.data.sha, merged: res.data.merged, message: res.data.message },
    };
  },
};

// ─── slack_add_reaction ────────────────────────────────────────────────────

const slackAddReactionArgs = z.object({
  integrationId: z.string().uuid(),
  channel: z.string().min(1).max(120),
  timestamp: z.string().describe('Slack message ts (e.g. "1715123456.000200").'),
  name: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9_+-]+$/, 'lowercase letters, digits, _, +, - only')
    .describe('Emoji name without colons (e.g. "thumbsup", "white_check_mark").'),
});

const slackAddReactionTool: ToolDefinition<typeof slackAddReactionArgs> = {
  name: 'slack_add_reaction',
  description:
    'React to a Slack message with an emoji. Default ACL is `ask`. Idempotent server-side (Slack returns already_reacted).',
  kind: 'high_risk',
  args: slackAddReactionArgs,
  async execute(args, ctx) {
    const token = await resolveIntegrationToken(ctx.workspaceId, args.integrationId, 'slack');
    const res = await fetch('https://slack.com/api/reactions.add', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        channel: args.channel,
        timestamp: args.timestamp,
        name: args.name,
      }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (!json.ok && json.error !== 'already_reacted') {
      throw new Error(json.error ?? `slack_http_${res.status}`);
    }
    return { result: { ok: true, alreadyReacted: json.error === 'already_reacted' } };
  },
};

// ─── slack_pin_message ────────────────────────────────────────────────────

const slackPinMessageArgs = z.object({
  integrationId: z.string().uuid(),
  channel: z.string().min(1).max(120),
  timestamp: z.string().describe('Slack message ts (e.g. "1715123456.000200").'),
});

const slackPinMessageTool: ToolDefinition<typeof slackPinMessageArgs> = {
  name: 'slack_pin_message',
  description:
    'Pin a Slack message to its channel. Default ACL is `ask`. Idempotent (already_pinned is treated as success).',
  kind: 'high_risk',
  args: slackPinMessageArgs,
  async execute(args, ctx) {
    const token = await resolveIntegrationToken(ctx.workspaceId, args.integrationId, 'slack');
    const res = await fetch('https://slack.com/api/pins.add', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ channel: args.channel, timestamp: args.timestamp }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (!json.ok && json.error !== 'already_pinned') {
      throw new Error(json.error ?? `slack_http_${res.status}`);
    }
    return { result: { ok: true, alreadyPinned: json.error === 'already_pinned' } };
  },
};

// ─── notion_create_page ────────────────────────────────────────────────────

const notionCreatePageArgs = z.object({
  integrationId: z.string().uuid(),
  parentPageId: z.string().min(1).describe('Parent page id (UUID-like, with or without dashes).'),
  title: z.string().min(1).max(2000),
  bodyMarkdown: z
    .string()
    .max(20000)
    .optional()
    .describe('Optional plain text body added as a single paragraph block.'),
});

const notionCreatePageTool: ToolDefinition<typeof notionCreatePageArgs> = {
  name: 'notion_create_page',
  description: 'Create a new Notion child page under a parent page. Default ACL is `ask`.',
  kind: 'high_risk',
  args: notionCreatePageArgs,
  async execute(args, ctx) {
    const token = await resolveIntegrationToken(ctx.workspaceId, args.integrationId, 'notion');
    const children = args.bodyMarkdown
      ? [
          {
            object: 'block',
            type: 'paragraph',
            paragraph: { rich_text: [{ type: 'text', text: { content: args.bodyMarkdown } }] },
          },
        ]
      : [];
    const res = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'notion-version': '2022-06-28',
      },
      body: JSON.stringify({
        parent: { page_id: args.parentPageId },
        properties: {
          title: { title: [{ type: 'text', text: { content: args.title } }] },
        },
        children,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`notion_http_${res.status}: ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as { id?: string; url?: string };
    return { result: { pageId: json.id, url: json.url } };
  },
};

// ─── github_close_issue ───────────────────────────────────────────────────

const githubCloseIssueArgs = z.object({
  integrationId: z.string().uuid(),
  repoFullName: z.string().regex(/^[^/]+\/[^/]+$/, 'expected "owner/repo"'),
  issueNumber: z.number().int().positive(),
  reason: z.enum(['completed', 'not_planned']).default('completed'),
});

const githubCloseIssueTool: ToolDefinition<typeof githubCloseIssueArgs> = {
  name: 'github_close_issue',
  description: 'Close a GitHub issue. Default ACL is `ask`.',
  kind: 'high_risk',
  args: githubCloseIssueArgs,
  async execute(args, ctx) {
    const token = await resolveGithubToken(ctx.workspaceId, args.integrationId);
    const [owner, repo] = args.repoFullName.split('/') as [string, string];
    const o = octokitForToken(token);
    const res = await o.rest.issues.update({
      owner,
      repo,
      issue_number: args.issueNumber,
      state: 'closed',
      state_reason: args.reason,
    });
    return { result: { number: res.data.number, state: res.data.state, url: res.data.html_url } };
  },
};

// ─── github_create_issue ──────────────────────────────────────────────────

const githubCreateIssueArgs = z.object({
  integrationId: z.string().uuid(),
  repoFullName: z.string().regex(/^[^/]+\/[^/]+$/, 'expected "owner/repo"'),
  title: z.string().min(1).max(256),
  body: z.string().max(64000).optional(),
  labels: z.array(z.string().min(1).max(50)).max(20).optional(),
});

const githubCreateIssueTool: ToolDefinition<typeof githubCreateIssueArgs> = {
  name: 'github_create_issue',
  description: 'Open a new GitHub issue. Default ACL is `ask`.',
  kind: 'high_risk',
  args: githubCreateIssueArgs,
  async execute(args, ctx) {
    const token = await resolveGithubToken(ctx.workspaceId, args.integrationId);
    const [owner, repo] = args.repoFullName.split('/') as [string, string];
    const o = octokitForToken(token);
    const res = await o.rest.issues.create({
      owner,
      repo,
      title: args.title,
      ...(args.body ? { body: args.body } : {}),
      ...(args.labels ? { labels: args.labels } : {}),
    });
    return {
      result: { number: res.data.number, url: res.data.html_url, state: res.data.state },
    };
  },
};

// ─── linear_create_issue ──────────────────────────────────────────────────

const linearCreateIssueArgs = z.object({
  integrationId: z.string().uuid(),
  teamId: z.string().min(1).describe('Linear team id (UUID).'),
  title: z.string().min(1).max(255),
  description: z.string().max(60_000).optional(),
  priority: z
    .number()
    .int()
    .min(0)
    .max(4)
    .optional()
    .describe('0=none, 1=urgent, 2=high, 3=normal, 4=low.'),
  assigneeId: z.string().min(1).optional(),
});

const linearCreateIssueTool: ToolDefinition<typeof linearCreateIssueArgs> = {
  name: 'linear_create_issue',
  description: 'Create a new Linear issue in a team. Default ACL is `ask`.',
  kind: 'high_risk',
  args: linearCreateIssueArgs,
  async execute(args, ctx) {
    const token = await resolveLinearToken(ctx.workspaceId, args.integrationId);
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: token },
      body: JSON.stringify({
        query: `mutation($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            success
            issue { id identifier url title }
          }
        }`,
        variables: {
          input: {
            teamId: args.teamId,
            title: args.title,
            ...(args.description ? { description: args.description } : {}),
            ...(args.priority !== undefined ? { priority: args.priority } : {}),
            ...(args.assigneeId ? { assigneeId: args.assigneeId } : {}),
          },
        },
      }),
    });
    if (!res.ok) throw new Error(`linear_http_${res.status}`);
    const json = (await res.json()) as {
      data?: {
        issueCreate?: {
          success: boolean;
          issue?: { id: string; identifier: string; url: string; title: string };
        };
      };
      errors?: Array<{ message: string }>;
    };
    if (json.errors?.length) throw new Error(json.errors[0]!.message);
    const ic = json.data?.issueCreate;
    if (!ic?.success || !ic.issue) throw new Error('linear_create_failed');
    return {
      result: { issueId: ic.issue.id, identifier: ic.issue.identifier, url: ic.issue.url },
    };
  },
};

// ─── gcal_update_event ────────────────────────────────────────────────────

const gcalUpdateEventArgs = z.object({
  integrationId: z.string().uuid(),
  calendarId: z.string().default('primary'),
  eventId: z.string().min(1),
  summary: z.string().min(1).max(200).optional(),
  description: z.string().max(8000).optional(),
  startIso: z.string().optional(),
  endIso: z.string().optional(),
  location: z.string().max(200).optional(),
});

const gcalUpdateEventTool: ToolDefinition<typeof gcalUpdateEventArgs> = {
  name: 'gcal_update_event',
  description:
    'Patch a Google Calendar event. Only the provided fields are changed. Default ACL is `ask`.',
  kind: 'high_risk',
  args: gcalUpdateEventArgs,
  async execute(args, ctx) {
    const token = await resolveIntegrationToken(ctx.workspaceId, args.integrationId, 'gcal');
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(args.calendarId)}/events/${encodeURIComponent(args.eventId)}`;
    const patch: Record<string, unknown> = {};
    if (args.summary !== undefined) patch.summary = args.summary;
    if (args.description !== undefined) patch.description = args.description;
    if (args.location !== undefined) patch.location = args.location;
    if (args.startIso) patch.start = { dateTime: args.startIso };
    if (args.endIso) patch.end = { dateTime: args.endIso };
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const json = (await res.json()) as {
      id?: string;
      htmlLink?: string;
      error?: { message?: string };
    };
    if (!res.ok) throw new Error(json.error?.message ?? `gcal_http_${res.status}`);
    return { result: { id: json.id ?? null, url: json.htmlLink ?? null } };
  },
};

// ─── github_request_review ────────────────────────────────────────────────

const githubRequestReviewArgs = z.object({
  integrationId: z.string().uuid(),
  repoFullName: z.string().regex(/^[^/]+\/[^/]+$/, 'expected "owner/repo"'),
  pullNumber: z.number().int().positive(),
  reviewers: z.array(z.string().min(1).max(100)).max(15).optional(),
  teamReviewers: z.array(z.string().min(1).max(100)).max(15).optional(),
});

const githubRequestReviewTool: ToolDefinition<typeof githubRequestReviewArgs> = {
  name: 'github_request_review',
  description:
    'Request reviewers (users and/or teams) on a GitHub pull request. Default ACL is `ask`.',
  kind: 'high_risk',
  args: githubRequestReviewArgs,
  async execute(args, ctx) {
    if (!args.reviewers?.length && !args.teamReviewers?.length) {
      throw new Error('reviewers or teamReviewers must include at least one entry');
    }
    const token = await resolveGithubToken(ctx.workspaceId, args.integrationId);
    const [owner, repo] = args.repoFullName.split('/') as [string, string];
    const o = octokitForToken(token);
    const res = await o.rest.pulls.requestReviewers({
      owner,
      repo,
      pull_number: args.pullNumber,
      ...(args.reviewers ? { reviewers: args.reviewers } : {}),
      ...(args.teamReviewers ? { team_reviewers: args.teamReviewers } : {}),
    });
    return { result: { number: res.data.number, url: res.data.html_url } };
  },
};

// ─── slack_update_message ─────────────────────────────────────────────────

const slackUpdateMessageArgs = z.object({
  integrationId: z.string().uuid(),
  channel: z.string().min(1).max(120),
  ts: z.string().min(1).describe('Timestamp ("ts") of the message to edit.'),
  text: z.string().min(1).max(4000),
});

const slackUpdateMessageTool: ToolDefinition<typeof slackUpdateMessageArgs> = {
  name: 'slack_update_message',
  description:
    'Edit the text of a Slack message previously posted by the connected user. Default ACL is `ask`.',
  kind: 'high_risk',
  args: slackUpdateMessageArgs,
  async execute(args, ctx) {
    const token = await resolveIntegrationToken(ctx.workspaceId, args.integrationId, 'slack');
    const res = await fetch('https://slack.com/api/chat.update', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ channel: args.channel, ts: args.ts, text: args.text }),
    });
    const json = (await res.json()) as { ok?: boolean; ts?: string; error?: string };
    if (!json.ok) throw new Error(json.error ?? `slack_http_${res.status}`);
    return { result: { ts: json.ts ?? args.ts, channel: args.channel } };
  },
};

// ─── notion_append_block_children ─────────────────────────────────────────

const notionAppendArgs = z.object({
  integrationId: z.string().uuid(),
  parentBlockId: z.string().min(1).describe('Notion page or block id to append under.'),
  paragraphs: z.array(z.string().min(1).max(2000)).min(1).max(20),
});

const notionAppendBlockChildrenTool: ToolDefinition<typeof notionAppendArgs> = {
  name: 'notion_append_block_children',
  description: 'Append paragraph blocks to a Notion page or block. Default ACL is `ask`.',
  kind: 'high_risk',
  args: notionAppendArgs,
  async execute(args, ctx) {
    const token = await resolveIntegrationToken(ctx.workspaceId, args.integrationId, 'notion');
    const url = `https://api.notion.com/v1/blocks/${encodeURIComponent(args.parentBlockId)}/children`;
    const children = args.paragraphs.map((text) => ({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: text } }] },
    }));
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'notion-version': '2022-06-28',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ children }),
    });
    const json = (await res.json()) as {
      results?: { id: string }[];
      message?: string;
      code?: string;
    };
    if (!res.ok) throw new Error(json.message ?? json.code ?? `notion_http_${res.status}`);
    return { result: { appended: json.results?.length ?? 0, parentBlockId: args.parentBlockId } };
  },
};

// ─── gcal_delete_event ────────────────────────────────────────────────────

const gcalDeleteEventArgs = z.object({
  integrationId: z.string().uuid(),
  calendarId: z.string().default('primary'),
  eventId: z.string().min(1),
});

const gcalDeleteEventTool: ToolDefinition<typeof gcalDeleteEventArgs> = {
  name: 'gcal_delete_event',
  description: 'Delete a Google Calendar event. Default ACL is `ask`.',
  kind: 'high_risk',
  args: gcalDeleteEventArgs,
  async execute(args, ctx) {
    const token = await resolveIntegrationToken(ctx.workspaceId, args.integrationId, 'gcal');
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(args.calendarId)}/events/${encodeURIComponent(args.eventId)}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 410) {
      const text = await res.text();
      throw new Error(`gcal_http_${res.status}: ${text.slice(0, 200)}`);
    }
    return { result: { deleted: true, eventId: args.eventId } };
  },
};

// ─── github_add_label ─────────────────────────────────────────────────────

const githubAddLabelArgs = z.object({
  integrationId: z.string().uuid(),
  repoFullName: z.string().regex(/^[^/]+\/[^/]+$/, 'expected "owner/repo"'),
  issueNumber: z.number().int().positive(),
  labels: z.array(z.string().min(1).max(50)).min(1).max(20),
});

const githubAddLabelTool: ToolDefinition<typeof githubAddLabelArgs> = {
  name: 'github_add_label',
  description: 'Add one or more labels to a GitHub issue or pull request. Default ACL is `ask`.',
  kind: 'high_risk',
  args: githubAddLabelArgs,
  async execute(args, ctx) {
    const token = await resolveGithubToken(ctx.workspaceId, args.integrationId);
    const [owner, repo] = args.repoFullName.split('/') as [string, string];
    const o = octokitForToken(token);
    const res = await o.rest.issues.addLabels({
      owner,
      repo,
      issue_number: args.issueNumber,
      labels: args.labels,
    });
    return {
      result: {
        number: args.issueNumber,
        labels: res.data.map((l) => (typeof l === 'string' ? l : (l.name ?? ''))),
      },
    };
  },
};

// ─── github_assign ────────────────────────────────────────────────────────

const githubAssignArgs = z.object({
  integrationId: z.string().uuid(),
  repoFullName: z.string().regex(/^[^/]+\/[^/]+$/, 'expected "owner/repo"'),
  issueNumber: z.number().int().positive(),
  assignees: z.array(z.string().min(1).max(50)).min(1).max(10),
});

const githubAssignTool: ToolDefinition<typeof githubAssignArgs> = {
  name: 'github_assign',
  description: 'Assign one or more users to a GitHub issue or pull request. Default ACL is `ask`.',
  kind: 'high_risk',
  args: githubAssignArgs,
  async execute(args, ctx) {
    const token = await resolveGithubToken(ctx.workspaceId, args.integrationId);
    const [owner, repo] = args.repoFullName.split('/') as [string, string];
    const o = octokitForToken(token);
    const res = await o.rest.issues.addAssignees({
      owner,
      repo,
      issue_number: args.issueNumber,
      assignees: args.assignees,
    });
    return {
      result: {
        number: args.issueNumber,
        assignees: res.data.assignees?.map((a) => a.login) ?? [],
      },
    };
  },
};

// ─── linear_set_priority ──────────────────────────────────────────────────

const linearSetPriorityArgs = z.object({
  integrationId: z.string().uuid(),
  issueId: z.string().min(1).describe('Linear issue UUID (NOT ENG-123 identifier).'),
  priority: z
    .number()
    .int()
    .min(0)
    .max(4)
    .describe('0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low.'),
});

const linearSetPriorityTool: ToolDefinition<typeof linearSetPriorityArgs> = {
  name: 'linear_set_priority',
  description: 'Set the priority of a Linear issue. Default ACL is `ask`.',
  kind: 'high_risk',
  args: linearSetPriorityArgs,
  async execute(args, ctx) {
    const token = await resolveLinearToken(ctx.workspaceId, args.integrationId);
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { authorization: token, 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { id identifier priority url } } }`,
        variables: { id: args.issueId, input: { priority: args.priority } },
      }),
    });
    const json = (await res.json()) as {
      data?: {
        issueUpdate?: {
          success?: boolean;
          issue?: { id: string; identifier: string; priority: number; url: string };
        };
      };
      errors?: { message: string }[];
    };
    if (json.errors?.length) throw new Error(json.errors[0]!.message);
    if (!json.data?.issueUpdate?.success || !json.data.issueUpdate.issue) {
      throw new Error('linear_set_priority_failed');
    }
    const issue = json.data.issueUpdate.issue;
    return {
      result: {
        issueId: issue.id,
        identifier: issue.identifier,
        priority: issue.priority,
        url: issue.url,
      },
    };
  },
};

// ─── gcal_add_attendees ───────────────────────────────────────────────────

const gcalAddAttendeesArgs = z.object({
  integrationId: z.string().uuid(),
  calendarId: z.string().default('primary'),
  eventId: z.string().min(1),
  emails: z.array(z.string().email()).min(1).max(50),
});

const gcalAddAttendeesTool: ToolDefinition<typeof gcalAddAttendeesArgs> = {
  name: 'gcal_add_attendees',
  description:
    'Append attendees to an existing Google Calendar event. Existing attendees are preserved. Default ACL is `ask`.',
  kind: 'high_risk',
  args: gcalAddAttendeesArgs,
  async execute(args, ctx) {
    const token = await resolveIntegrationToken(ctx.workspaceId, args.integrationId, 'gcal');
    const baseUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(args.calendarId)}/events/${encodeURIComponent(args.eventId)}`;
    const getRes = await fetch(baseUrl, { headers: { authorization: `Bearer ${token}` } });
    const getJson = (await getRes.json()) as {
      attendees?: { email: string }[];
      error?: { message?: string };
    };
    if (!getRes.ok) throw new Error(getJson.error?.message ?? `gcal_http_${getRes.status}`);
    const existing = new Set((getJson.attendees ?? []).map((a) => a.email.toLowerCase()));
    const merged = [
      ...(getJson.attendees ?? []),
      ...args.emails.filter((e) => !existing.has(e.toLowerCase())).map((email) => ({ email })),
    ];
    const patchRes = await fetch(baseUrl, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ attendees: merged }),
    });
    const patchJson = (await patchRes.json()) as {
      id?: string;
      htmlLink?: string;
      attendees?: { email: string }[];
      error?: { message?: string };
    };
    if (!patchRes.ok) throw new Error(patchJson.error?.message ?? `gcal_http_${patchRes.status}`);
    return {
      result: {
        id: patchJson.id ?? args.eventId,
        url: patchJson.htmlLink ?? null,
        attendeeCount: patchJson.attendees?.length ?? merged.length,
      },
    };
  },
};

// ─── notion_search ────────────────────────────────────────────────────────

const notionSearchArgs = z.object({
  integrationId: z.string().uuid(),
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(20).default(5),
});

const notionSearchTool: ToolDefinition<typeof notionSearchArgs> = {
  name: 'notion_search',
  description: 'Search Notion pages and databases the integration can see. Read-only.',
  kind: 'read',
  args: notionSearchArgs,
  async execute(args, ctx) {
    const token = await resolveIntegrationToken(ctx.workspaceId, args.integrationId, 'notion');
    const res = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'notion-version': '2022-06-28',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query: args.query, page_size: args.limit }),
    });
    const json = (await res.json()) as {
      results?: Array<{
        id: string;
        object: string;
        url?: string;
        properties?: Record<string, { title?: Array<{ plain_text?: string }> }>;
      }>;
      message?: string;
    };
    if (!res.ok) throw new Error(json.message ?? `notion_http_${res.status}`);
    const hits = (json.results ?? []).slice(0, args.limit).map((r) => {
      const titleProp = r.properties
        ? Object.values(r.properties).find((p) => Array.isArray(p.title))
        : null;
      const title = titleProp?.title?.map((t) => t.plain_text ?? '').join('') ?? '(untitled)';
      return { id: r.id, object: r.object, title, url: r.url ?? null };
    });
    return { result: { hits } };
  },
};

// ─── slack_search_messages ────────────────────────────────────────────────

const slackSearchArgs = z.object({
  integrationId: z.string().uuid(),
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(20).default(5),
});

const slackSearchMessagesTool: ToolDefinition<typeof slackSearchArgs> = {
  name: 'slack_search_messages',
  description:
    'Search Slack messages visible to the connected user. Read-only. Requires search:read scope.',
  kind: 'read',
  args: slackSearchArgs,
  async execute(args, ctx) {
    const token = await resolveIntegrationToken(ctx.workspaceId, args.integrationId, 'slack');
    const url = new URL('https://slack.com/api/search.messages');
    url.searchParams.set('query', args.query);
    url.searchParams.set('count', String(args.limit));
    const res = await fetch(url.toString(), {
      headers: { authorization: `Bearer ${token}` },
    });
    const json = (await res.json()) as {
      ok?: boolean;
      messages?: {
        matches?: Array<{
          text?: string;
          permalink?: string;
          user?: string;
          ts?: string;
          channel?: { name?: string };
        }>;
      };
      error?: string;
    };
    if (!json.ok) throw new Error(json.error ?? `slack_http_${res.status}`);
    const hits = (json.messages?.matches ?? []).slice(0, args.limit).map((m) => ({
      text: m.text ?? '',
      permalink: m.permalink ?? null,
      channel: m.channel?.name ?? null,
      user: m.user ?? null,
      ts: m.ts ?? null,
    }));
    return { result: { hits } };
  },
};

// ─── gcal_list_events ─────────────────────────────────────────────────────

const gcalListEventsArgs = z.object({
  integrationId: z.string().uuid(),
  calendarId: z.string().default('primary'),
  hoursAhead: z.number().int().min(1).max(168).default(24),
  limit: z.number().int().min(1).max(50).default(10),
});

const gcalListEventsTool: ToolDefinition<typeof gcalListEventsArgs> = {
  name: 'gcal_list_events',
  description: 'List upcoming Google Calendar events in a time window. Read-only.',
  kind: 'read',
  args: gcalListEventsArgs,
  async execute(args, ctx) {
    const token = await resolveIntegrationToken(ctx.workspaceId, args.integrationId, 'gcal');
    const timeMin = new Date().toISOString();
    const timeMax = new Date(Date.now() + args.hoursAhead * 60 * 60_000).toISOString();
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(args.calendarId)}/events`,
    );
    url.searchParams.set('timeMin', timeMin);
    url.searchParams.set('timeMax', timeMax);
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('maxResults', String(args.limit));
    const res = await fetch(url.toString(), { headers: { authorization: `Bearer ${token}` } });
    const json = (await res.json()) as {
      items?: Array<{
        id: string;
        summary?: string;
        htmlLink?: string;
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
        location?: string;
      }>;
      error?: { message?: string };
    };
    if (!res.ok) throw new Error(json.error?.message ?? `gcal_http_${res.status}`);
    const events = (json.items ?? []).map((e) => ({
      id: e.id,
      summary: e.summary ?? '(no title)',
      url: e.htmlLink ?? null,
      start: e.start?.dateTime ?? e.start?.date ?? null,
      end: e.end?.dateTime ?? e.end?.date ?? null,
      location: e.location ?? null,
    }));
    return { result: { events } };
  },
};

// ─── github_get_pr ────────────────────────────────────────────────────────

const githubGetPrArgs = z.object({
  integrationId: z.string().uuid(),
  repoFullName: z.string().regex(/^[^/]+\/[^/]+$/, 'expected "owner/repo"'),
  pullNumber: z.number().int().positive(),
});

const githubGetPrTool: ToolDefinition<typeof githubGetPrArgs> = {
  name: 'github_get_pr',
  description: 'Fetch metadata + body of a GitHub pull request. Read-only.',
  kind: 'read',
  args: githubGetPrArgs,
  async execute(args, ctx) {
    const token = await resolveGithubToken(ctx.workspaceId, args.integrationId);
    const [owner, repo] = args.repoFullName.split('/') as [string, string];
    const o = octokitForToken(token);
    const res = await o.rest.pulls.get({ owner, repo, pull_number: args.pullNumber });
    return {
      result: {
        number: res.data.number,
        title: res.data.title,
        state: res.data.state,
        merged: res.data.merged,
        draft: res.data.draft ?? false,
        author: res.data.user?.login ?? null,
        url: res.data.html_url,
        body: (res.data.body ?? '').slice(0, 4000),
        additions: res.data.additions,
        deletions: res.data.deletions,
        changedFiles: res.data.changed_files,
      },
    };
  },
};

// ─── linear_get_issue ─────────────────────────────────────────────────────

const linearGetIssueArgs = z.object({
  integrationId: z.string().uuid(),
  identifier: z
    .string()
    .regex(/^[A-Z]+-\d+$/, 'expected "ENG-123" form')
    .describe('Linear issue identifier (NOT UUID).'),
});

const linearGetIssueTool: ToolDefinition<typeof linearGetIssueArgs> = {
  name: 'linear_get_issue',
  description: 'Fetch a Linear issue by identifier (e.g. ENG-123). Read-only.',
  kind: 'read',
  args: linearGetIssueArgs,
  async execute(args, ctx) {
    const token = await resolveLinearToken(ctx.workspaceId, args.integrationId);
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { authorization: token, 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `query($id: String!) { issue(id: $id) { id identifier title description state { name } priority url assignee { name } team { key } } }`,
        variables: { id: args.identifier },
      }),
    });
    const json = (await res.json()) as {
      data?: {
        issue?: {
          id: string;
          identifier: string;
          title: string;
          description?: string;
          state?: { name: string };
          priority: number;
          url: string;
          assignee?: { name: string };
          team?: { key: string };
        };
      };
      errors?: { message: string }[];
    };
    if (json.errors?.length) throw new Error(json.errors[0]!.message);
    if (!json.data?.issue) throw new Error('linear_issue_not_found');
    const i = json.data.issue;
    return {
      result: {
        id: i.id,
        identifier: i.identifier,
        title: i.title,
        description: (i.description ?? '').slice(0, 4000),
        state: i.state?.name ?? null,
        priority: i.priority,
        assignee: i.assignee?.name ?? null,
        team: i.team?.key ?? null,
        url: i.url,
      },
    };
  },
};

// ─── linear_assign_issue ──────────────────────────────────────────────────

const linearAssignIssueArgs = z.object({
  integrationId: z.string().uuid(),
  issueId: z.string().min(1).describe('Linear issue UUID (NOT ENG-123 identifier).'),
  assigneeId: z.string().min(1).describe('Linear user UUID. Use empty string to unassign.'),
});

const linearAssignIssueTool: ToolDefinition<typeof linearAssignIssueArgs> = {
  name: 'linear_assign_issue',
  description: 'Assign or unassign a Linear issue. Default ACL is `ask`.',
  kind: 'high_risk',
  args: linearAssignIssueArgs,
  async execute(args, ctx) {
    const token = await resolveLinearToken(ctx.workspaceId, args.integrationId);
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { authorization: token, 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { id identifier url assignee { name } } } }`,
        variables: { id: args.issueId, input: { assigneeId: args.assigneeId || null } },
      }),
    });
    const json = (await res.json()) as {
      data?: {
        issueUpdate?: {
          success?: boolean;
          issue?: { id: string; identifier: string; url: string; assignee?: { name: string } };
        };
      };
      errors?: { message: string }[];
    };
    if (json.errors?.length) throw new Error(json.errors[0]!.message);
    if (!json.data?.issueUpdate?.success || !json.data.issueUpdate.issue) {
      throw new Error('linear_assign_failed');
    }
    const issue = json.data.issueUpdate.issue;
    return {
      result: {
        issueId: issue.id,
        identifier: issue.identifier,
        url: issue.url,
        assignee: issue.assignee?.name ?? null,
      },
    };
  },
};

// ─── notion_get_page ────────────────────────────────────────────────────────

const notionGetPageArgs = z.object({
  integrationId: z.string().uuid(),
  pageId: z.string().min(1),
  blockLimit: z.number().int().min(1).max(50).default(20),
});

const notionGetPageTool: ToolDefinition<typeof notionGetPageArgs> = {
  name: 'notion_get_page',
  description:
    'Fetch a Notion page: title + first N child blocks (paragraph/heading/bulleted text). Read-only.',
  kind: 'read',
  args: notionGetPageArgs,
  async execute(args, ctx) {
    const token = await resolveIntegrationToken(ctx.workspaceId, args.integrationId, 'notion');
    const headers = {
      authorization: `Bearer ${token}`,
      'notion-version': '2022-06-28',
      'content-type': 'application/json',
    };
    const pageRes = await fetch(`https://api.notion.com/v1/pages/${args.pageId}`, { headers });
    if (!pageRes.ok) throw new Error(`notion_get_page_failed: ${pageRes.status}`);
    const page = (await pageRes.json()) as {
      id: string;
      url: string;
      properties: Record<string, { title?: { plain_text: string }[] }>;
    };
    const titleProp = Object.values(page.properties).find((p) => Array.isArray(p.title));
    const title = titleProp?.title?.map((t) => t.plain_text).join('') ?? '';

    const blocksRes = await fetch(
      `https://api.notion.com/v1/blocks/${args.pageId}/children?page_size=${args.blockLimit}`,
      { headers },
    );
    if (!blocksRes.ok) throw new Error(`notion_get_blocks_failed: ${blocksRes.status}`);
    const blocksJson = (await blocksRes.json()) as {
      results: { id: string; type: string; [k: string]: unknown }[];
    };
    const blocks = blocksJson.results.map((b) => {
      const inner = (b as Record<string, unknown>)[b.type] as
        | { rich_text?: { plain_text: string }[] }
        | undefined;
      const text = inner?.rich_text?.map((t) => t.plain_text).join('') ?? '';
      return { id: b.id, type: b.type, text };
    });
    return { result: { id: page.id, title, url: page.url, blocks } };
  },
};

// ─── slack_list_channels ────────────────────────────────────────────────────

const slackListChannelsArgs = z.object({
  integrationId: z.string().uuid(),
  limit: z.number().int().min(1).max(200).default(50),
  excludeArchived: z.boolean().default(true),
});

const slackListChannelsTool: ToolDefinition<typeof slackListChannelsArgs> = {
  name: 'slack_list_channels',
  description: 'List Slack channels (public + private) accessible to the workspace bot. Read-only.',
  kind: 'read',
  args: slackListChannelsArgs,
  async execute(args, ctx) {
    const token = await resolveIntegrationToken(ctx.workspaceId, args.integrationId, 'slack');
    const url = new URL('https://slack.com/api/conversations.list');
    url.searchParams.set('limit', String(args.limit));
    url.searchParams.set('exclude_archived', String(args.excludeArchived));
    url.searchParams.set('types', 'public_channel,private_channel');
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    const json = (await res.json()) as {
      ok: boolean;
      error?: string;
      channels?: { id: string; name: string; is_private: boolean; num_members?: number }[];
    };
    if (!json.ok) throw new Error(`slack_list_channels_failed: ${json.error ?? 'unknown'}`);
    return {
      result: {
        channels: (json.channels ?? []).map((c) => ({
          id: c.id,
          name: c.name,
          isPrivate: c.is_private,
          members: c.num_members ?? null,
        })),
      },
    };
  },
};

// ─── gcal_quick_add ─────────────────────────────────────────────────────────

const gcalQuickAddArgs = z.object({
  integrationId: z.string().uuid(),
  calendarId: z.string().default('primary'),
  text: z.string().min(3).max(500),
});

const gcalQuickAddTool: ToolDefinition<typeof gcalQuickAddArgs> = {
  name: 'gcal_quick_add',
  description:
    'Create a Google Calendar event from a natural-language string (e.g. "Coffee with Sam Friday 4pm"). Default ACL is `ask`.',
  kind: 'low_risk',
  args: gcalQuickAddArgs,
  async execute(args, ctx) {
    const token = await resolveIntegrationToken(ctx.workspaceId, args.integrationId, 'gcal');
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(args.calendarId)}/events/quickAdd`,
    );
    url.searchParams.set('text', args.text);
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`gcal_quick_add_failed: ${res.status}`);
    const json = (await res.json()) as {
      id: string;
      htmlLink: string;
      summary?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
    };
    return {
      result: {
        id: json.id,
        url: json.htmlLink,
        summary: json.summary ?? args.text,
        start: json.start?.dateTime ?? json.start?.date ?? null,
        end: json.end?.dateTime ?? json.end?.date ?? null,
      },
    };
  },
};

// ─── linear_list_teams ──────────────────────────────────────────────────────

const linearListTeamsArgs = z.object({
  integrationId: z.string().uuid(),
});

const linearListTeamsTool: ToolDefinition<typeof linearListTeamsArgs> = {
  name: 'linear_list_teams',
  description: 'List Linear teams (id, key, name) — useful before creating an issue. Read-only.',
  kind: 'read',
  args: linearListTeamsArgs,
  async execute(args, ctx) {
    const token = await resolveLinearToken(ctx.workspaceId, args.integrationId);
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { authorization: token, 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `query { teams(first: 50) { nodes { id key name } } }`,
      }),
    });
    const json = (await res.json()) as {
      data?: { teams?: { nodes?: { id: string; key: string; name: string }[] } };
      errors?: { message: string }[];
    };
    if (json.errors?.length) throw new Error(json.errors[0]!.message);
    return { result: { teams: json.data?.teams?.nodes ?? [] } };
  },
};

// ─── github_search_issues ───────────────────────────────────────────────────

const githubSearchIssuesArgs = z.object({
  integrationId: z.string().uuid(),
  /**
   * GitHub search query. e.g. `repo:owner/name is:issue is:open author:me`.
   * See https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests
   */
  query: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(20).default(10),
});

const githubSearchIssuesTool: ToolDefinition<typeof githubSearchIssuesArgs> = {
  name: 'github_search_issues',
  description: 'Search GitHub issues + PRs across accessible repos via the search API. Read-only.',
  kind: 'read',
  args: githubSearchIssuesArgs,
  async execute(args, ctx) {
    const token = await resolveGithubToken(ctx.workspaceId, args.integrationId);
    const o = octokitForToken(token);
    const res = await o.rest.search.issuesAndPullRequests({
      q: args.query,
      per_page: args.limit,
    });
    return {
      result: {
        total: res.data.total_count,
        items: res.data.items.map((i) => ({
          number: i.number,
          title: i.title,
          state: i.state,
          url: i.html_url,
          isPullRequest: !!i.pull_request,
          author: i.user?.login ?? null,
          repo: i.repository_url.replace('https://api.github.com/repos/', ''),
        })),
      },
    };
  },
};

// ─── github_list_releases ───────────────────────────────────────────────────

const githubListReleasesArgs = z.object({
  integrationId: z.string().uuid(),
  repoFullName: z.string().regex(/^[^/]+\/[^/]+$/),
  limit: z.number().int().min(1).max(20).default(5),
});

const githubListReleasesTool: ToolDefinition<typeof githubListReleasesArgs> = {
  name: 'github_list_releases',
  description: 'List recent GitHub releases for a repo. Read-only.',
  kind: 'read',
  args: githubListReleasesArgs,
  async execute(args, ctx) {
    const token = await resolveGithubToken(ctx.workspaceId, args.integrationId);
    const o = octokitForToken(token);
    const [owner, repo] = args.repoFullName.split('/') as [string, string];
    const res = await o.rest.repos.listReleases({ owner, repo, per_page: args.limit });
    return {
      result: {
        releases: res.data.map((r) => ({
          id: r.id,
          name: r.name ?? r.tag_name,
          tagName: r.tag_name,
          url: r.html_url,
          draft: r.draft,
          prerelease: r.prerelease,
          publishedAt: r.published_at,
          author: r.author?.login ?? null,
        })),
      },
    };
  },
};

// ─── notion_query_database ──────────────────────────────────────────────────

const notionQueryDatabaseArgs = z.object({
  integrationId: z.string().uuid(),
  databaseId: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(10),
});

const notionQueryDatabaseTool: ToolDefinition<typeof notionQueryDatabaseArgs> = {
  name: 'notion_query_database',
  description:
    'Query a Notion database. Returns the most recently edited rows with their title + url. Read-only.',
  kind: 'read',
  args: notionQueryDatabaseArgs,
  async execute(args, ctx) {
    const token = await resolveIntegrationToken(ctx.workspaceId, args.integrationId, 'notion');
    const res = await fetch(`https://api.notion.com/v1/databases/${args.databaseId}/query`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'notion-version': '2022-06-28',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        page_size: args.limit,
        sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      }),
    });
    if (!res.ok) throw new Error(`notion_query_database_failed: ${res.status}`);
    const json = (await res.json()) as {
      results: {
        id: string;
        url: string;
        last_edited_time: string;
        properties: Record<string, { title?: { plain_text: string }[] }>;
      }[];
    };
    return {
      result: {
        rows: json.results.map((r) => {
          const titleProp = Object.values(r.properties).find((p) => Array.isArray(p.title));
          const title = titleProp?.title?.map((t) => t.plain_text).join('') ?? '';
          return { id: r.id, title, url: r.url, lastEditedAt: r.last_edited_time };
        }),
      },
    };
  },
};

// ─── slack_list_users ───────────────────────────────────────────────────────

const slackListUsersArgs = z.object({
  integrationId: z.string().uuid(),
  limit: z.number().int().min(1).max(200).default(50),
});

const slackListUsersTool: ToolDefinition<typeof slackListUsersArgs> = {
  name: 'slack_list_users',
  description: 'List Slack workspace members (active humans, no bots/deleted). Read-only.',
  kind: 'read',
  args: slackListUsersArgs,
  async execute(args, ctx) {
    const token = await resolveIntegrationToken(ctx.workspaceId, args.integrationId, 'slack');
    const url = new URL('https://slack.com/api/users.list');
    url.searchParams.set('limit', String(args.limit));
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    const json = (await res.json()) as {
      ok: boolean;
      error?: string;
      members?: {
        id: string;
        name: string;
        real_name?: string;
        is_bot?: boolean;
        deleted?: boolean;
        profile?: { email?: string };
      }[];
    };
    if (!json.ok) throw new Error(`slack_list_users_failed: ${json.error ?? 'unknown'}`);
    return {
      result: {
        users: (json.members ?? [])
          .filter((m) => !m.is_bot && !m.deleted)
          .map((m) => ({
            id: m.id,
            name: m.name,
            realName: m.real_name ?? null,
            email: m.profile?.email ?? null,
          })),
      },
    };
  },
};

// ─── gcal_list_calendars ────────────────────────────────────────────────────

const gcalListCalendarsArgs = z.object({
  integrationId: z.string().uuid(),
});

const gcalListCalendarsTool: ToolDefinition<typeof gcalListCalendarsArgs> = {
  name: 'gcal_list_calendars',
  description:
    'List Google Calendars accessible to the user (id, summary, primary, accessRole). Read-only.',
  kind: 'read',
  args: gcalListCalendarsArgs,
  async execute(args, ctx) {
    const token = await resolveIntegrationToken(ctx.workspaceId, args.integrationId, 'gcal');
    const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`gcal_list_calendars_failed: ${res.status}`);
    const json = (await res.json()) as {
      items?: { id: string; summary: string; primary?: boolean; accessRole?: string }[];
    };
    return {
      result: {
        calendars: (json.items ?? []).map((c) => ({
          id: c.id,
          summary: c.summary,
          primary: !!c.primary,
          accessRole: c.accessRole ?? null,
        })),
      },
    };
  },
};

// ─── github_list_repos ──────────────────────────────────────────────────────

const githubListReposArgs = z.object({
  integrationId: z.string().uuid(),
  limit: z.number().int().min(1).max(50).default(20),
  sort: z.enum(['updated', 'pushed', 'created', 'full_name']).default('updated'),
});

const githubListReposTool: ToolDefinition<typeof githubListReposArgs> = {
  name: 'github_list_repos',
  description: 'List GitHub repositories accessible to the authenticated user. Read-only.',
  kind: 'read',
  args: githubListReposArgs,
  async execute(args, ctx) {
    const token = await resolveGithubToken(ctx.workspaceId, args.integrationId);
    const o = octokitForToken(token);
    const res = await o.rest.repos.listForAuthenticatedUser({
      per_page: args.limit,
      sort: args.sort,
    });
    return {
      result: {
        repos: res.data.map((r) => ({
          fullName: r.full_name,
          private: r.private,
          description: r.description ?? null,
          url: r.html_url,
          defaultBranch: r.default_branch,
          updatedAt: r.updated_at,
        })),
      },
    };
  },
};

// ─── linear_list_projects ───────────────────────────────────────────────────

const linearListProjectsArgs = z.object({
  integrationId: z.string().uuid(),
});

const linearListProjectsTool: ToolDefinition<typeof linearListProjectsArgs> = {
  name: 'linear_list_projects',
  description: 'List Linear projects (id, name, state, url, slug). Read-only.',
  kind: 'read',
  args: linearListProjectsArgs,
  async execute(args, ctx) {
    const token = await resolveLinearToken(ctx.workspaceId, args.integrationId);
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { authorization: token, 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `query { projects(first: 50) { nodes { id name state url slugId } } }`,
      }),
    });
    const json = (await res.json()) as {
      data?: {
        projects?: {
          nodes?: { id: string; name: string; state: string; url: string; slugId: string }[];
        };
      };
      errors?: { message: string }[];
    };
    if (json.errors?.length) throw new Error(json.errors[0]!.message);
    return { result: { projects: json.data?.projects?.nodes ?? [] } };
  },
};

// ─── linear_list_states ─────────────────────────────────────────────────────

const linearListStatesArgs = z.object({
  integrationId: z.string().uuid(),
  teamId: z.string().min(1),
});

const linearListStatesTool: ToolDefinition<typeof linearListStatesArgs> = {
  name: 'linear_list_states',
  description:
    'List workflow states for a Linear team (Backlog, Todo, In Progress, Done, …). Useful before linear_move_issue. Read-only.',
  kind: 'read',
  args: linearListStatesArgs,
  async execute(args, ctx) {
    const token = await resolveLinearToken(ctx.workspaceId, args.integrationId);
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { authorization: token, 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `query($teamId: String!) { team(id: $teamId) { states(first: 30) { nodes { id name type position } } } }`,
        variables: { teamId: args.teamId },
      }),
    });
    const json = (await res.json()) as {
      data?: {
        team?: {
          states?: { nodes?: { id: string; name: string; type: string; position: number }[] };
        };
      };
      errors?: { message: string }[];
    };
    if (json.errors?.length) throw new Error(json.errors[0]!.message);
    return {
      result: {
        states: (json.data?.team?.states?.nodes ?? []).sort((a, b) => a.position - b.position),
      },
    };
  },
};

// ─── gcal_get_event ─────────────────────────────────────────────────────────

const gcalGetEventArgs = z.object({
  integrationId: z.string().uuid(),
  calendarId: z.string().default('primary'),
  eventId: z.string().min(1),
});

const gcalGetEventTool: ToolDefinition<typeof gcalGetEventArgs> = {
  name: 'gcal_get_event',
  description:
    'Fetch a single Google Calendar event by id (summary, start/end, attendees, location, description). Read-only.',
  kind: 'read',
  args: gcalGetEventArgs,
  async execute(args, ctx) {
    const token = await resolveIntegrationToken(ctx.workspaceId, args.integrationId, 'gcal');
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(args.calendarId)}/events/${encodeURIComponent(args.eventId)}`;
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`gcal_get_event_failed: ${res.status}`);
    const json = (await res.json()) as {
      id: string;
      htmlLink: string;
      summary?: string;
      description?: string;
      location?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
      attendees?: { email?: string; displayName?: string; responseStatus?: string }[];
    };
    return {
      result: {
        id: json.id,
        url: json.htmlLink,
        summary: json.summary ?? '',
        description: json.description?.slice(0, 4000) ?? '',
        location: json.location ?? null,
        start: json.start?.dateTime ?? json.start?.date ?? null,
        end: json.end?.dateTime ?? json.end?.date ?? null,
        attendees: (json.attendees ?? []).map((a) => ({
          email: a.email ?? null,
          name: a.displayName ?? null,
          response: a.responseStatus ?? null,
        })),
      },
    };
  },
};

// ─── slack_get_channel_history ──────────────────────────────────────────────

const slackGetChannelHistoryArgs = z.object({
  integrationId: z.string().uuid(),
  channelId: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(20),
});

const slackGetChannelHistoryTool: ToolDefinition<typeof slackGetChannelHistoryArgs> = {
  name: 'slack_get_channel_history',
  description: 'Fetch recent messages from a Slack channel (most recent first). Read-only.',
  kind: 'read',
  args: slackGetChannelHistoryArgs,
  async execute(args, ctx) {
    const token = await resolveIntegrationToken(ctx.workspaceId, args.integrationId, 'slack');
    const url = new URL('https://slack.com/api/conversations.history');
    url.searchParams.set('channel', args.channelId);
    url.searchParams.set('limit', String(args.limit));
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    const json = (await res.json()) as {
      ok: boolean;
      error?: string;
      messages?: { ts: string; user?: string; text?: string; thread_ts?: string }[];
    };
    if (!json.ok) throw new Error(`slack_get_channel_history_failed: ${json.error ?? 'unknown'}`);
    return {
      result: {
        messages: (json.messages ?? []).map((m) => ({
          ts: m.ts,
          user: m.user ?? null,
          text: m.text ?? '',
          isThreadReply: !!m.thread_ts && m.thread_ts !== m.ts,
        })),
      },
    };
  },
};

// ─── github_get_repo ────────────────────────────────────────────────────────

const githubGetRepoArgs = z.object({
  integrationId: z.string().uuid(),
  repoFullName: z.string().regex(/^[^/]+\/[^/]+$/),
});

const githubGetRepoTool: ToolDefinition<typeof githubGetRepoArgs> = {
  name: 'github_get_repo',
  description:
    'Fetch a GitHub repository: stars, forks, open issues, default branch, topics, language, description. Read-only.',
  kind: 'read',
  args: githubGetRepoArgs,
  async execute(args, ctx) {
    const token = await resolveGithubToken(ctx.workspaceId, args.integrationId);
    const o = octokitForToken(token);
    const [owner, repo] = args.repoFullName.split('/') as [string, string];
    const r = await o.rest.repos.get({ owner, repo });
    return {
      result: {
        fullName: r.data.full_name,
        url: r.data.html_url,
        description: r.data.description ?? null,
        stars: r.data.stargazers_count,
        forks: r.data.forks_count,
        openIssues: r.data.open_issues_count,
        defaultBranch: r.data.default_branch,
        language: r.data.language ?? null,
        topics: r.data.topics ?? [],
        private: r.data.private,
        archived: r.data.archived,
        pushedAt: r.data.pushed_at,
      },
    };
  },
};

// ─── github_list_workflow_runs ──────────────────────────────────────────────

const githubListWorkflowRunsArgs = z.object({
  integrationId: z.string().uuid(),
  repoFullName: z.string().regex(/^[^/]+\/[^/]+$/),
  limit: z.number().int().min(1).max(20).default(10),
  branch: z.string().optional(),
});

const githubListWorkflowRunsTool: ToolDefinition<typeof githubListWorkflowRunsArgs> = {
  name: 'github_list_workflow_runs',
  description:
    'List recent GitHub Actions workflow runs for a repo (status, conclusion, branch, commit, run url). Read-only.',
  kind: 'read',
  args: githubListWorkflowRunsArgs,
  async execute(args, ctx) {
    const token = await resolveGithubToken(ctx.workspaceId, args.integrationId);
    const o = octokitForToken(token);
    const [owner, repo] = args.repoFullName.split('/') as [string, string];
    const r = await o.rest.actions.listWorkflowRunsForRepo({
      owner,
      repo,
      per_page: args.limit,
      ...(args.branch ? { branch: args.branch } : {}),
    });
    return {
      result: {
        total: r.data.total_count,
        runs: r.data.workflow_runs.map((w) => ({
          id: w.id,
          name: w.name ?? null,
          status: w.status,
          conclusion: w.conclusion,
          branch: w.head_branch,
          sha: w.head_sha.slice(0, 7),
          url: w.html_url,
          actor: w.actor?.login ?? null,
          createdAt: w.created_at,
        })),
      },
    };
  },
};

// ─── notion_get_database ────────────────────────────────────────────────────

const notionGetDatabaseArgs = z.object({
  integrationId: z.string().uuid(),
  databaseId: z.string().min(1),
});

const notionGetDatabaseTool: ToolDefinition<typeof notionGetDatabaseArgs> = {
  name: 'notion_get_database',
  description:
    'Fetch a Notion database (title, url, property schema). Use before notion_query_database to know what filters/sorts are valid. Read-only.',
  kind: 'read',
  args: notionGetDatabaseArgs,
  async execute(args, ctx) {
    const token = await resolveIntegrationToken(ctx.workspaceId, args.integrationId, 'notion');
    const res = await fetch(
      `https://api.notion.com/v1/databases/${encodeURIComponent(args.databaseId)}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          'notion-version': '2022-06-28',
        },
      },
    );
    if (!res.ok) throw new Error(`notion_get_database_failed: ${res.status}`);
    const json = (await res.json()) as {
      id: string;
      url: string;
      title?: { plain_text?: string }[];
      properties?: Record<string, { type: string }>;
    };
    return {
      result: {
        id: json.id,
        url: json.url,
        title: (json.title ?? []).map((t) => t.plain_text ?? '').join('') || '(untitled)',
        properties: Object.entries(json.properties ?? {}).map(([name, p]) => ({
          name,
          type: p.type,
        })),
      },
    };
  },
};

// ─── slack_open_dm ──────────────────────────────────────────────────────────

const slackOpenDmArgs = z.object({
  integrationId: z.string().uuid(),
  userIds: z.array(z.string().min(1)).min(1).max(8),
});

const slackOpenDmTool: ToolDefinition<typeof slackOpenDmArgs> = {
  name: 'slack_open_dm',
  description:
    'Open (or reuse) a Slack DM/group-DM with the given user ids. Returns the channel id, which you can pass to slack_send_message.',
  kind: 'low_risk',
  args: slackOpenDmArgs,
  async execute(args, ctx) {
    const token = await resolveIntegrationToken(ctx.workspaceId, args.integrationId, 'slack');
    const res = await fetch('https://slack.com/api/conversations.open', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ users: args.userIds.join(',') }),
    });
    const json = (await res.json()) as {
      ok: boolean;
      error?: string;
      channel?: { id: string; is_im?: boolean; is_mpim?: boolean };
    };
    if (!json.ok) throw new Error(`slack_open_dm_failed: ${json.error ?? 'unknown'}`);
    return {
      result: {
        channelId: json.channel?.id ?? null,
        isIm: !!json.channel?.is_im,
        isMpim: !!json.channel?.is_mpim,
      },
    };
  },
};

// ─── github_get_commit ──────────────────────────────────────────────────────

const githubGetCommitArgs = z.object({
  integrationId: z.string().uuid(),
  repoFullName: z.string().regex(/^[^/]+\/[^/]+$/),
  ref: z.string().min(1).describe('Commit SHA, branch, or tag.'),
});

const githubGetCommitTool: ToolDefinition<typeof githubGetCommitArgs> = {
  name: 'github_get_commit',
  description: 'Fetch a single GitHub commit (message, author, stats, changed files). Read-only.',
  kind: 'read',
  args: githubGetCommitArgs,
  async execute(args, ctx) {
    const token = await resolveGithubToken(ctx.workspaceId, args.integrationId);
    const o = octokitForToken(token);
    const [owner, repo] = args.repoFullName.split('/') as [string, string];
    const r = await o.rest.repos.getCommit({ owner, repo, ref: args.ref });
    return {
      result: {
        sha: r.data.sha.slice(0, 7),
        url: r.data.html_url,
        message: r.data.commit.message.slice(0, 4000),
        author: r.data.commit.author?.name ?? r.data.author?.login ?? null,
        date: r.data.commit.author?.date ?? null,
        stats: {
          additions: r.data.stats?.additions ?? 0,
          deletions: r.data.stats?.deletions ?? 0,
          total: r.data.stats?.total ?? 0,
        },
        files: (r.data.files ?? []).slice(0, 50).map((f) => ({
          filename: f.filename,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
        })),
      },
    };
  },
};

// ─── linear_get_viewer ──────────────────────────────────────────────────────

const linearGetViewerArgs = z.object({
  integrationId: z.string().uuid(),
});

const linearGetViewerTool: ToolDefinition<typeof linearGetViewerArgs> = {
  name: 'linear_get_viewer',
  description: 'Fetch the authenticated Linear user (id, name, email, active teams). Read-only.',
  kind: 'read',
  args: linearGetViewerArgs,
  async execute(args, ctx) {
    const token = await resolveLinearToken(ctx.workspaceId, args.integrationId);
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { authorization: token, 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `query { viewer { id name email active teams(first: 20) { nodes { id name key } } } }`,
      }),
    });
    const json = (await res.json()) as {
      data?: {
        viewer?: {
          id: string;
          name: string;
          email: string;
          active: boolean;
          teams?: { nodes?: { id: string; name: string; key: string }[] };
        };
      };
      errors?: { message: string }[];
    };
    if (json.errors?.length) throw new Error(json.errors[0]!.message);
    const v = json.data?.viewer;
    if (!v) throw new Error('linear_get_viewer_empty');
    return {
      result: {
        id: v.id,
        name: v.name,
        email: v.email,
        active: v.active,
        teams: v.teams?.nodes ?? [],
      },
    };
  },
};

// ─── gcal_freebusy ──────────────────────────────────────────────────────────

const gcalFreebusyArgs = z.object({
  integrationId: z.string().uuid(),
  timeMin: z.string().datetime(),
  timeMax: z.string().datetime(),
  calendarIds: z.array(z.string().min(1)).min(1).max(10).default(['primary']),
});

const gcalFreebusyTool: ToolDefinition<typeof gcalFreebusyArgs> = {
  name: 'gcal_freebusy',
  description:
    'Query Google Calendar free/busy windows for one or more calendars in a time range. Returns busy intervals per calendar. Read-only.',
  kind: 'read',
  args: gcalFreebusyArgs,
  async execute(args, ctx) {
    const token = await resolveIntegrationToken(ctx.workspaceId, args.integrationId, 'gcal');
    const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        timeMin: args.timeMin,
        timeMax: args.timeMax,
        items: args.calendarIds.map((id) => ({ id })),
      }),
    });
    if (!res.ok) throw new Error(`gcal_freebusy_failed: ${res.status}`);
    const json = (await res.json()) as {
      calendars?: Record<
        string,
        { busy?: { start: string; end: string }[]; errors?: { reason: string }[] }
      >;
    };
    return {
      result: {
        calendars: Object.entries(json.calendars ?? {}).map(([id, c]) => ({
          calendarId: id,
          busy: c.busy ?? [],
          error: c.errors?.[0]?.reason ?? null,
        })),
      },
    };
  },
};

const briefingGenerateArgs = z.object({
  /**
   * Optional project id. When omitted, generates a workspace-wide briefing
   * synthesizing all active projects + recent meaningful events.
   */
  projectId: z.string().uuid().optional(),
});

const briefingGenerateTool: ToolDefinition<typeof briefingGenerateArgs> = {
  name: 'briefing_generate',
  description:
    'Generate a fresh "where was I?" briefing. With projectId: scoped to that project (same as restore_continuity). Without: a workspace-wide narrative across all active projects ending in the single smallest next step. Use eagerly when the user says they\'re back, or when the latest briefing is stale (>24h).',
  kind: 'low_risk',
  args: briefingGenerateArgs,
  async execute(args, ctx) {
    const db = getDb();
    if (args.projectId) {
      // Project-scoped: delegates to existing continuity flow.
      const [proj] = await db
        .select({ id: project.id, name: project.name })
        .from(project)
        .where(and(eq(project.id, args.projectId), eq(project.workspaceId, ctx.workspaceId)))
        .limit(1);
      if (!proj) throw new Error('project_not_found');
      const generated = await restoreProjectContext(ctx.workspaceId, args.projectId);
      const [inserted] = await db
        .insert(continuityBriefing)
        .values({
          workspaceId: ctx.workspaceId,
          projectId: args.projectId,
          briefing: generated.briefing,
          modelProvider: generated.provider,
          modelId: generated.modelId,
        })
        .returning();
      return {
        result: {
          scope: 'project' as const,
          projectId: args.projectId,
          projectName: proj.name,
          briefing: generated.briefing,
          briefingId: inserted?.id ?? null,
        },
      };
    }

    // Workspace-scoped: synthesize across active projects.
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const [activeProjects, recentEvents, blockedTasks] = await Promise.all([
      db
        .select({
          id: project.id,
          name: project.name,
          stateSummary: project.stateSummary,
          momentumScore: project.momentumScore,
        })
        .from(project)
        .where(
          and(
            eq(project.workspaceId, ctx.workspaceId),
            isNull(project.deletedAt),
            eq(project.status, 'active'),
          ),
        )
        .orderBy(desc(project.momentumScore))
        .limit(8),
      db
        .select({
          kind: timelineEvent.kind,
          title: timelineEvent.title,
          body: timelineEvent.body,
          importance: timelineEvent.importance,
          occurredAt: timelineEvent.occurredAt,
        })
        .from(timelineEvent)
        .where(
          and(
            eq(timelineEvent.workspaceId, ctx.workspaceId),
            gte(timelineEvent.occurredAt, since),
            sql`${timelineEvent.importance} >= 0.5`,
          ),
        )
        .orderBy(desc(timelineEvent.occurredAt))
        .limit(40),
      db
        .select({ title: task.title })
        .from(task)
        .where(
          and(
            eq(task.workspaceId, ctx.workspaceId),
            isNull(task.deletedAt),
            eq(task.status, 'blocked'),
          ),
        )
        .limit(10),
    ]);

    const { model, provider, modelId } = await getModel({
      workspaceId: ctx.workspaceId,
      intent: 'reasoning',
    });
    const system = buildConductorSystem(`You write workspace-wide continuity briefings.

Output a single markdown briefing in 3 short paragraphs:
  1) Where the user is across their active projects (cite project names).
  2) What's blocking momentum and where decisions are overdue.
  3) The single smallest next step the user should take right now.

Be specific, concrete, and warm. Do not list bullets. Do not output JSON.`);

    const userPrompt = JSON.stringify(
      {
        now: new Date().toISOString(),
        windowDays: 14,
        activeProjects,
        recentEvents,
        blockedTasks,
      },
      null,
      2,
    );

    const { text } = await generateText({
      model: model as Parameters<typeof generateText>[0]['model'],
      system,
      prompt: userPrompt,
    });

    return {
      result: {
        scope: 'workspace' as const,
        briefing: text,
        provider,
        modelId,
      },
    };
  },
};

// ─── summarize_day ─────────────────────────────────────────────────────────

const summarizeDayArgs = z.object({
  /** ISO date (YYYY-MM-DD) of the day to summarize. Defaults to today. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

const summarizeDayTool: ToolDefinition<typeof summarizeDayArgs> = {
  name: 'summarize_day',
  description:
    'Produce a 1-2 sentence narrative summary of what happened on a given day, drawing from the timeline. Useful for filling the Journal page with prose instead of bullets.',
  kind: 'read',
  args: summarizeDayArgs,
  async execute(args, ctx) {
    const db = getDb();
    const dayStr = args.date ?? new Date().toISOString().slice(0, 10);
    const start = new Date(`${dayStr}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime())) throw new Error('invalid_date');
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const events = await db
      .select({
        kind: timelineEvent.kind,
        title: timelineEvent.title,
        body: timelineEvent.body,
        importance: timelineEvent.importance,
      })
      .from(timelineEvent)
      .where(
        and(
          eq(timelineEvent.workspaceId, ctx.workspaceId),
          gte(timelineEvent.occurredAt, start),
          lt(timelineEvent.occurredAt, end),
        ),
      )
      .orderBy(desc(timelineEvent.importance))
      .limit(80);

    if (events.length === 0) {
      return {
        result: { date: dayStr, summary: 'Nothing notable.', eventCount: 0 },
      };
    }

    const { model, provider, modelId } = await getModel({
      workspaceId: ctx.workspaceId,
      intent: 'fast',
    });
    const { text } = await generateText({
      model: model as Parameters<typeof generateText>[0]['model'],
      system:
        "You write one-paragraph narrative summaries of a day, in the user's voice. Be factual, concrete, ≤ 3 sentences. Do not list bullets.",
      prompt: JSON.stringify({ date: dayStr, events }, null, 2),
    });
    return {
      result: {
        date: dayStr,
        summary: text.trim(),
        eventCount: events.length,
        provider,
        modelId,
      },
    };
  },
};

// ─── identify_people ───────────────────────────────────────────────────────

const identifyPeopleArgs = z.object({
  /** How many days back to scan. */
  days: z.number().int().min(1).max(180).default(60),
  /** Minimum mentions before a person is included. */
  minMentions: z.number().int().min(1).max(20).default(2),
});

const identifyPeopleTool: ToolDefinition<typeof identifyPeopleArgs> = {
  name: 'identify_people',
  description:
    "Extract people who keep showing up in the user's captures and timeline over the last N days. Returns canonical names, alias clusters, and mention counts. Read-only; the user can pin results later via the People page.",
  kind: 'read',
  args: identifyPeopleArgs,
  async execute(args, ctx) {
    const since = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000);
    const db = getDb();
    const [captures, events] = await Promise.all([
      db
        .select({ content: capture.content })
        .from(capture)
        .where(
          and(
            eq(capture.workspaceId, ctx.workspaceId),
            isNull(capture.deletedAt),
            gte(capture.capturedAt, since),
            sql`${capture.content} is not null`,
          ),
        )
        .limit(400),
      db
        .select({ title: timelineEvent.title, body: timelineEvent.body })
        .from(timelineEvent)
        .where(
          and(eq(timelineEvent.workspaceId, ctx.workspaceId), gte(timelineEvent.occurredAt, since)),
        )
        .limit(400),
    ]);

    // Crude pass first (same heuristic as /people).
    const rough = new Map<string, number>();
    function bump(s: string) {
      for (const m of s.matchAll(/@([a-zA-Z][\w.-]{1,30})/g)) {
        const key = '@' + m[1]!.toLowerCase();
        rough.set(key, (rough.get(key) ?? 0) + 1);
      }
      for (const m of s.matchAll(/\b([A-Z][a-z]{1,20})\s+([A-Z][a-z]{1,20})\b/g)) {
        const key = `${m[1]} ${m[2]}`;
        rough.set(key, (rough.get(key) ?? 0) + 1);
      }
    }
    for (const c of captures) if (c.content) bump(c.content);
    for (const e of events) bump(`${e.title}\n${e.body ?? ''}`);

    const candidates = Array.from(rough.entries())
      .filter(([, n]) => n >= args.minMentions)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 80)
      .map(([name, mentions]) => ({ name, mentions }));

    if (candidates.length === 0) {
      return { result: { days: args.days, people: [] } };
    }

    // Refine with LLM: cluster aliases, drop false positives.
    const personSchema = z.object({
      people: z
        .array(
          z.object({
            canonical: z.string().min(1).max(80),
            aliases: z.array(z.string().min(1).max(80)).default([]),
            mentions: z.number().int().min(1),
            confidence: z.number().min(0).max(1),
          }),
        )
        .max(50),
    });
    const { model, provider, modelId } = await getModel({
      workspaceId: ctx.workspaceId,
      intent: 'fast',
    });
    const { object } = await generateObject({
      model: model as Parameters<typeof generateObject>[0]['model'],
      schema: personSchema,
      schemaName: 'IdentifiedPeople',
      system:
        'Cluster the candidate tokens into canonical people. Pick the most-likely-real name as canonical, list other strings as aliases. Drop tokens that are clearly NOT people (places, products, common phrases). Sum mention counts of merged aliases. Confidence: 1.0 = clearly a real person, 0.5 = could be, < 0.3 = drop.',
      prompt: JSON.stringify({ candidates }, null, 2),
    });
    const filtered = object.people.filter((p) => p.confidence >= 0.5);
    return {
      result: {
        days: args.days,
        people: filtered,
        provider,
        modelId,
      },
    };
  },
};

// ─── pause_autonomy ────────────────────────────────────────────────────────

const pauseAutonomyArgs = z.object({
  /** When true, also drop defaultMode to 'observe' for the kill-switch. Defaults true. */
  hardStop: z.boolean().default(true),
  reason: z.string().min(1).max(280).optional(),
});

const pauseAutonomyTool: ToolDefinition<typeof pauseAutonomyArgs> = {
  name: 'pause_autonomy',
  description:
    'Disable the Conductor for this workspace. Sets agent_policy.enabled = false (and defaultMode = observe with hardStop). Use when the user says "pause", "stop", "hold on", "quiet down", etc. Undoable via resume_autonomy.',
  kind: 'low_risk',
  args: pauseAutonomyArgs,
  async execute(args, ctx) {
    const db = getDb();
    const [prev] = await db
      .select({ enabled: agentPolicy.enabled, defaultMode: agentPolicy.defaultMode })
      .from(agentPolicy)
      .where(eq(agentPolicy.workspaceId, ctx.workspaceId))
      .limit(1);

    await db
      .update(agentPolicy)
      .set({
        enabled: false,
        ...(args.hardStop ? { defaultMode: 'observe' as const } : {}),
      })
      .where(eq(agentPolicy.workspaceId, ctx.workspaceId));

    await db.insert(timelineEvent).values({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      kind: 'autonomy.paused',
      title: args.reason ? `Autonomy paused: ${args.reason}` : 'Autonomy paused',
      importance: 0.6,
    });

    return {
      result: { enabled: false, hardStop: args.hardStop },
      undoPayload: {
        prevEnabled: prev?.enabled ?? true,
        prevDefaultMode: prev?.defaultMode ?? 'ask',
      },
    };
  },
  async undo(undoPayload, ctx) {
    const db = getDb();
    const prev = undoPayload as { prevEnabled: boolean; prevDefaultMode: string };
    await db
      .update(agentPolicy)
      .set({
        enabled: prev.prevEnabled,
        defaultMode: prev.prevDefaultMode as 'observe' | 'ask' | 'auto_with_undo' | 'autopilot',
      })
      .where(eq(agentPolicy.workspaceId, ctx.workspaceId));
  },
};

// ─── Registry ──────────────────────────────────────────────────────────────

// ─── external_invoke ───────────────────────────────────────────────────────

const externalInvokeArgs = z.object({
  integrationId: z
    .string()
    .uuid()
    .describe('UUID of an `external_mcp` integration registered on /integrations.'),
  tool: z.string().min(1).describe('Remote tool name as advertised by the external MCP server.'),
  args: z
    .record(z.string(), z.unknown())
    .default({})
    .describe('Arguments forwarded to the remote tool.'),
});

const externalInvokeTool: ToolDefinition<typeof externalInvokeArgs> = {
  name: 'external_invoke',
  description:
    'Call a tool exposed by an external MCP server (e.g. notai, mmo). Use sparingly — each call is a network hop and may write to a third-party second brain.',
  kind: 'high_risk',
  args: externalInvokeArgs,
  async execute(args, ctx) {
    const db = getDb();
    const [row] = await db
      .select()
      .from(integration)
      .where(
        and(
          eq(integration.id, args.integrationId),
          eq(integration.workspaceId, ctx.workspaceId),
          eq(integration.kind, 'external_mcp'),
        ),
      )
      .limit(1);
    if (!row) throw new Error('integration not found');
    if (row.status !== 'active') throw new Error(`integration ${row.status}`);
    const config = row.config as unknown as ExternalMcpConfig;
    if (config.toolAllowlist && !config.toolAllowlist.includes(args.tool)) {
      throw new Error(`tool ${args.tool} not in allowlist for ${row.label}`);
    }
    const res = await callRemoteTool(config, args.tool, args.args);
    if (!res.ok) {
      await db.update(integration).set({ lastError: res.error }).where(eq(integration.id, row.id));
      throw new Error(res.error);
    }
    return { result: res.result };
  },
};

export const TOOLS = {
  recall: recallTool,
  list_projects: listProjectsTool,
  list_tasks: listTasksTool,
  github_repo_stats: githubRepoStatsTool,
  create_task: createTaskTool,
  set_task_status: setTaskStatusTool,
  move_task: moveTaskTool,
  set_task_due_date: setTaskDueDateTool,
  snooze_task: snoozeTaskTool,
  link_capture_to_project: linkCaptureTool,
  pin_to_goal: pinToGoalTool,
  propose_decision: proposeDecisionTool,
  tag_capture: tagCaptureTool,
  notify_user: notifyTool,
  log_observation: logObservationTool,
  restore_continuity: restoreContinuityTool,
  briefing_generate: briefingGenerateTool,
  summarize_day: summarizeDayTool,
  identify_people: identifyPeopleTool,
  pause_autonomy: pauseAutonomyTool,
  metu_resume: metuResumeTool,
  send_telegram: sendTelegramTool,
  send_email: sendEmailTool,
  archive_project: archiveProjectTool,
  delete_capture: deleteCaptureTool,
  merge_pr: mergePrTool,
  commit_file: commitFileTool,
  github_draft_pr: githubDraftPrTool,
  linear_add_comment: linearAddCommentTool,
  slack_send_message: slackSendMessageTool,
  gcal_create_event: gcalCreateEventTool,
  github_add_comment: githubAddCommentTool,
  github_pr_review_comment: githubPrReviewCommentTool,
  notion_append_block: notionAppendBlockTool,
  linear_move_issue: linearMoveIssueTool,
  github_merge_pr: githubMergePrTool,
  slack_add_reaction: slackAddReactionTool,
  slack_pin_message: slackPinMessageTool,
  notion_create_page: notionCreatePageTool,
  github_close_issue: githubCloseIssueTool,
  github_create_issue: githubCreateIssueTool,
  linear_create_issue: linearCreateIssueTool,
  gcal_update_event: gcalUpdateEventTool,
  github_request_review: githubRequestReviewTool,
  slack_update_message: slackUpdateMessageTool,
  notion_append_block_children: notionAppendBlockChildrenTool,
  gcal_delete_event: gcalDeleteEventTool,
  github_add_label: githubAddLabelTool,
  github_assign: githubAssignTool,
  linear_set_priority: linearSetPriorityTool,
  gcal_add_attendees: gcalAddAttendeesTool,
  notion_search: notionSearchTool,
  slack_search_messages: slackSearchMessagesTool,
  gcal_list_events: gcalListEventsTool,
  github_get_pr: githubGetPrTool,
  linear_get_issue: linearGetIssueTool,
  linear_assign_issue: linearAssignIssueTool,
  notion_get_page: notionGetPageTool,
  slack_list_channels: slackListChannelsTool,
  gcal_quick_add: gcalQuickAddTool,
  linear_list_teams: linearListTeamsTool,
  github_search_issues: githubSearchIssuesTool,
  github_list_releases: githubListReleasesTool,
  notion_query_database: notionQueryDatabaseTool,
  slack_list_users: slackListUsersTool,
  gcal_list_calendars: gcalListCalendarsTool,
  github_list_repos: githubListReposTool,
  linear_list_projects: linearListProjectsTool,
  linear_list_states: linearListStatesTool,
  gcal_get_event: gcalGetEventTool,
  slack_get_channel_history: slackGetChannelHistoryTool,
  github_get_repo: githubGetRepoTool,
  github_list_workflow_runs: githubListWorkflowRunsTool,
  notion_get_database: notionGetDatabaseTool,
  slack_open_dm: slackOpenDmTool,
  github_get_commit: githubGetCommitTool,
  linear_get_viewer: linearGetViewerTool,
  gcal_freebusy: gcalFreebusyTool,
  external_invoke: externalInvokeTool,
  ...DEVICE_TOOLS,
  ...EDITOR_TOOLS,
} as const satisfies Record<string, ToolDefinition<z.ZodTypeAny>>;

export type ToolName = keyof typeof TOOLS;

export function getTool(name: string): ToolDefinition<z.ZodTypeAny> | null {
  if (Object.prototype.hasOwnProperty.call(TOOLS, name)) {
    return TOOLS[name as ToolName];
  }
  return null;
}

export function listTools() {
  return Object.values(TOOLS).map((t) => ({
    name: t.name,
    description: t.description,
    kind: t.kind,
  }));
}

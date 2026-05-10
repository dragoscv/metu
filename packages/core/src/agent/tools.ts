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
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@metu/db';
import {
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
import { open as openSealed } from '@metu/ai';
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
  pin_to_goal: pinToGoalTool,
  propose_decision: proposeDecisionTool,
  tag_capture: tagCaptureTool,
  notify_user: notifyTool,
  log_observation: logObservationTool,
  restore_continuity: restoreContinuityTool,
  send_telegram: sendTelegramTool,
  send_email: sendEmailTool,
  archive_project: archiveProjectTool,
  delete_capture: deleteCaptureTool,
  merge_pr: mergePrTool,
  commit_file: commitFileTool,
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

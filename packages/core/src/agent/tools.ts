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
  decision,
  integration,
  notification,
  project,
  task,
  timelineEvent,
} from '@metu/db/schema';
import { callRemoteTool, type ExternalMcpConfig } from '@metu/integrations/mcp';
import * as memoryEngine from '../memory';

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
  async undo(payload) {
    const db = getDb();
    await db
      .update(task)
      .set({ deletedAt: new Date(), status: 'dropped' })
      .where(eq(task.id, String(payload.taskId)));
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
  async undo(payload) {
    const db = getDb();
    await db
      .update(decision)
      .set({ deletedAt: new Date() })
      .where(eq(decision.id, String(payload.decisionId)));
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
      .where(eq(capture.id, args.captureId));
    return {
      result: { ok: true },
      undoPayload: {
        captureId: args.captureId,
        prevProjectId: before.projectId,
        prevMetadata: meta,
      },
    };
  },
  async undo(payload) {
    const db = getDb();
    await db
      .update(capture)
      .set({
        projectId: (payload.prevProjectId as string | null) ?? null,
        metadata: (payload.prevMetadata as Record<string, unknown>) ?? {},
      })
      .where(eq(capture.id, String(payload.captureId)));
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
  create_task: createTaskTool,
  propose_decision: proposeDecisionTool,
  tag_capture: tagCaptureTool,
  notify_user: notifyTool,
  log_observation: logObservationTool,
  external_invoke: externalInvokeTool,
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

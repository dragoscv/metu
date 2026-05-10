'use server';
import { revalidatePath } from 'next/cache';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { project, decision, task, timelineEvent } from '@metu/db/schema';
import { and, eq } from 'drizzle-orm';
import {
  createDecisionSchema,
  createProjectSchema,
  createTaskSchema,
  type CreateDecisionInput,
  type CreateProjectInput,
  type CreateTaskInput,
} from '@metu/types';
import type { GithubRepo } from './github';
import { inngest } from '@/inngest/client';

/** Emit a `goal.pinned` (or `goal.unpinned`) timeline event when a task,
 *  project, or decision changes its goal pin. No-op when nothing changed. */
async function emitPinEvent(opts: {
  workspaceId: string;
  userId: string | undefined;
  refKind: 'task' | 'project' | 'decision';
  refId: string;
  refLabel: string;
  projectIdForTimeline: string | null;
  oldGoalId: string | null;
  newGoalId: string | null;
}) {
  if (opts.oldGoalId === opts.newGoalId) return;
  const db = getDb();
  const kind = opts.newGoalId ? 'goal.pinned' : 'goal.unpinned';
  const verb = opts.newGoalId ? 'Pinned' : 'Unpinned';
  await db.insert(timelineEvent).values({
    workspaceId: opts.workspaceId,
    userId: opts.userId ?? null,
    projectId: opts.projectIdForTimeline,
    kind,
    title: `${verb} ${opts.refKind} "${opts.refLabel}"`,
    payload: {
      refKind: opts.refKind,
      refId: opts.refId,
      goalId: opts.newGoalId ?? opts.oldGoalId,
      previousGoalId: opts.oldGoalId,
    },
    importance: 0.5,
  });
}

export async function createProjectAction(input: CreateProjectInput) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const parsed = createProjectSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };

  const db = getDb();
  const [row] = await db
    .insert(project)
    .values({
      workspaceId: session.user.workspaceId,
      name: parsed.data.name,
      slug: parsed.data.slug,
      summary: parsed.data.summary ?? null,
      goalId: parsed.data.goalId ?? null,
      metadata: parsed.data.metadata,
    })
    .returning();

  if (!row) return { ok: false as const, error: 'Insert failed' };

  await db.insert(timelineEvent).values({
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
    projectId: row.id,
    kind: 'project.created',
    title: `Created project ${row.name}`,
    importance: 0.7,
  });

  // Wake the conductor: a new project means new context to learn.
  await inngest
    .send({
      name: 'conductor/observe',
      data: {
        workspaceId: session.user.workspaceId,
        eventKind: 'project.created',
        payload: { projectId: row.id, name: row.name, slug: row.slug },
      },
    })
    .catch(() => {});

  revalidatePath('/projects');
  revalidatePath('/dashboard');
  if (parsed.data.goalId) {
    revalidatePath('/goals');
    revalidatePath(`/goals/${parsed.data.goalId}/board`);
    await emitPinEvent({
      workspaceId: session.user.workspaceId,
      userId: session.user.id,
      refKind: 'project',
      refId: row.id,
      refLabel: row.name,
      projectIdForTimeline: row.id,
      oldGoalId: null,
      newGoalId: parsed.data.goalId,
    });
  }
  return { ok: true as const, id: row.id };
}

export async function createProjectWithGithubRepoAction(input: {
  project: CreateProjectInput;
  github: { integrationId: string; repo: GithubRepo };
}) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const parsed = createProjectSchema.safeParse(input.project);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };

  // Reuse createProjectAction for the project insert + timeline event.
  const created = await createProjectAction(parsed.data);
  if (!created.ok) return created;

  const { assignGithubRepoAction } = await import('./github');
  const linkRes = await assignGithubRepoAction({
    projectId: created.id,
    integrationId: input.github.integrationId,
    repo: input.github.repo,
  });
  if (!linkRes.ok) {
    // Project exists but link failed; surface error so the UI can recover.
    return {
      ok: false as const,
      error: `Project created but repo link failed: ${linkRes.error}`,
      id: created.id,
    };
  }
  return { ok: true as const, id: created.id };
}

export async function createTaskAction(input: CreateTaskInput) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const parsed = createTaskSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };

  const db = getDb();
  const [row] = await db
    .insert(task)
    .values({
      workspaceId: session.user.workspaceId,
      projectId: parsed.data.projectId ?? null,
      goalId: parsed.data.goalId ?? null,
      title: parsed.data.title,
      body: parsed.data.body ?? null,
      status: parsed.data.status,
      kind: parsed.data.kind,
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
    })
    .returning();
  if (!row) return { ok: false as const, error: 'Insert failed' };
  revalidatePath('/dashboard');
  revalidatePath(`/projects/${parsed.data.projectId ?? ''}`);
  if (parsed.data.goalId) {
    revalidatePath('/goals');
    revalidatePath(`/goals/${parsed.data.goalId}`);
    revalidatePath(`/goals/${parsed.data.goalId}/board`);
  }
  return { ok: true as const, id: row.id };
}

export async function logDecisionAction(input: CreateDecisionInput) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const parsed = createDecisionSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  const db = getDb();
  const [row] = await db
    .insert(decision)
    .values({
      workspaceId: session.user.workspaceId,
      projectId: parsed.data.projectId ?? null,
      title: parsed.data.title,
      rationale: parsed.data.rationale,
      alternatives: parsed.data.alternatives,
      metadata: parsed.data.metadata,
    })
    .returning();
  if (!row) return { ok: false as const, error: 'Insert failed' };
  await db.insert(timelineEvent).values({
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
    projectId: parsed.data.projectId ?? null,
    kind: 'decision.logged',
    title: parsed.data.title,
    importance: 0.8,
  });
  revalidatePath('/timeline');
  return { ok: true as const, id: row.id };
}

// ---------------- Project edit / archive ----------------

type ProjectStatus = 'active' | 'paused' | 'archived' | 'killed';

async function ownedProject(id: string) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const db = getDb();
  const [row] = await db
    .select()
    .from(project)
    .where(and(eq(project.id, id), eq(project.workspaceId, session.user.workspaceId)))
    .limit(1);
  if (!row) return { ok: false as const, error: 'Not found' };
  return { ok: true as const, session, db, row };
}

export async function updateProjectAction(input: {
  id: string;
  name?: string;
  summary?: string | null;
  stateSummary?: string | null;
  status?: ProjectStatus;
  color?: string | null;
  stack?: string[];
  goalId?: string | null;
}) {
  const access = await ownedProject(input.id);
  if (!access.ok) return access;
  const { db, row } = access;
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.summary !== undefined) patch.summary = input.summary;
  if (input.stateSummary !== undefined) patch.stateSummary = input.stateSummary;
  if (input.status !== undefined) patch.status = input.status;
  if (input.goalId !== undefined) patch.goalId = input.goalId;
  if (input.color !== undefined || input.stack !== undefined) {
    const meta = { ...((row.metadata ?? {}) as Record<string, unknown>) };
    if (input.color !== undefined) {
      if (input.color === null) delete meta.color;
      else meta.color = input.color;
    }
    if (input.stack !== undefined) {
      if (input.stack.length === 0) delete meta.stack;
      else meta.stack = input.stack;
    }
    patch.metadata = meta;
  }
  if (Object.keys(patch).length === 0) return { ok: true as const, id: input.id };
  await db
    .update(project)
    .set(patch)
    .where(and(eq(project.id, input.id), eq(project.workspaceId, access.session.user.workspaceId)));
  revalidatePath('/projects');
  revalidatePath(`/projects/${input.id}`);
  if (input.goalId !== undefined) {
    revalidatePath('/goals');
    if (row.goalId) revalidatePath(`/goals/${row.goalId}/board`);
    if (input.goalId) revalidatePath(`/goals/${input.goalId}/board`);
    await emitPinEvent({
      workspaceId: access.session.user.workspaceId,
      userId: access.session.user.id,
      refKind: 'project',
      refId: row.id,
      refLabel: row.name,
      projectIdForTimeline: row.id,
      oldGoalId: row.goalId,
      newGoalId: input.goalId,
    });
  }
  return { ok: true as const, id: input.id };
}

export async function archiveProjectAction(id: string) {
  return updateProjectAction({ id, status: 'archived' });
}

export async function restoreProjectAction(id: string) {
  return updateProjectAction({ id, status: 'active' });
}

export async function deleteProjectAction(id: string) {
  const access = await ownedProject(id);
  if (!access.ok) return access;
  const { db, session } = access;
  await db
    .update(project)
    .set({ deletedAt: new Date() })
    .where(and(eq(project.id, id), eq(project.workspaceId, session.user.workspaceId)));
  revalidatePath('/projects');
  return { ok: true as const };
}

// ---------------- Task ----------------

type TaskStatus = 'inbox' | 'next' | 'doing' | 'blocked' | 'done' | 'dropped';
type TaskKind = 'deep' | 'shallow' | 'creative' | 'maintenance';

async function ownedTask(id: string) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const db = getDb();
  const [row] = await db
    .select()
    .from(task)
    .where(and(eq(task.id, id), eq(task.workspaceId, session.user.workspaceId)))
    .limit(1);
  if (!row) return { ok: false as const, error: 'Not found' };
  return { ok: true as const, session, db, row };
}

export async function updateTaskAction(input: {
  id: string;
  title?: string;
  body?: string | null;
  status?: TaskStatus;
  kind?: TaskKind;
  leverageScore?: number | null;
  blockedReason?: string | null;
  dueAt?: string | null;
  projectId?: string | null;
  goalId?: string | null;
}) {
  const access = await ownedTask(input.id);
  if (!access.ok) return access;
  const { db, row, session } = access;
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.body !== undefined) patch.body = input.body;
  if (input.status !== undefined) {
    patch.status = input.status;
    if (input.status === 'done' && row.status !== 'done') patch.completedAt = new Date();
    if (input.status !== 'done' && row.status === 'done') patch.completedAt = null;
  }
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.leverageScore !== undefined) patch.leverageScore = input.leverageScore;
  if (input.blockedReason !== undefined) patch.blockedReason = input.blockedReason;
  if (input.dueAt !== undefined) patch.dueAt = input.dueAt ? new Date(input.dueAt) : null;
  if (input.projectId !== undefined) patch.projectId = input.projectId;
  if (input.goalId !== undefined) patch.goalId = input.goalId;
  if (Object.keys(patch).length === 0) return { ok: true as const, id: input.id };
  await db
    .update(task)
    .set(patch)
    .where(and(eq(task.id, input.id), eq(task.workspaceId, session.user.workspaceId)));
  if (input.status === 'done' && row.status !== 'done') {
    await db.insert(timelineEvent).values({
      workspaceId: session.user.workspaceId,
      userId: session.user.id,
      projectId: row.projectId,
      kind: 'task.completed',
      title: row.title,
      payload: { taskId: row.id },
      importance: 0.6,
    });
  }
  revalidatePath('/dashboard');
  if (row.projectId) {
    revalidatePath(`/projects/${row.projectId}`);
    revalidatePath(`/projects/${row.projectId}/tasks/${row.id}`);
  }
  if (input.goalId !== undefined) {
    revalidatePath('/goals');
    if (input.goalId) revalidatePath(`/goals/${input.goalId}/board`);
    await emitPinEvent({
      workspaceId: session.user.workspaceId,
      userId: session.user.id,
      refKind: 'task',
      refId: row.id,
      refLabel: row.title,
      projectIdForTimeline: row.projectId,
      oldGoalId: row.goalId,
      newGoalId: input.goalId,
    });
  }
  return { ok: true as const, id: input.id };
}

export async function markTaskDoneAction(id: string) {
  return updateTaskAction({ id, status: 'done' });
}

export async function markTaskUndoneAction(id: string) {
  return updateTaskAction({ id, status: 'next' });
}

export async function deleteTaskAction(id: string) {
  const access = await ownedTask(id);
  if (!access.ok) return access;
  const { db, row, session } = access;
  await db
    .update(task)
    .set({ deletedAt: new Date() })
    .where(and(eq(task.id, id), eq(task.workspaceId, session.user.workspaceId)));
  revalidatePath('/dashboard');
  if (row.projectId) revalidatePath(`/projects/${row.projectId}`);
  return { ok: true as const };
}

// ---------------- Decision ----------------

async function ownedDecision(id: string) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const db = getDb();
  const [row] = await db
    .select()
    .from(decision)
    .where(and(eq(decision.id, id), eq(decision.workspaceId, session.user.workspaceId)))
    .limit(1);
  if (!row) return { ok: false as const, error: 'Not found' };
  return { ok: true as const, session, db, row };
}

export async function updateDecisionAction(input: {
  id: string;
  title?: string;
  rationale?: string;
  alternatives?: unknown[];
  projectId?: string | null;
  goalId?: string | null;
}) {
  const access = await ownedDecision(input.id);
  if (!access.ok) return access;
  const { db, row } = access;
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.rationale !== undefined) patch.rationale = input.rationale;
  if (input.alternatives !== undefined) patch.alternatives = input.alternatives;
  if (input.projectId !== undefined) patch.projectId = input.projectId;
  if (input.goalId !== undefined) patch.goalId = input.goalId;
  if (Object.keys(patch).length === 0) return { ok: true as const, id: input.id };
  await db
    .update(decision)
    .set(patch)
    .where(
      and(eq(decision.id, input.id), eq(decision.workspaceId, access.session.user.workspaceId)),
    );
  if (row.projectId) {
    revalidatePath(`/projects/${row.projectId}`);
    revalidatePath(`/projects/${row.projectId}/decisions/${row.id}`);
  }
  if (input.goalId !== undefined) {
    revalidatePath('/goals');
    if (row.goalId) revalidatePath(`/goals/${row.goalId}/board`);
    if (input.goalId) revalidatePath(`/goals/${input.goalId}/board`);
    await emitPinEvent({
      workspaceId: access.session.user.workspaceId,
      userId: access.session.user.id,
      refKind: 'decision',
      refId: row.id,
      refLabel: row.title,
      projectIdForTimeline: row.projectId,
      oldGoalId: row.goalId,
      newGoalId: input.goalId,
    });
  }
  revalidatePath('/timeline');
  return { ok: true as const, id: input.id };
}

export async function deleteDecisionAction(id: string) {
  const access = await ownedDecision(id);
  if (!access.ok) return access;
  const { db, row, session } = access;
  await db
    .update(decision)
    .set({ deletedAt: new Date() })
    .where(and(eq(decision.id, id), eq(decision.workspaceId, session.user.workspaceId)));
  if (row.projectId) revalidatePath(`/projects/${row.projectId}`);
  return { ok: true as const };
}

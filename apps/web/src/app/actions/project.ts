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
}) {
  const access = await ownedProject(input.id);
  if (!access.ok) return access;
  const { db, row } = access;
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.summary !== undefined) patch.summary = input.summary;
  if (input.stateSummary !== undefined) patch.stateSummary = input.stateSummary;
  if (input.status !== undefined) patch.status = input.status;
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
  await db.update(project).set(patch).where(eq(project.id, input.id));
  revalidatePath('/projects');
  revalidatePath(`/projects/${input.id}`);
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
  const { db } = access;
  await db.update(project).set({ deletedAt: new Date() }).where(eq(project.id, id));
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
  if (Object.keys(patch).length === 0) return { ok: true as const, id: input.id };
  await db.update(task).set(patch).where(eq(task.id, input.id));
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
  const { db, row } = access;
  await db.update(task).set({ deletedAt: new Date() }).where(eq(task.id, id));
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
}) {
  const access = await ownedDecision(input.id);
  if (!access.ok) return access;
  const { db, row } = access;
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.rationale !== undefined) patch.rationale = input.rationale;
  if (input.alternatives !== undefined) patch.alternatives = input.alternatives;
  if (input.projectId !== undefined) patch.projectId = input.projectId;
  if (Object.keys(patch).length === 0) return { ok: true as const, id: input.id };
  await db.update(decision).set(patch).where(eq(decision.id, input.id));
  if (row.projectId) {
    revalidatePath(`/projects/${row.projectId}`);
    revalidatePath(`/projects/${row.projectId}/decisions/${row.id}`);
  }
  revalidatePath('/timeline');
  return { ok: true as const, id: input.id };
}

export async function deleteDecisionAction(id: string) {
  const access = await ownedDecision(id);
  if (!access.ok) return access;
  const { db, row } = access;
  await db.update(decision).set({ deletedAt: new Date() }).where(eq(decision.id, id));
  if (row.projectId) revalidatePath(`/projects/${row.projectId}`);
  return { ok: true as const };
}

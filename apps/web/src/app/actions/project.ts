'use server';
import { revalidatePath } from 'next/cache';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { project, decision, task, timelineEvent } from '@metu/db/schema';
import {
  createDecisionSchema,
  createProjectSchema,
  createTaskSchema,
  type CreateDecisionInput,
  type CreateProjectInput,
  type CreateTaskInput,
} from '@metu/types';

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

  revalidatePath('/projects');
  revalidatePath('/dashboard');
  return { ok: true as const, id: row.id };
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

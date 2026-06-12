'use server';
/**
 * Goals + Targets server actions. All workspace-scoped via session.
 */
import { revalidatePath } from 'next/cache';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { goal, goalCheckin, goalLink, target, targetValue } from '@metu/db/schema';
import { goals } from '@metu/core';

const cadence = z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'once']);
const progressMode = z.enum([
  'manual',
  'from_tasks',
  'from_projects',
  'from_decisions',
  'from_evidence',
]);
const status = z.enum(['active', 'paused', 'achieved', 'dropped']);
const period = z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'once']);

const createGoalSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(2000).optional(),
  cadence: cadence.default('weekly'),
  progressMode: progressMode.default('manual'),
  weight: z.number().int().min(1).max(5).default(3),
  dueAt: z.string().datetime().optional(),
  projectId: z.string().uuid().optional(),
  parentGoalId: z.string().uuid().optional(),
});

export async function createGoalAction(input: z.infer<typeof createGoalSchema>) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const parsed = createGoalSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  const db = getDb();
  const [row] = await db
    .insert(goal)
    .values({
      workspaceId: session.user.workspaceId,
      userId: session.user.id,
      title: parsed.data.title,
      body: parsed.data.body ?? null,
      cadence: parsed.data.cadence,
      progressMode: parsed.data.progressMode,
      weight: parsed.data.weight,
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
      projectId: parsed.data.projectId ?? null,
      parentGoalId: parsed.data.parentGoalId ?? null,
    })
    .returning();
  revalidatePath('/goals');
  return { ok: true as const, id: row!.id };
}

const updateGoalSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  body: z.string().max(2000).nullable().optional(),
  cadence: cadence.optional(),
  progressMode: progressMode.optional(),
  status: status.optional(),
  weight: z.number().int().min(1).max(5).optional(),
  dueAt: z.string().datetime().nullable().optional(),
});

export async function updateGoalAction(input: z.infer<typeof updateGoalSchema>) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const parsed = updateGoalSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  const db = getDb();
  const patch: Record<string, unknown> = {};
  for (const k of ['title', 'body', 'cadence', 'progressMode', 'status', 'weight'] as const) {
    const v = parsed.data[k];
    if (v !== undefined) patch[k] = v;
  }
  if (parsed.data.dueAt !== undefined) {
    patch.dueAt = parsed.data.dueAt ? new Date(parsed.data.dueAt) : null;
  }
  if (parsed.data.status === 'achieved') patch.achievedAt = new Date();
  await db
    .update(goal)
    .set(patch)
    .where(and(eq(goal.id, parsed.data.id), eq(goal.workspaceId, session.user.workspaceId)));
  revalidatePath('/goals');
  return { ok: true as const };
}

export async function deleteGoalAction(id: string) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const db = getDb();
  await db
    .update(goal)
    .set({ deletedAt: new Date(), status: 'dropped' })
    .where(and(eq(goal.id, id), eq(goal.workspaceId, session.user.workspaceId)));
  revalidatePath('/goals');
  return { ok: true as const };
}

const checkinSchema = z.object({
  goalId: z.string().uuid(),
  progress: z.number().min(0).max(1),
  note: z.string().max(500).optional(),
});

export async function recordCheckinAction(input: z.infer<typeof checkinSchema>) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const parsed = checkinSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  const db = getDb();
  await db.insert(goalCheckin).values({
    workspaceId: session.user.workspaceId,
    goalId: parsed.data.goalId,
    progress: parsed.data.progress,
    note: parsed.data.note ?? null,
    createdBy: 'user',
  });
  await db
    .update(goal)
    .set({ progress: parsed.data.progress, lastProgressAt: new Date() })
    .where(and(eq(goal.id, parsed.data.goalId), eq(goal.workspaceId, session.user.workspaceId)));
  revalidatePath('/goals');
  return { ok: true as const };
}

const linkGoalSchema = z.object({
  goalId: z.string().uuid(),
  refKind: z.enum(['task', 'capture', 'message', 'timeline', 'project']),
  refId: z.string().uuid(),
  note: z.string().max(200).optional(),
});

export async function linkGoalEvidenceAction(input: z.infer<typeof linkGoalSchema>) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const parsed = linkGoalSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  const db = getDb();
  await db
    .insert(goalLink)
    .values({
      workspaceId: session.user.workspaceId,
      goalId: parsed.data.goalId,
      refKind: parsed.data.refKind,
      refId: parsed.data.refId,
      note: parsed.data.note ?? null,
    })
    .onConflictDoNothing();
  revalidatePath('/goals');
  return { ok: true as const };
}

const createTargetSchema = z.object({
  title: z.string().min(1).max(200),
  unit: z.string().max(20).default(''),
  targetValue: z.number(),
  period: period.default('monthly'),
  goalId: z.string().uuid().optional(),
  aggregation: z.enum(['sum', 'avg', 'last', 'max']).default('sum'),
});

export async function createTargetAction(input: z.infer<typeof createTargetSchema>) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const parsed = createTargetSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  const db = getDb();
  const [row] = await db
    .insert(target)
    .values({
      workspaceId: session.user.workspaceId,
      title: parsed.data.title,
      unit: parsed.data.unit,
      targetValue: parsed.data.targetValue,
      period: parsed.data.period,
      goalId: parsed.data.goalId ?? null,
      aggregation: parsed.data.aggregation,
    })
    .returning();
  revalidatePath('/goals');
  return { ok: true as const, id: row!.id };
}

const recordValueSchema = z.object({
  targetId: z.string().uuid(),
  value: z.number(),
  source: z.string().max(40).default('manual'),
  note: z.string().max(500).optional(),
});

export async function recordTargetValueAction(input: z.infer<typeof recordValueSchema>) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const parsed = recordValueSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  const db = getDb();
  await db.insert(targetValue).values({
    workspaceId: session.user.workspaceId,
    targetId: parsed.data.targetId,
    value: parsed.data.value,
    source: parsed.data.source,
    note: parsed.data.note ?? null,
  });
  // Naive rollup: refresh currentValue based on aggregation.
  const [t] = await db
    .select()
    .from(target)
    .where(
      and(eq(target.id, parsed.data.targetId), eq(target.workspaceId, session.user.workspaceId)),
    )
    .limit(1);
  if (t) {
    const all = await db
      .select({ value: targetValue.value })
      .from(targetValue)
      .where(eq(targetValue.targetId, parsed.data.targetId));
    const values = all.map((r) => Number(r.value));
    let current = 0;
    if (values.length > 0) {
      switch (t.aggregation) {
        case 'avg':
          current = values.reduce((a, b) => a + b, 0) / values.length;
          break;
        case 'last':
          current = values[values.length - 1]!;
          break;
        case 'max':
          current = Math.max(...values);
          break;
        default:
          current = values.reduce((a, b) => a + b, 0);
      }
    }
    await db.update(target).set({ currentValue: current }).where(eq(target.id, t.id));
  }
  revalidatePath('/goals');
  return { ok: true as const };
}

export async function reviewGoalsAction() {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const out = await goals.reviewGoals(session.user.workspaceId);
  revalidatePath('/goals');
  return { ok: true as const, results: out };
}

// ────────────── Bulk + target editing extensions ──────────────

export async function archiveGoalAction(id: string) {
  return updateGoalAction({ id, status: 'achieved' });
}

export async function bulkUpdateGoalStatusAction(input: {
  ids: string[];
  status: 'active' | 'paused' | 'achieved' | 'dropped';
}) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  if (input.ids.length === 0) return { ok: true as const, count: 0 };
  const db = getDb();
  const patch: Record<string, unknown> = { status: input.status };
  if (input.status === 'achieved') patch.achievedAt = new Date();
  const updated = await db
    .update(goal)
    .set(patch)
    .where(and(inArray(goal.id, input.ids), eq(goal.workspaceId, session.user.workspaceId)))
    .returning();
  revalidatePath('/goals');
  return { ok: true as const, count: updated.length };
}

export async function bulkDeleteGoalsAction(ids: string[]) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  if (ids.length === 0) return { ok: true as const, count: 0 };
  const db = getDb();
  const deleted = await db
    .update(goal)
    .set({ deletedAt: new Date(), status: 'dropped' })
    .where(and(inArray(goal.id, ids), eq(goal.workspaceId, session.user.workspaceId)))
    .returning();
  revalidatePath('/goals');
  return { ok: true as const, count: deleted.length };
}

const updateTargetSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  unit: z.string().max(20).optional(),
  targetValue: z.number().optional(),
  period: period.optional(),
  goalId: z.string().uuid().nullable().optional(),
  aggregation: z.enum(['sum', 'avg', 'last', 'max']).optional(),
  status: status.optional(),
});

export async function updateTargetAction(input: z.infer<typeof updateTargetSchema>) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const parsed = updateTargetSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  const db = getDb();
  const patch: Record<string, unknown> = {};
  for (const k of ['title', 'unit', 'targetValue', 'period', 'aggregation', 'status'] as const) {
    const v = parsed.data[k];
    if (v !== undefined) patch[k] = v;
  }
  if (parsed.data.goalId !== undefined) patch.goalId = parsed.data.goalId;
  await db
    .update(target)
    .set(patch)
    .where(and(eq(target.id, parsed.data.id), eq(target.workspaceId, session.user.workspaceId)));
  revalidatePath('/goals');
  return { ok: true as const };
}

export async function deleteTargetAction(id: string) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const db = getDb();
  await db
    .update(target)
    .set({ deletedAt: new Date() })
    .where(and(eq(target.id, id), eq(target.workspaceId, session.user.workspaceId)));
  revalidatePath('/goals');
  return { ok: true as const };
}

export async function deleteCheckinAction(id: string) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const db = getDb();
  await db
    .delete(goalCheckin)
    .where(and(eq(goalCheckin.id, id), eq(goalCheckin.workspaceId, session.user.workspaceId)));
  revalidatePath('/goals');
  return { ok: true as const };
}

export async function deleteTargetValueAction(id: string) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const db = getDb();
  // Need to recompute current value after delete — get target first
  const [val] = await db
    .select()
    .from(targetValue)
    .where(and(eq(targetValue.id, id), eq(targetValue.workspaceId, session.user.workspaceId)))
    .limit(1);
  if (!val) return { ok: true as const };
  await db.delete(targetValue).where(eq(targetValue.id, id));
  // recompute
  const [t] = await db
    .select()
    .from(target)
    .where(and(eq(target.id, val.targetId), eq(target.workspaceId, session.user.workspaceId)))
    .limit(1);
  if (t) {
    const all = await db
      .select({ value: targetValue.value })
      .from(targetValue)
      .where(eq(targetValue.targetId, val.targetId));
    const values = all.map((r) => Number(r.value));
    let current = 0;
    if (values.length > 0) {
      switch (t.aggregation) {
        case 'avg':
          current = values.reduce((a, b) => a + b, 0) / values.length;
          break;
        case 'last':
          current = values[values.length - 1]!;
          break;
        case 'max':
          current = Math.max(...values);
          break;
        default:
          current = values.reduce((a, b) => a + b, 0);
      }
    }
    await db.update(target).set({ currentValue: current }).where(eq(target.id, t.id));
  }
  revalidatePath('/goals');
  return { ok: true as const };
}

export async function unlinkGoalEvidenceAction(linkId: string) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const db = getDb();
  await db
    .delete(goalLink)
    .where(and(eq(goalLink.id, linkId), eq(goalLink.workspaceId, session.user.workspaceId)));
  revalidatePath('/goals');
  return { ok: true as const };
}

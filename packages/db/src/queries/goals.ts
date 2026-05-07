import { and, desc, eq, isNull, sql, type SQL, asc } from 'drizzle-orm';
import { getDb } from '../client';
import { goal, goalCheckin, goalLink, target, targetValue } from '../schema';

export interface ListGoalsParams {
  workspaceId: string;
  status?: string | null;
  drift?: string | null;
  cadence?: string | null;
  sort?: 'weight' | 'progress' | 'recent' | 'due' | null;
}

export async function listGoalsFiltered({
  workspaceId,
  status = null,
  drift = null,
  cadence = null,
  sort = 'weight',
}: ListGoalsParams) {
  const db = getDb();
  const filters: SQL[] = [eq(goal.workspaceId, workspaceId), isNull(goal.deletedAt)];
  if (status) filters.push(sql`${goal.status}::text = ${status}`);
  if (drift) filters.push(sql`${goal.drift}::text = ${drift}`);
  if (cadence) filters.push(sql`${goal.cadence}::text = ${cadence}`);
  const order =
    sort === 'progress'
      ? [desc(goal.progress), desc(goal.updatedAt)]
      : sort === 'recent'
        ? [desc(goal.updatedAt)]
        : sort === 'due'
          ? [asc(goal.dueAt), desc(goal.weight)]
          : [desc(goal.weight), desc(goal.updatedAt)];
  return db
    .select()
    .from(goal)
    .where(and(...filters))
    .orderBy(...order);
}

export async function goalFacets(workspaceId: string) {
  const db = getDb();
  const [byStatus, byDrift] = await Promise.all([
    db
      .select({ value: goal.status, count: sql<number>`count(*)::int` })
      .from(goal)
      .where(and(eq(goal.workspaceId, workspaceId), isNull(goal.deletedAt)))
      .groupBy(goal.status),
    db
      .select({ value: goal.drift, count: sql<number>`count(*)::int` })
      .from(goal)
      .where(and(eq(goal.workspaceId, workspaceId), isNull(goal.deletedAt)))
      .groupBy(goal.drift),
  ]);
  return { status: byStatus, drift: byDrift };
}

export async function getGoalById(workspaceId: string, goalId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(goal)
    .where(and(eq(goal.id, goalId), eq(goal.workspaceId, workspaceId), isNull(goal.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listSubGoals(workspaceId: string, parentGoalId: string) {
  const db = getDb();
  return db
    .select()
    .from(goal)
    .where(
      and(
        eq(goal.workspaceId, workspaceId),
        eq(goal.parentGoalId, parentGoalId),
        isNull(goal.deletedAt),
      ),
    )
    .orderBy(desc(goal.weight), desc(goal.updatedAt));
}

export async function listGoalCheckins(workspaceId: string, goalId: string, limit = 60) {
  const db = getDb();
  return db
    .select()
    .from(goalCheckin)
    .where(and(eq(goalCheckin.workspaceId, workspaceId), eq(goalCheckin.goalId, goalId)))
    .orderBy(desc(goalCheckin.occurredAt))
    .limit(limit);
}

export async function listGoalEvidence(workspaceId: string, goalId: string) {
  const db = getDb();
  return db
    .select()
    .from(goalLink)
    .where(and(eq(goalLink.workspaceId, workspaceId), eq(goalLink.goalId, goalId)))
    .orderBy(desc(goalLink.addedAt));
}

export async function listGoalTargets(workspaceId: string, goalId: string) {
  const db = getDb();
  return db
    .select()
    .from(target)
    .where(
      and(eq(target.workspaceId, workspaceId), eq(target.goalId, goalId), isNull(target.deletedAt)),
    )
    .orderBy(desc(target.updatedAt));
}

export async function listTargetsFiltered(workspaceId: string, status?: string | null) {
  const db = getDb();
  const filters: SQL[] = [eq(target.workspaceId, workspaceId), isNull(target.deletedAt)];
  if (status) filters.push(sql`${target.status}::text = ${status}`);
  return db
    .select()
    .from(target)
    .where(and(...filters))
    .orderBy(desc(target.updatedAt));
}

export async function getTargetById(workspaceId: string, targetId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(target)
    .where(
      and(eq(target.id, targetId), eq(target.workspaceId, workspaceId), isNull(target.deletedAt)),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listTargetValues(workspaceId: string, targetId: string, limit = 100) {
  const db = getDb();
  return db
    .select()
    .from(targetValue)
    .where(and(eq(targetValue.workspaceId, workspaceId), eq(targetValue.targetId, targetId)))
    .orderBy(desc(targetValue.recordedAt))
    .limit(limit);
}

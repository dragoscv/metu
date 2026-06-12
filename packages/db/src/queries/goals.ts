import { and, desc, eq, inArray, isNull, sql, type SQL, asc } from 'drizzle-orm';
import { getDb } from '../client';
import {
  decision,
  goal,
  goalCheckin,
  goalLink,
  project,
  target,
  targetValue,
  task,
} from '../schema';

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

/** Tasks owned directly by a goal (task.goal_id = goalId). Distinct from
 *  evidence-linked tasks via goal_link, which represent looser association. */
export async function listGoalDirectTasks(workspaceId: string, goalId: string) {
  const db = getDb();
  return db
    .select()
    .from(task)
    .where(and(eq(task.workspaceId, workspaceId), eq(task.goalId, goalId), isNull(task.deletedAt)))
    .orderBy(desc(task.updatedAt));
}

/** Projects pinned directly to a goal (project.goal_id = goalId). */
export async function listGoalDirectProjects(workspaceId: string, goalId: string) {
  const db = getDb();
  return db
    .select({
      id: project.id,
      name: project.name,
      slug: project.slug,
      summary: project.summary,
      status: project.status,
      momentumScore: project.momentumScore,
      lastMeaningfulActivityAt: project.lastMeaningfulActivityAt,
    })
    .from(project)
    .where(
      and(
        eq(project.workspaceId, workspaceId),
        eq(project.goalId, goalId),
        isNull(project.deletedAt),
      ),
    )
    .orderBy(desc(project.momentumScore), desc(project.updatedAt));
}

/** Decisions pinned directly to a goal (decision.goal_id = goalId). */
export async function listGoalDirectDecisions(workspaceId: string, goalId: string) {
  const db = getDb();
  return db
    .select({
      id: decision.id,
      title: decision.title,
      rationale: decision.rationale,
      decidedAt: decision.decidedAt,
      projectId: decision.projectId,
    })
    .from(decision)
    .where(
      and(
        eq(decision.workspaceId, workspaceId),
        eq(decision.goalId, goalId),
        isNull(decision.deletedAt),
      ),
    )
    .orderBy(desc(decision.decidedAt));
}

/** Aggregate counts of pinned tasks/projects/decisions for many goals at once.
 *  Used on the goals listing page to render small badges per goal. */
export async function goalPinnedCounts(
  workspaceId: string,
  goalIds: string[],
): Promise<Map<string, { tasks: number; projects: number; decisions: number }>> {
  const map = new Map<string, { tasks: number; projects: number; decisions: number }>();
  if (goalIds.length === 0) return map;
  const db = getDb();
  const [tasks, projects, decisions] = await Promise.all([
    db
      .select({ goalId: task.goalId, n: sql<number>`count(*)::int` })
      .from(task)
      .where(
        and(
          eq(task.workspaceId, workspaceId),
          isNull(task.deletedAt),
          inArray(task.goalId, goalIds),
        ),
      )
      .groupBy(task.goalId),
    db
      .select({ goalId: project.goalId, n: sql<number>`count(*)::int` })
      .from(project)
      .where(
        and(
          eq(project.workspaceId, workspaceId),
          isNull(project.deletedAt),
          inArray(project.goalId, goalIds),
        ),
      )
      .groupBy(project.goalId),
    db
      .select({ goalId: decision.goalId, n: sql<number>`count(*)::int` })
      .from(decision)
      .where(
        and(
          eq(decision.workspaceId, workspaceId),
          isNull(decision.deletedAt),
          inArray(decision.goalId, goalIds),
        ),
      )
      .groupBy(decision.goalId),
  ]);
  const ensure = (id: string) => {
    let v = map.get(id);
    if (!v) {
      v = { tasks: 0, projects: 0, decisions: 0 };
      map.set(id, v);
    }
    return v;
  };
  for (const r of tasks) if (r.goalId) ensure(r.goalId).tasks = Number(r.n);
  for (const r of projects) if (r.goalId) ensure(r.goalId).projects = Number(r.n);
  for (const r of decisions) if (r.goalId) ensure(r.goalId).decisions = Number(r.n);
  return map;
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

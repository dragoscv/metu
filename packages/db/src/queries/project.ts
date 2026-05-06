import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '../client';
import { project, task, decision } from '../schema';

export async function listProjects(workspaceId: string) {
  const db = getDb();
  return db
    .select()
    .from(project)
    .where(and(eq(project.workspaceId, workspaceId), isNull(project.deletedAt)))
    .orderBy(desc(project.momentumScore), desc(project.updatedAt));
}

export async function getProject(workspaceId: string, projectId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(project)
    .where(
      and(
        eq(project.id, projectId),
        eq(project.workspaceId, workspaceId),
        isNull(project.deletedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getProjectMomentum(workspaceId: string) {
  const db = getDb();
  return db
    .select({
      id: project.id,
      name: project.name,
      momentumScore: project.momentumScore,
      lastMeaningfulActivityAt: project.lastMeaningfulActivityAt,
      status: project.status,
    })
    .from(project)
    .where(and(eq(project.workspaceId, workspaceId), isNull(project.deletedAt)))
    .orderBy(desc(project.momentumScore));
}

export async function listOpenTasks(workspaceId: string) {
  const db = getDb();
  return db
    .select()
    .from(task)
    .where(
      and(
        eq(task.workspaceId, workspaceId),
        isNull(task.deletedAt),
        sql`${task.status} not in ('done','dropped')`,
      ),
    )
    .orderBy(desc(task.leverageScore), desc(task.updatedAt));
}

export async function listBlockedTasks(workspaceId: string) {
  const db = getDb();
  return db
    .select()
    .from(task)
    .where(
      and(eq(task.workspaceId, workspaceId), eq(task.status, 'blocked'), isNull(task.deletedAt)),
    )
    .orderBy(desc(task.updatedAt));
}

export async function recentDecisions(workspaceId: string, limit = 10) {
  const db = getDb();
  return db
    .select()
    .from(decision)
    .where(and(eq(decision.workspaceId, workspaceId), isNull(decision.deletedAt)))
    .orderBy(desc(decision.decidedAt))
    .limit(limit);
}

/**
 * Weekly review queries — aggregate the last N days of activity for the
 * "where am I, what did I do, what's next" surface.
 */
import { and, between, count, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '../client';
import { capture, goal, project, task, timelineEvent, toolCall } from '../schema';

export interface WeeklyReviewSummary {
  windowDays: number;
  startedAt: Date;
  endedAt: Date;
  captures: number;
  toolCalls: number;
  toolCallsFailed: number;
  toolCallsCost: number;
  tasksCompleted: number;
  projectsTouched: number;
  goalsActive: number;
  goalsAchieved: number;
  topKinds: { kind: string; count: number }[];
  topProjects: { id: string; name: string; events: number }[];
}

export async function weeklyReviewSummary(
  workspaceId: string,
  windowDays = 7,
): Promise<WeeklyReviewSummary> {
  const db = getDb();
  const endedAt = new Date();
  const startedAt = new Date(endedAt.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const [
    [capturesRow],
    [callsRow],
    [tasksRow],
    [projectsRow],
    [goalsActiveRow],
    [goalsAchievedRow],
    kindRows,
    projectRows,
  ] = await Promise.all([
    db
      .select({ n: count() })
      .from(capture)
      .where(
        and(
          eq(capture.workspaceId, workspaceId),
          between(capture.capturedAt, startedAt, endedAt),
        ),
      ),
    db
      .select({
        n: count(),
        failed: sql<number>`count(*) filter (where ${toolCall.status} = 'failed')::int`,
        cost: sql<number>`coalesce(sum(${toolCall.actualCostUsd}), 0)::float`,
      })
      .from(toolCall)
      .where(
        and(
          eq(toolCall.workspaceId, workspaceId),
          between(toolCall.requestedAt, startedAt, endedAt),
        ),
      ),
    db
      .select({ n: count() })
      .from(task)
      .where(
        and(
          eq(task.workspaceId, workspaceId),
          eq(task.status, 'done'),
          between(task.updatedAt, startedAt, endedAt),
        ),
      ),
    db
      .select({ n: sql<number>`count(distinct ${timelineEvent.projectId})::int` })
      .from(timelineEvent)
      .where(
        and(
          eq(timelineEvent.workspaceId, workspaceId),
          between(timelineEvent.occurredAt, startedAt, endedAt),
        ),
      ),
    db
      .select({ n: count() })
      .from(goal)
      .where(and(eq(goal.workspaceId, workspaceId), eq(goal.status, 'active'))),
    db
      .select({ n: count() })
      .from(goal)
      .where(
        and(
          eq(goal.workspaceId, workspaceId),
          eq(goal.status, 'achieved'),
          gte(goal.achievedAt, startedAt),
        ),
      ),
    db
      .select({ kind: timelineEvent.kind, n: count() })
      .from(timelineEvent)
      .where(
        and(
          eq(timelineEvent.workspaceId, workspaceId),
          between(timelineEvent.occurredAt, startedAt, endedAt),
        ),
      )
      .groupBy(timelineEvent.kind)
      .orderBy(desc(count()))
      .limit(6),
    db
      .select({
        id: project.id,
        name: project.name,
        events: sql<number>`count(${timelineEvent.id})::int`,
      })
      .from(timelineEvent)
      .innerJoin(project, eq(project.id, timelineEvent.projectId))
      .where(
        and(
          eq(timelineEvent.workspaceId, workspaceId),
          between(timelineEvent.occurredAt, startedAt, endedAt),
        ),
      )
      .groupBy(project.id, project.name)
      .orderBy(desc(sql`count(${timelineEvent.id})`))
      .limit(5),
  ]);

  return {
    windowDays,
    startedAt,
    endedAt,
    captures: Number(capturesRow?.n ?? 0),
    toolCalls: Number(callsRow?.n ?? 0),
    toolCallsFailed: Number(callsRow?.failed ?? 0),
    toolCallsCost: Number(callsRow?.cost ?? 0),
    tasksCompleted: Number(tasksRow?.n ?? 0),
    projectsTouched: Number(projectsRow?.n ?? 0),
    goalsActive: Number(goalsActiveRow?.n ?? 0),
    goalsAchieved: Number(goalsAchievedRow?.n ?? 0),
    topKinds: kindRows.map((r) => ({ kind: r.kind, count: Number(r.n) })),
    topProjects: projectRows.map((r) => ({
      id: r.id,
      name: r.name,
      events: Number(r.events),
    })),
  };
}

/**
 * Goal review engine.
 *
 * `reviewGoals(workspaceId)` recomputes progress + drift for every active goal
 * and writes the result back to the `goal` row. Returns the rows that need
 * user attention (drift !== 'on_track') so the caller can fan out notifications.
 *
 * Progress modes:
 *   manual         → latest goal_checkin's progress.
 *   from_tasks     → completed_count / total_count among linked tasks.
 *   from_evidence  → bucketed activity score on linked entities + recent
 *                    timeline events touching the goal's tags/keywords.
 *
 * Drift heuristic (cadence-aware):
 *   on_track  → progress advanced within the cadence window OR deadline far away.
 *   slipping  → no advance in 1× cadence window AND deadline within 2× cadence.
 *   stalled   → no advance in 2× cadence windows OR deadline overdue.
 */
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { goal, goalCheckin, goalLink, task, timelineEvent } from '@metu/db/schema';

export type Drift = 'on_track' | 'slipping' | 'stalled';
export type Cadence = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'once';
export type ProgressMode = 'manual' | 'from_tasks' | 'from_evidence';

const CADENCE_DAYS: Record<Cadence, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
  quarterly: 91,
  once: 30, // fallback window for goals with no cadence
};

interface GoalRow {
  id: string;
  title: string;
  cadence: Cadence;
  progressMode: ProgressMode;
  weight: number;
  dueAt: Date | null;
  lastProgressAt: Date | null;
  progress: number;
}

export interface ReviewResult {
  goalId: string;
  title: string;
  weight: number;
  progress: number;
  drift: Drift;
  changed: boolean;
  /** Conductor-friendly suggestion for the next concrete step. */
  nudge?: string;
}

export async function reviewGoals(workspaceId: string): Promise<ReviewResult[]> {
  const db = getDb();
  const rows = (await db
    .select({
      id: goal.id,
      title: goal.title,
      cadence: goal.cadence,
      progressMode: goal.progressMode,
      weight: goal.weight,
      dueAt: goal.dueAt,
      lastProgressAt: goal.lastProgressAt,
      progress: goal.progress,
    })
    .from(goal)
    .where(and(eq(goal.workspaceId, workspaceId), eq(goal.status, 'active')))) as GoalRow[];

  const results: ReviewResult[] = [];
  const now = new Date();

  for (const g of rows) {
    const next = await computeProgress(workspaceId, g);
    const drift = classifyDrift(g, next.progress, now);
    const changed = next.progress !== g.progress || drift !== 'on_track';

    await db
      .update(goal)
      .set({
        progress: next.progress,
        drift,
        lastReviewAt: now,
        lastProgressAt: next.progress > g.progress ? now : g.lastProgressAt,
      })
      .where(eq(goal.id, g.id));

    results.push({
      goalId: g.id,
      title: g.title,
      weight: g.weight,
      progress: next.progress,
      drift,
      changed,
      nudge: next.nudge,
    });
  }

  return results;
}

async function computeProgress(
  workspaceId: string,
  g: GoalRow,
): Promise<{ progress: number; nudge?: string }> {
  const db = getDb();
  switch (g.progressMode) {
    case 'manual': {
      const [latest] = await db
        .select({ progress: goalCheckin.progress })
        .from(goalCheckin)
        .where(eq(goalCheckin.goalId, g.id))
        .orderBy(desc(goalCheckin.occurredAt))
        .limit(1);
      return {
        progress: clamp01(latest?.progress ?? 0),
        nudge: latest ? undefined : `Log a quick check-in for "${g.title}".`,
      };
    }
    case 'from_tasks': {
      // Linked tasks via goal_link.
      const [counts] = await db
        .select({
          total: sql<number>`count(*)::int`,
          done: sql<number>`count(*) filter (where ${task.status} = 'done')::int`,
        })
        .from(goalLink)
        .innerJoin(task, eq(task.id, goalLink.refId))
        .where(and(eq(goalLink.goalId, g.id), eq(goalLink.refKind, 'task')));
      const total = Number(counts?.total ?? 0);
      const done = Number(counts?.done ?? 0);
      if (total === 0) {
        return {
          progress: 0,
          nudge: `Link some tasks to "${g.title}" so progress can be tracked.`,
        };
      }
      return { progress: clamp01(done / total) };
    }
    case 'from_evidence': {
      // Heuristic: activity in last cadence window on linked entities + raw
      // timeline events tagged with this goal id. Capped at 1.0.
      const sinceMs = Date.now() - CADENCE_DAYS[g.cadence] * 24 * 3600 * 1000;
      const since = new Date(sinceMs);
      const [linkActivity] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(goalLink)
        .where(and(eq(goalLink.goalId, g.id), gte(goalLink.addedAt, since)));
      const [tlActivity] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(timelineEvent)
        .where(
          and(
            eq(timelineEvent.workspaceId, workspaceId),
            gte(timelineEvent.occurredAt, since),
            sql`${timelineEvent.payload}->>'goalId' = ${g.id}`,
          ),
        );
      const score = Number(linkActivity?.n ?? 0) * 0.1 + Number(tlActivity?.n ?? 0) * 0.05;
      return {
        progress: clamp01(g.progress + score),
        nudge: score === 0 ? `No activity yet this period for "${g.title}".` : undefined,
      };
    }
  }
}

function classifyDrift(g: GoalRow, progress: number, now: Date): Drift {
  if (progress >= 1) return 'on_track';
  const cadenceMs = CADENCE_DAYS[g.cadence] * 24 * 3600 * 1000;
  const lastProg = g.lastProgressAt?.getTime() ?? 0;
  const sinceProgressMs = now.getTime() - lastProg;
  const overdue = g.dueAt && g.dueAt < now;
  if (overdue) return 'stalled';
  if (lastProg === 0) {
    // No progress recorded ever — treat by age of goal-via-due-date proximity only.
    if (g.dueAt && g.dueAt.getTime() - now.getTime() < 2 * cadenceMs) return 'slipping';
    return 'on_track';
  }
  if (sinceProgressMs > 2 * cadenceMs) return 'stalled';
  if (sinceProgressMs > cadenceMs) return 'slipping';
  return 'on_track';
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

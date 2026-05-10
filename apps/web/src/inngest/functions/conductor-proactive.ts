/**
 * Proactive Conductor triggers.
 *
 * Most ticks come from user actions (capture, escalation, approval) but
 * the supervisor's job is to also nudge the user about *absence* of
 * activity. Three triggers run on a 6-hour cadence:
 *
 *   1. **Stale active project** — `lastMeaningfulActivityAt` older than
 *      `STALE_PROJECT_DAYS`. Conductor proposes a brief check-in.
 *   2. **Approaching goal deadline** — `goal.dueAt` within
 *      `DEADLINE_LOOKAHEAD_DAYS` and progress < 0.8. Surfaces the gap.
 *   3. **Stalled goal** — drift = 'stalled' or progress hasn't moved in
 *      `GOAL_STALL_DAYS`. Conductor asks "still on this?".
 *
 * Each trigger fans out into one `conductor/tick` per workspace, with
 * a deduplication memory (we only re-trigger once per N hours per
 * subject) implemented via the existing `timeline_event` table — we
 * scan for a matching `conductor.proactive.*` row in the recent past.
 */
import { and, desc, eq, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { goal, project, timelineEvent } from '@metu/db/schema';
import { inngest } from '../client';
import { log } from '@/lib/logger';

const STALE_PROJECT_DAYS = 5;
const DEADLINE_LOOKAHEAD_DAYS = 7;
const GOAL_STALL_DAYS = 10;
/** Minimum gap between two proactive ticks for the same subject. */
const COOLDOWN_HOURS = 18;

type Candidate = {
  workspaceId: string;
  subject: string;
  reason: string;
};

async function notRecentlyTriggered(workspaceId: string, subject: string): Promise<boolean> {
  const db = getDb();
  const cutoff = new Date(Date.now() - COOLDOWN_HOURS * 60 * 60 * 1000);
  const [hit] = await db
    .select({ id: timelineEvent.id })
    .from(timelineEvent)
    .where(
      and(
        eq(timelineEvent.workspaceId, workspaceId),
        eq(timelineEvent.kind, 'conductor.proactive.trigger'),
        // Match the subject we recorded last time.
        sql`${timelineEvent.payload}->>'subject' = ${subject}`,
        sql`${timelineEvent.occurredAt} > ${cutoff.toISOString()}`,
      ),
    )
    .orderBy(desc(timelineEvent.occurredAt))
    .limit(1);
  return !hit;
}

export const conductorProactiveCron = inngest.createFunction(
  {
    id: 'conductor-proactive-cron',
    name: 'Conductor proactive triggers',
    concurrency: { limit: 2 },
  },
  { cron: '0 */6 * * *' },
  async ({ step }) => {
    const candidates = await step.run('scan', async () => {
      const db = getDb();
      const now = new Date();
      const staleCutoff = new Date(now.getTime() - STALE_PROJECT_DAYS * 24 * 60 * 60 * 1000);
      const stallCutoff = new Date(now.getTime() - GOAL_STALL_DAYS * 24 * 60 * 60 * 1000);
      const deadlineCutoff = new Date(
        now.getTime() + DEADLINE_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000,
      );

      const [staleProjects, dueGoals, stalledGoals] = await Promise.all([
        db
          .select({ workspaceId: project.workspaceId, id: project.id, name: project.name })
          .from(project)
          .where(
            and(
              eq(project.status, 'active'),
              isNull(project.deletedAt),
              or(
                isNull(project.lastMeaningfulActivityAt),
                lt(project.lastMeaningfulActivityAt, staleCutoff),
              ),
            ),
          )
          .limit(200),
        db
          .select({
            workspaceId: goal.workspaceId,
            id: goal.id,
            title: goal.title,
            dueAt: goal.dueAt,
            progress: goal.progress,
          })
          .from(goal)
          .where(
            and(
              eq(goal.status, 'active'),
              isNull(goal.deletedAt),
              isNotNull(goal.dueAt),
              lte(goal.dueAt, deadlineCutoff),
              lt(goal.progress, 0.8),
            ),
          )
          .limit(200),
        db
          .select({ workspaceId: goal.workspaceId, id: goal.id, title: goal.title })
          .from(goal)
          .where(
            and(
              eq(goal.status, 'active'),
              isNull(goal.deletedAt),
              or(
                eq(goal.drift, 'stalled'),
                and(isNotNull(goal.lastProgressAt), lt(goal.lastProgressAt, stallCutoff)),
              ),
            ),
          )
          .limit(200),
      ]);

      const out: Candidate[] = [];
      for (const p of staleProjects) {
        out.push({
          workspaceId: p.workspaceId,
          subject: `project:${p.id}`,
          reason: `stale-project: "${p.name}" idle ≥ ${STALE_PROJECT_DAYS}d`,
        });
      }
      for (const g of dueGoals) {
        const days = Math.max(
          0,
          Math.round(((g.dueAt as Date).getTime() - now.getTime()) / (24 * 3600 * 1000)),
        );
        out.push({
          workspaceId: g.workspaceId,
          subject: `goal-deadline:${g.id}`,
          reason: `goal-deadline: "${g.title}" due in ${days}d, progress ${(g.progress * 100).toFixed(0)}%`,
        });
      }
      for (const g of stalledGoals) {
        out.push({
          workspaceId: g.workspaceId,
          subject: `goal-stall:${g.id}`,
          reason: `goal-stall: "${g.title}" hasn't moved in ${GOAL_STALL_DAYS}d`,
        });
      }
      return out;
    });

    if (candidates.length === 0) {
      log.info('conductor.proactive.cron.empty', {});
      return { ok: true, dispatched: 0 };
    }

    // Deduplicate against the recent timeline so we don't nag.
    const fresh = await step.run('dedupe', async () => {
      const out: Candidate[] = [];
      for (const c of candidates) {
        if (await notRecentlyTriggered(c.workspaceId, c.subject)) out.push(c);
      }
      return out;
    });

    if (fresh.length === 0) {
      log.info('conductor.proactive.cron.all_throttled', {
        candidates: candidates.length,
      });
      return { ok: true, dispatched: 0, throttled: candidates.length };
    }

    await step.run('record', async () => {
      const db = getDb();
      await db.insert(timelineEvent).values(
        fresh.map((c) => ({
          workspaceId: c.workspaceId,
          kind: 'conductor.proactive.trigger',
          title: c.reason,
          payload: { subject: c.subject, reason: c.reason },
          importance: 2,
        })),
      );
    });

    await step.sendEvent(
      'fan-out-ticks',
      fresh.map((c) => ({
        name: 'conductor/tick' as const,
        data: { workspaceId: c.workspaceId, reason: `proactive: ${c.reason}` },
      })),
    );

    log.info('conductor.proactive.cron.dispatched', {
      total: fresh.length,
      throttled: candidates.length - fresh.length,
    });

    return { ok: true, dispatched: fresh.length };
  },
);

/**
 * Idle-workspace nudge.
 *
 * Most users dip in and out of metu — but if a workspace has no
 * captures for several hours during the user's active window, the
 * Conductor should gently remind them where they left off.
 *
 * Cadence: every 4h. Triggers when a workspace has at least one
 * capture in the last `RECENTLY_ACTIVE_DAYS` (i.e. it's not abandoned)
 * but no capture in the last `IDLE_HOURS`. Cooldown of 24h via
 * `timeline_event` so we never nag more than once a day.
 *
 * The proactive Conductor handler does the actual LLM work; this cron
 * just decides which workspaces deserve a `conductor/tick` with a
 * dedicated reason. That keeps cost predictable (one tick per workspace
 * per day at most) and the LLM logic centralized.
 */
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { capture, timelineEvent } from '@metu/db/schema';
import { inngest } from '../client';
import { log } from '@/lib/logger';

const IDLE_HOURS = 4;
const RECENTLY_ACTIVE_DAYS = 14;
const COOLDOWN_HOURS = 24;

async function notRecentlyNudged(workspaceId: string): Promise<boolean> {
  const db = getDb();
  const cutoff = new Date(Date.now() - COOLDOWN_HOURS * 60 * 60 * 1000);
  const [hit] = await db
    .select({ id: timelineEvent.id })
    .from(timelineEvent)
    .where(
      and(
        eq(timelineEvent.workspaceId, workspaceId),
        eq(timelineEvent.kind, 'conductor.idle.nudge'),
        sql`${timelineEvent.occurredAt} > ${cutoff.toISOString()}`,
      ),
    )
    .orderBy(desc(timelineEvent.occurredAt))
    .limit(1);
  return !hit;
}

export const conductorIdleNudgeCron = inngest.createFunction(
  {
    id: 'conductor-idle-nudge-cron',
    name: 'Conductor idle-workspace nudge',
    concurrency: { limit: 2 },
  },
  // Every 4 hours on the half-hour, offset from the proactive cron so
  // the two don't pile up on the same minute.
  { cron: '30 */4 * * *' },
  async ({ step }) => {
    const idleWorkspaces = await step.run('scan', async () => {
      const db = getDb();
      const now = Date.now();
      const idleCutoff = new Date(now - IDLE_HOURS * 3600 * 1000);
      const recentlyActiveCutoff = new Date(now - RECENTLY_ACTIVE_DAYS * 24 * 3600 * 1000);

      // For each workspace with any capture in the last
      // RECENTLY_ACTIVE_DAYS window, take MAX(captured_at). Filter to
      // those whose max is older than the idle cutoff.
      const rows = await db
        .select({
          workspaceId: capture.workspaceId,
          last: sql<Date>`max(${capture.capturedAt})`.as('last'),
        })
        .from(capture)
        .where(gte(capture.capturedAt, recentlyActiveCutoff))
        .groupBy(capture.workspaceId)
        // ISO string, not Date: drizzle 0.45 mis-serializes Date params
        // when compared against a raw-sql aggregate (Round 6 bug class).
        .having(sql`max(${capture.capturedAt}) < ${idleCutoff.toISOString()}`);

      return rows.map((r) => ({
        workspaceId: r.workspaceId,
        idleHours: Math.round((now - new Date(r.last).getTime()) / 3600 / 1000),
      }));
    });

    if (idleWorkspaces.length === 0) {
      log.info('conductor.idle.cron.empty', {});
      return { ok: true, dispatched: 0 };
    }

    const fresh = await step.run('dedupe', async () => {
      const out: typeof idleWorkspaces = [];
      for (const w of idleWorkspaces) {
        if (await notRecentlyNudged(w.workspaceId)) out.push(w);
      }
      return out;
    });

    if (fresh.length === 0) {
      log.info('conductor.idle.cron.all_throttled', {
        candidates: idleWorkspaces.length,
      });
      return { ok: true, dispatched: 0, throttled: idleWorkspaces.length };
    }

    await step.run('record', async () => {
      const db = getDb();
      await db.insert(timelineEvent).values(
        fresh.map((w) => ({
          workspaceId: w.workspaceId,
          kind: 'conductor.idle.nudge',
          title: `idle: no captures in ${w.idleHours}h`,
          payload: { idleHours: w.idleHours },
          importance: 1,
        })),
      );
    });

    await step.sendEvent(
      'fan-out-ticks',
      fresh.map((w) => ({
        name: 'conductor/tick' as const,
        data: {
          workspaceId: w.workspaceId,
          reason: `idle-nudge: workspace quiet for ${w.idleHours}h`,
        },
      })),
    );

    log.info('conductor.idle.cron.dispatched', {
      candidates: idleWorkspaces.length,
      dispatched: fresh.length,
    });

    return { ok: true, dispatched: fresh.length };
  },
);

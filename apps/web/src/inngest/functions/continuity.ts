/**
 * Continuity workflows — auto-prewarm stale "where was I?" briefings.
 *
 * Fired (a) when a user opens a project page and the latest briefing is
 * older than 24h (or absent), and (b) by the future C4 morning cron.
 *
 * Debounced per-project so a flurry of page visits collapses to one LLM
 * call. Concurrency-limited per-workspace so a noisy workspace can't
 * starve everyone else.
 */
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { restoreProjectContext } from '@metu/core/continuity';
import { getDb } from '@metu/db';
import { continuityBriefing, project } from '@metu/db/schema';
import { inngest } from '../client';
import { parseEvent } from '../schemas';

/** A briefing is "fresh" if generated within this window. */
const FRESHNESS_MS = 24 * 60 * 60 * 1000;

export const onContinuityPrewarm = inngest.createFunction(
  {
    id: 'continuity-prewarm',
    name: 'Continuity briefing prewarm',
    concurrency: { key: 'event.data.workspaceId', limit: 2 },
    debounce: { period: '5m', key: 'event.data.projectId' },
  },
  { event: 'continuity/prewarm' },
  async ({ event, step, logger }) => {
    const { workspaceId, projectId, reason } = parseEvent('continuity/prewarm', event.data);

    // Confirm scoping + freshness inside the function so the same event
    // can be fired without callers having to re-check.
    const fresh = await step.run('check-freshness', async () => {
      const db = getDb();
      const [proj] = await db
        .select({ id: project.id })
        .from(project)
        .where(and(eq(project.id, projectId), eq(project.workspaceId, workspaceId)))
        .limit(1);
      if (!proj) return { skip: 'project_not_found' as const };

      const cutoff = new Date(Date.now() - FRESHNESS_MS);
      const [recent] = await db
        .select({ id: continuityBriefing.id })
        .from(continuityBriefing)
        .where(
          and(
            eq(continuityBriefing.workspaceId, workspaceId),
            eq(continuityBriefing.projectId, projectId),
            gt(continuityBriefing.generatedAt, cutoff),
          ),
        )
        .orderBy(desc(continuityBriefing.generatedAt))
        .limit(1);
      return recent ? { skip: 'already_fresh' as const } : { skip: false as const };
    });

    if (fresh.skip) {
      logger.info('continuity-prewarm skipped', { projectId, reason: fresh.skip });
      return { ok: true, skipped: fresh.skip };
    }

    const generated = await step.run('generate', () =>
      restoreProjectContext(workspaceId, projectId),
    );

    await step.run('persist', async () => {
      const db = getDb();
      await db.insert(continuityBriefing).values({
        workspaceId,
        projectId,
        briefing: generated.briefing,
        modelProvider: generated.provider,
        modelId: generated.modelId,
      });
    });

    return {
      ok: true,
      reason: reason ?? 'stale',
      provider: generated.provider,
      modelId: generated.modelId,
    };
  },
);

/**
 * Daily morning prewarm — at 06:00 every workspace's top-N most active
 * projects get a fresh briefing so the dashboard's morning view loads
 * on cached context. We rank by `momentumScore` (the existing decayed
 * score that already folds recency in) and cap at TOP_N per workspace.
 *
 * Concurrency-limited globally so a hundred workspaces can't stampede
 * the LLM provider; the per-project debounce inside `onContinuityPrewarm`
 * still applies.
 */
const TOP_N = 5;

export const continuityMorningCron = inngest.createFunction(
  {
    id: 'continuity-morning-cron',
    name: 'Continuity morning prewarm',
    concurrency: { limit: 4 },
  },
  { cron: '0 6 * * *' },
  async ({ step, logger }) => {
    const candidates = await step.run('pick-projects', async () => {
      const db = getDb();
      // Top-N per workspace by momentum. We pull all active projects
      // ordered by (workspaceId, momentumScore desc) and bucket in JS;
      // it's fine for the expected workspace count (<10k).
      const rows = await db
        .select({
          id: project.id,
          workspaceId: project.workspaceId,
          momentumScore: project.momentumScore,
        })
        .from(project)
        .where(and(eq(project.status, 'active'), isNull(project.deletedAt)))
        .orderBy(desc(project.momentumScore));

      const seen = new Map<string, number>();
      const picked: Array<{ workspaceId: string; projectId: string }> = [];
      for (const row of rows) {
        const count = seen.get(row.workspaceId) ?? 0;
        if (count >= TOP_N) continue;
        seen.set(row.workspaceId, count + 1);
        picked.push({ workspaceId: row.workspaceId, projectId: row.id });
      }
      return picked;
    });

    if (candidates.length === 0) {
      logger.info('continuity-morning-cron no candidates');
      return { ok: true, dispatched: 0 };
    }

    await step.sendEvent(
      'fan-out',
      candidates.map((c) => ({
        name: 'continuity/prewarm' as const,
        data: { workspaceId: c.workspaceId, projectId: c.projectId, reason: 'morning-cron' },
      })),
    );

    return { ok: true, dispatched: candidates.length };
  },
);

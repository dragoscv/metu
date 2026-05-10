/**
 * Project death-detection cron — surfaces "kill or commit?" decisions.
 *
 * The architecture doc (docs/architecture.md) calls for: "projects with
 * momentum_score < 0.1 for 21d → kill or commit? prompt." This cron
 * implements that. Runs Sunday 17:00 UTC (slightly before the goals
 * weekly review at 18:00 to avoid notification clobber).
 *
 * For each active project where momentum_score < 0.1 AND the last
 * meaningful activity (or createdAt) is > 21d old, fans a conductor/notify
 * event per workspace member with three quick actions: keep / pause / kill.
 */
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { project, workspaceMember } from '@metu/db/schema';
import { inngest } from '../client';

const STALE_DAYS = 21;
const MOMENTUM_THRESHOLD = 0.1;

export const projectDeathDetectionWeekly = inngest.createFunction(
  {
    id: 'project-death-detection-weekly',
    name: 'Project death detection — kill or commit?',
    concurrency: { limit: 2 },
  },
  { cron: '0 17 * * 0' },
  async ({ step, logger }) => {
    const stale = await step.run('list-stale-projects', async () => {
      const db = getDb();
      const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);
      return db
        .select({
          id: project.id,
          name: project.name,
          workspaceId: project.workspaceId,
          momentumScore: project.momentumScore,
        })
        .from(project)
        .where(
          and(
            eq(project.status, 'active'),
            isNull(project.deletedAt),
            lt(project.momentumScore, MOMENTUM_THRESHOLD),
            or(
              lt(project.lastMeaningfulActivityAt, cutoff),
              and(isNull(project.lastMeaningfulActivityAt), lt(project.createdAt, cutoff)),
            ),
          ),
        )
        .limit(500);
    });

    if (stale.length === 0) {
      logger.info('death-detection nothing stale');
      return { ok: true, prompted: 0 };
    }

    const wsIds = Array.from(new Set(stale.map((p) => p.workspaceId)));
    const members = await step.run('list-members', async () => {
      const db = getDb();
      return db
        .select({ workspaceId: workspaceMember.workspaceId, userId: workspaceMember.userId })
        .from(workspaceMember)
        .where(sql`${workspaceMember.workspaceId} = any(${wsIds})`);
    });

    const byWs = new Map<string, typeof stale>();
    for (const p of stale) {
      const list = byWs.get(p.workspaceId) ?? [];
      list.push(p);
      byWs.set(p.workspaceId, list);
    }

    let prompted = 0;
    for (const m of members) {
      const projects = byWs.get(m.workspaceId) ?? [];
      // Cap to top 5 oldest per notification so a workspace with 50 dead
      // projects doesn't drop a wall of text on the user.
      const top = projects.slice(0, 5);
      if (top.length === 0) continue;
      const body = top
        .map((p) => `• ${p.name} — momentum ${(p.momentumScore * 100).toFixed(0)}%`)
        .join('\n');
      await step.sendEvent(`notify-${m.workspaceId}-${m.userId}`, {
        name: 'conductor/notify' as const,
        data: {
          workspaceId: m.workspaceId,
          userId: m.userId,
          title:
            top.length === 1
              ? `Kill or commit? ${top[0]!.name}`
              : `Kill or commit? ${top.length} stale projects`,
          body,
          urgency: 'low' as const,
          source: 'project-death-detection',
          actionUrl: '/projects',
          metadata: { stale: top.map((p) => p.id) },
        },
      });
      prompted += 1;
    }

    return { ok: true, prompted, candidates: stale.length };
  },
);

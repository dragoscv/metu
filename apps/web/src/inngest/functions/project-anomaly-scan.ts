/**
 * Project velocity anomaly scan.
 *
 * Daily cron at 06:00 UTC. For every workspace × project, compares the
 * count of meaningful timeline events in the last 7 days against the
 * prior 7 days. When velocity drops by more than `DROP_THRESHOLD` (40%)
 * AND the prior window had at least `MIN_PRIOR` events, we emit a
 * `project.velocity_dropped` timeline event so the Conductor + dashboard
 * surface the slowdown.
 *
 * "Meaningful" mirrors the weights in `recomputeMomentum()` — anything
 * with weight ≥ 0.5 counts (commits, PRs merged, tasks completed,
 * decisions, issues closed, workflow failures).
 */
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { project, timelineEvent } from '@metu/db/schema';
import { inngest } from '../client';

const MEANINGFUL_KINDS = [
  'commit.pushed',
  'pr.merged',
  'pr.opened',
  'task.completed',
  'decision.logged',
  'issue.closed',
  'workflow.failed',
];

const DROP_THRESHOLD = 0.4; // 40% fewer events than prior window
const MIN_PRIOR = 5;

export const projectAnomalyScanCron = inngest.createFunction(
  {
    id: 'project-anomaly-scan-cron',
    name: 'Project: velocity anomaly scan (daily 06:00 UTC)',
    concurrency: { limit: 1 },
  },
  { cron: '0 6 * * *' },
  async ({ step }) => runAnomalyScan(step),
);

export const onProjectAnomalyScan = inngest.createFunction(
  {
    id: 'project-anomaly-scan-manual',
    name: 'Project: velocity anomaly scan (manual)',
  },
  { event: 'project/anomaly.scan' },
  async ({ step }) => runAnomalyScan(step),
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runAnomalyScan(step: any) {
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const recentSince = new Date(now - sevenDaysMs);
  const priorSince = new Date(now - 2 * sevenDaysMs);

  const projects = await step.run('list-projects', async () => {
    const db = getDb();
    return db
      .select({ id: project.id, workspaceId: project.workspaceId, name: project.name })
      .from(project)
      .where(eq(project.status, 'active'));
  });

  let dropped = 0;
  for (const p of projects) {
    const result = await step.run(`scan-${p.id}`, async () => {
      const db = getDb();
      const [recent] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(timelineEvent)
        .where(
          and(
            eq(timelineEvent.workspaceId, p.workspaceId),
            eq(timelineEvent.projectId, p.id),
            gte(timelineEvent.occurredAt, recentSince),
            inArray(timelineEvent.kind, MEANINGFUL_KINDS),
          ),
        );
      const [prior] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(timelineEvent)
        .where(
          and(
            eq(timelineEvent.workspaceId, p.workspaceId),
            eq(timelineEvent.projectId, p.id),
            gte(timelineEvent.occurredAt, priorSince),
            lt(timelineEvent.occurredAt, recentSince),
            inArray(timelineEvent.kind, MEANINGFUL_KINDS),
          ),
        );
      const recentN = recent?.n ?? 0;
      const priorN = prior?.n ?? 0;
      if (priorN < MIN_PRIOR) return { dropped: false };
      const ratio = priorN === 0 ? 1 : recentN / priorN;
      if (ratio > 1 - DROP_THRESHOLD) return { dropped: false };

      // Don't double-emit — check for an existing velocity_dropped within last 6 days.
      const sixDaysAgo = new Date(now - 6 * 24 * 60 * 60 * 1000);
      const [existing] = await db
        .select({ id: timelineEvent.id })
        .from(timelineEvent)
        .where(
          and(
            eq(timelineEvent.workspaceId, p.workspaceId),
            eq(timelineEvent.projectId, p.id),
            eq(timelineEvent.kind, 'project.velocity_dropped'),
            gte(timelineEvent.occurredAt, sixDaysAgo),
          ),
        )
        .limit(1);
      if (existing) return { dropped: false };

      await db.insert(timelineEvent).values({
        workspaceId: p.workspaceId,
        projectId: p.id,
        kind: 'project.velocity_dropped',
        title: `${p.name} · velocity dropped (${Math.round((1 - ratio) * 100)}% fewer events vs prior week)`,
        importance: 0.7,
        occurredAt: new Date(),
        payload: { recent7d: recentN, prior7d: priorN, ratio },
      });
      return { dropped: true, recentN, priorN, ratio };
    });
    if (result.dropped) dropped++;
  }

  return { ok: true, scanned: projects.length, dropped };
}

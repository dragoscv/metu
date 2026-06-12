/**
 * Daily GitHub digest.
 *
 * Cron at 08:00 UTC daily. For every workspace with at least one linked
 * GitHub repo, summarizes the prior 24h of activity (commits, PRs,
 * issues, security alerts, workflow failures) into a single
 * `github.digest.daily` timeline event so the user has one row to skim
 * each morning. The Conductor / continuity briefing reads this row to
 * answer "what happened on my projects since I logged off".
 *
 * Pull-only — emits no notifications. The notification path runs through
 * `daily-digest-email` which is a separate, opt-in flow.
 */
import { and, eq, gte, inArray } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { timelineEvent } from '@metu/db/schema';
import { listWorkspacesWithGithubRepos } from '@metu/db/queries';
import { inngest } from '../client';

const KIND_GROUPS: Record<string, string[]> = {
  commits: ['commit.pushed'],
  merged: ['pr.merged'],
  opened: ['pr.opened'],
  closed: ['issue.closed'],
  workflowFails: ['github.workflow.failed'],
  securityAlerts: ['github.security.alert', 'github.security.advisory'],
  releases: ['release.published', 'github.release.published'],
};
const ALL_KINDS = Object.values(KIND_GROUPS).flat();

export const githubDigestDailyCron = inngest.createFunction(
  {
    id: 'github-digest-daily-cron',
    name: 'GitHub: daily digest (08:00 UTC)',
    concurrency: { limit: 1 },
  },
  { cron: '0 8 * * *' },
  async ({ step }) => runDigest(step),
);

export const onGithubDigestDaily = inngest.createFunction(
  { id: 'github-digest-daily-manual', name: 'GitHub: daily digest (manual)' },
  { event: 'github/digest.daily' },
  async ({ step }) => runDigest(step),
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runDigest(step: any) {
  const workspaces = await step.run('list-workspaces', () => listWorkspacesWithGithubRepos());
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  let written = 0;
  for (const ws of workspaces) {
    const result = await step.run(`digest-${ws.workspaceId}`, async () => {
      const db = getDb();
      const rows = await db
        .select({ kind: timelineEvent.kind })
        .from(timelineEvent)
        .where(
          and(
            eq(timelineEvent.workspaceId, ws.workspaceId),
            gte(timelineEvent.occurredAt, since),
            inArray(timelineEvent.kind, ALL_KINDS),
          ),
        );
      const counts: Record<string, number> = {};
      for (const r of rows) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
      const totals: Record<string, number> = {};
      for (const [group, kinds] of Object.entries(KIND_GROUPS)) {
        totals[group] = kinds.reduce((s, k) => s + (counts[k] ?? 0), 0);
      }
      const total = Object.values(totals).reduce((s, n) => s + n, 0);
      if (total === 0) return { skipped: true };

      const parts: string[] = [];
      if (totals.commits) parts.push(`${totals.commits} commits`);
      if (totals.merged) parts.push(`${totals.merged} PRs merged`);
      if (totals.opened) parts.push(`${totals.opened} PRs opened`);
      if (totals.closed) parts.push(`${totals.closed} issues closed`);
      if (totals.releases) parts.push(`${totals.releases} releases`);
      if (totals.workflowFails) parts.push(`${totals.workflowFails} CI failures`);
      if (totals.securityAlerts) parts.push(`${totals.securityAlerts} security alerts`);

      const importance =
        (totals.securityAlerts ?? 0) > 0 || (totals.workflowFails ?? 0) > 2 ? 0.7 : 0.4;

      await db.insert(timelineEvent).values({
        workspaceId: ws.workspaceId,
        kind: 'github.digest.daily',
        title: `Yesterday on GitHub · ${parts.join(' · ')}`,
        importance,
        occurredAt: new Date(),
        payload: { totals, windowHours: 24 },
      });
      return { written: true, totals };
    });
    if (result.written) written++;
  }
  return { ok: true, workspaces: workspaces.length, written };
}

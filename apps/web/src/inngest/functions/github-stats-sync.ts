/**
 * GitHub statistics sync.
 *
 * Two functions:
 *   - `githubStatsCron`: every 2h, enumerates every workspace that has any
 *     linked GitHub repo and fans out one `github/stats.sync.repo` per repo.
 *   - `onGithubRepoStatsSync`: per-repo handler. Pulls a fresh snapshot via
 *     the GitHub REST API, upserts into `github_repo_stats`, and emits
 *     `timeline_event` rows for unseen commits / merged PRs / closed issues
 *     so `recomputeMomentum()` reflects new activity automatically.
 *
 * The integration token is opened lazily per-workspace; we never log it.
 */
import { and, eq } from 'drizzle-orm';
import { open as openSealed } from '@metu/ai';
import { getDb } from '@metu/db';
import { githubRepoStats, integration, integrationResource, timelineEvent } from '@metu/db/schema';
import {
  listLinkedGithubReposWithResource,
  listWorkspacesWithGithubRepos,
  projectByGithubRepo,
} from '@metu/db/queries';
import { fetchRepoStatsSnapshot } from '@metu/integrations/github';
import { inngest } from '../client';
import { parseEvent } from '../schemas';

async function getGithubToken(workspaceId: string, integrationId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(integration)
    .where(
      and(
        eq(integration.id, integrationId),
        eq(integration.workspaceId, workspaceId),
        eq(integration.kind, 'github'),
      ),
    )
    .limit(1);
  if (!row || !row.tokenCiphertext || !row.tokenIv) return null;
  const tokenTag = (row.config as { tokenTag?: string })?.tokenTag;
  if (!tokenTag) return null;
  try {
    const token = await openSealed({
      ciphertext: row.tokenCiphertext,
      iv: row.tokenIv,
      tag: tokenTag,
    });
    return { token, viewer: row.externalId ?? null };
  } catch {
    return null;
  }
}

export const githubStatsCron = inngest.createFunction(
  {
    id: 'github-stats-cron',
    name: 'GitHub: stats fan-out (every 2h)',
    concurrency: { limit: 1 },
  },
  // Stagger off the hour so the conductor's :00 cron stays cheap.
  { cron: '17 */2 * * *' },
  async ({ step }) => {
    const workspaces = await step.run('list-workspaces', () => listWorkspacesWithGithubRepos());
    let queued = 0;
    for (const workspaceId of workspaces) {
      const links = await step.run(`list-${workspaceId}`, () =>
        listLinkedGithubReposWithResource(workspaceId),
      );
      for (const l of links) {
        if (!l.integrationId) continue;
        await step.sendEvent(`fan-${l.resourceId}`, {
          name: 'github/stats.sync.repo',
          data: {
            workspaceId,
            integrationId: l.integrationId,
            resourceId: l.resourceId,
            repoFullName: l.repoFullName,
            reason: 'cron',
          },
        });
        queued++;
      }
    }
    return { workspaces: workspaces.length, queued };
  },
);

export const onGithubRepoStatsSync = inngest.createFunction(
  {
    id: 'github-stats-sync-repo',
    name: 'GitHub: sync stats for one repo',
    concurrency: { key: 'event.data.workspaceId', limit: 4 },
    retries: 2,
  },
  { event: 'github/stats.sync.repo' },
  async ({ event, step }) => {
    const { workspaceId, integrationId, resourceId, repoFullName } = parseEvent(
      'github/stats.sync.repo',
      event.data,
    );

    const creds = await step.run('token', () => getGithubToken(workspaceId, integrationId));
    if (!creds) return { ok: false, reason: 'no-token' };

    // Read previous snapshot to compute deltas.
    const previous = await step.run('previous', async () => {
      const db = getDb();
      const [row] = await db
        .select()
        .from(githubRepoStats)
        .where(
          and(
            eq(githubRepoStats.resourceId, resourceId),
            eq(githubRepoStats.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      return row ?? null;
    });

    const snapshot = await step.run('fetch', () =>
      fetchRepoStatsSnapshot(creds.token, repoFullName, creds.viewer),
    );
    if (!snapshot) {
      // Persist the error on any existing row so the UI can surface it.
      if (previous) {
        await step.run('record-error', async () => {
          const db = getDb();
          await db
            .update(githubRepoStats)
            .set({ lastSyncError: 'fetch failed', lastSyncedAt: new Date() })
            .where(
              and(
                eq(githubRepoStats.resourceId, resourceId),
                eq(githubRepoStats.workspaceId, workspaceId),
              ),
            );
        });
      }
      return { ok: false, reason: 'fetch-failed' };
    }

    await step.run('upsert', async () => {
      const db = getDb();
      const values = {
        workspaceId,
        resourceId,
        repoFullName: snapshot.repoFullName,
        defaultBranch: snapshot.defaultBranch,
        primaryLanguage: snapshot.primaryLanguage,
        languageBytes: snapshot.languageBytes as Record<string, number>,
        stargazers: snapshot.stargazers,
        forks: snapshot.forks,
        watchers: snapshot.watchers,
        openIssues: snapshot.openIssues,
        openPullRequests: snapshot.openPullRequests,
        commitsLast7d: snapshot.commitsLast7d,
        commitsLast30d: snapshot.commitsLast30d,
        additionsLast30d: snapshot.additionsLast30d,
        deletionsLast30d: snapshot.deletionsLast30d,
        mergedPrsLast30d: snapshot.mergedPrsLast30d,
        closedIssuesLast30d: snapshot.closedIssuesLast30d,
        commitsAllLast7d: snapshot.commitsAllLast7d,
        commitsAllLast30d: snapshot.commitsAllLast30d,
        branchesActiveLast30d: snapshot.branchesActiveLast30d,
        contributorsLast30d: snapshot.contributorsLast30d,
        branchesTotal: snapshot.branchesTotal,
        currentStreakDays: snapshot.currentStreakDays,
        weeklyCommitHistogram: snapshot.weeklyCommitHistogram,
        topContributors: snapshot.topContributors as unknown as Record<string, unknown>[],
        recentCommits: snapshot.recentCommits as unknown as Record<string, unknown>[],
        recentMergedPrs: snapshot.recentMergedPrs as unknown as Record<string, unknown>[],
        recentClosedIssues: snapshot.recentClosedIssues as unknown as Record<string, unknown>[],
        lastCommitAt: snapshot.lastCommitAt ? new Date(snapshot.lastCommitAt) : null,
        lastSyncedAt: new Date(),
        lastSyncError: null,
      };
      await db
        .insert(githubRepoStats)
        .values(values)
        .onConflictDoUpdate({ target: githubRepoStats.resourceId, set: values });

      // Reflect freshness on the resource row too.
      await db
        .update(integrationResource)
        .set({ lastSyncedAt: new Date() })
        .where(
          and(
            eq(integrationResource.id, resourceId),
            eq(integrationResource.workspaceId, workspaceId),
          ),
        );
    });

    // Emit timeline events for new activity since last sync. These feed
    // `recomputeMomentum()` weights ('commit.pushed' = 1.0, etc.).
    const projectId = await step.run('project', () =>
      projectByGithubRepo(workspaceId, repoFullName),
    );
    if (projectId) {
      const seenShas = new Set<string>(
        ((previous?.recentCommits ?? []) as Array<{ sha?: string }>).map((c) => c.sha ?? ''),
      );
      const newCommits = snapshot.recentCommits.filter((c) => c.sha && !seenShas.has(c.sha));
      const seenPrs = new Set<number>(
        ((previous?.recentMergedPrs ?? []) as Array<{ number?: number }>).map(
          (p) => p.number ?? -1,
        ),
      );
      const newMerged = snapshot.recentMergedPrs.filter((p) => !seenPrs.has(p.number));
      const seenIssues = new Set<number>(
        ((previous?.recentClosedIssues ?? []) as Array<{ number?: number }>).map(
          (i) => i.number ?? -1,
        ),
      );
      const newClosed = snapshot.recentClosedIssues.filter((i) => !seenIssues.has(i.number));

      if (newCommits.length || newMerged.length || newClosed.length) {
        await step.run('timeline', async () => {
          const db = getDb();
          // Idempotency — webhook handler may have already written commit.pushed
          // rows for the same SHAs. Filter against existing rows in this
          // workspace+project before insert. Cheap because we cap at 60 commits.
          const candidateShas = newCommits.map((c) => c.sha).filter(Boolean) as string[];
          const existingShas = new Set<string>();
          if (candidateShas.length > 0) {
            const { sql: rawSql } = await import('drizzle-orm');
            const seen = await db
              .select({ sha: rawSql<string>`payload->>'sha'` })
              .from(timelineEvent)
              .where(
                and(
                  eq(timelineEvent.workspaceId, workspaceId),
                  eq(timelineEvent.projectId, projectId),
                  eq(timelineEvent.kind, 'commit.pushed'),
                  rawSql`payload->>'sha' = ANY(${candidateShas})`,
                ),
              );
            for (const r of seen) if (r.sha) existingShas.add(r.sha);
          }
          const rows: Array<typeof timelineEvent.$inferInsert> = [];
          for (const c of newCommits) {
            if (c.sha && existingShas.has(c.sha)) continue;
            const branchTag =
              c.branch && c.branch !== snapshot.defaultBranch ? ` [${c.branch}]` : '';
            rows.push({
              workspaceId,
              projectId,
              kind: 'commit.pushed',
              title: `${repoFullName}${branchTag} · ${c.message.slice(0, 80)}`,
              body: c.url,
              importance: 0.5,
              occurredAt: c.authoredAt ? new Date(c.authoredAt) : new Date(),
              payload: {
                repo: repoFullName,
                sha: c.sha,
                authorLogin: c.authorLogin,
                authorName: c.authorName,
                branch: c.branch ?? null,
                url: c.url,
              },
            });
          }
          for (const p of newMerged) {
            rows.push({
              workspaceId,
              projectId,
              kind: 'pr.merged',
              title: `${repoFullName} · merged PR #${p.number}: ${p.title.slice(0, 80)}`,
              body: p.url,
              importance: 0.7,
              occurredAt: new Date(p.mergedAt),
              payload: {
                repo: repoFullName,
                prNumber: p.number,
                url: p.url,
              },
            });
          }
          for (const i of newClosed) {
            rows.push({
              workspaceId,
              projectId,
              kind: 'issue.closed',
              title: `${repoFullName} · closed issue #${i.number}: ${i.title.slice(0, 80)}`,
              body: i.url,
              importance: 0.5,
              occurredAt: new Date(i.closedAt),
              payload: {
                repo: repoFullName,
                issueNumber: i.number,
                url: i.url,
              },
            });
          }
          if (rows.length > 0) {
            await db.insert(timelineEvent).values(rows);
          }
        });

        // Wake the planner so the next pulse references the new activity.
        await step.sendEvent('observe', {
          name: 'conductor/observe',
          data: {
            workspaceId,
            eventKind: 'github.stats.synced',
            payload: {
              repoFullName,
              newCommits: newCommits.length,
              newMerged: newMerged.length,
              newClosed: newClosed.length,
            },
          },
        });
      }

      // Always refresh momentum after a successful sync — even when no new
      // events were detected, the project's `momentum_score` /
      // `last_meaningful_activity_at` may be stale (e.g. first backfill, or
      // events inserted by a previous sync but never followed by a recompute).
      await step.sendEvent('momentum', {
        name: 'project/momentum-recompute',
        data: { workspaceId, projectId },
      });
    }

    return {
      ok: true,
      newCommits: snapshot.commitsLast7d,
      openPRs: snapshot.openPullRequests,
    };
  },
);

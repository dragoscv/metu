import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { getDb } from '../client';
import {
  adCampaign,
  githubRepoStats,
  integrationResource,
  project,
  projectLink,
  socialPost,
} from '../schema';
import { timelineEvent } from '../schema/memory';

export async function listProjectLinks(workspaceId: string, projectId: string) {
  const db = getDb();
  return db
    .select()
    .from(projectLink)
    .where(and(eq(projectLink.workspaceId, workspaceId), eq(projectLink.projectId, projectId)))
    .orderBy(asc(projectLink.kind), asc(projectLink.title));
}

export async function getProjectLink(workspaceId: string, linkId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(projectLink)
    .where(and(eq(projectLink.workspaceId, workspaceId), eq(projectLink.id, linkId)))
    .limit(1);
  return row ?? null;
}

/** Returns a flat summary so cards can show provider chips without N+1 lookups. */
export async function listProjectsLinkSummary(workspaceId: string, projectIds: string[]) {
  if (projectIds.length === 0)
    return new Map<string, { provider: string; kind: string; count: number }[]>();
  const db = getDb();
  const rows = await db
    .select({
      projectId: projectLink.projectId,
      provider: projectLink.provider,
      kind: projectLink.kind,
      count: sql<number>`count(*)::int`,
    })
    .from(projectLink)
    .where(
      and(eq(projectLink.workspaceId, workspaceId), inArray(projectLink.projectId, projectIds)),
    )
    .groupBy(projectLink.projectId, projectLink.provider, projectLink.kind);

  const map = new Map<string, { provider: string; kind: string; count: number }[]>();
  for (const r of rows) {
    const list = map.get(r.projectId) ?? [];
    list.push({ provider: r.provider, kind: r.kind, count: r.count });
    map.set(r.projectId, list);
  }
  return map;
}

export async function listIntegrationResources(
  workspaceId: string,
  filter?: { provider?: string; kind?: string; integrationId?: string | null },
) {
  const db = getDb();
  const conds: SQL[] = [eq(integrationResource.workspaceId, workspaceId)];
  if (filter?.provider) conds.push(eq(integrationResource.provider, filter.provider));
  if (filter?.kind) conds.push(eq(integrationResource.kind, filter.kind));
  if (filter?.integrationId)
    conds.push(eq(integrationResource.integrationId, filter.integrationId));
  return db
    .select()
    .from(integrationResource)
    .where(and(...conds))
    .orderBy(desc(integrationResource.updatedAt));
}

export async function getIntegrationResourceByExternalId(
  workspaceId: string,
  provider: string,
  externalId: string,
) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(integrationResource)
    .where(
      and(
        eq(integrationResource.workspaceId, workspaceId),
        eq(integrationResource.provider, provider),
        eq(integrationResource.externalId, externalId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Find which projects already link a given URL across the workspace. */
export async function projectsByLinkUrl(workspaceId: string, url: string) {
  const db = getDb();
  return db
    .select({
      projectId: projectLink.projectId,
      linkId: projectLink.id,
    })
    .from(projectLink)
    .where(and(eq(projectLink.workspaceId, workspaceId), eq(projectLink.url, url)));
}

/** List every GitHub repo link in the workspace, joined with the owning project. */
export async function listLinkedGithubRepos(workspaceId: string) {
  const db = getDb();
  return db
    .select({
      fullName: sql<string>`${projectLink.metadata} ->> 'fullName'`,
      url: projectLink.url,
      projectId: project.id,
      projectName: project.name,
      projectSlug: project.slug,
    })
    .from(projectLink)
    .innerJoin(project, eq(project.id, projectLink.projectId))
    .where(
      and(
        eq(projectLink.workspaceId, workspaceId),
        eq(projectLink.provider, 'github'),
        eq(projectLink.kind, 'repo'),
      ),
    );
}

/** Find the project linked to a GitHub repo (owner/name) — used by webhook routing. */
export async function projectByGithubRepo(workspaceId: string, fullName: string) {
  const db = getDb();
  const [row] = await db
    .select({ projectId: projectLink.projectId })
    .from(projectLink)
    .where(
      and(
        eq(projectLink.workspaceId, workspaceId),
        eq(projectLink.provider, 'github'),
        eq(projectLink.kind, 'repo'),
        sql`${projectLink.metadata} ->> 'fullName' = ${fullName}`,
      ),
    )
    .limit(1);
  return row?.projectId ?? null;
}

/**
 * Cross-workspace lookup of project links matching a GitHub repo full name.
 * Used by the GitHub webhook route which has no user/workspace context.
 */
export async function projectsByGithubRepoGlobal(fullName: string) {
  const db = getDb();
  return db
    .select({
      workspaceId: projectLink.workspaceId,
      projectId: projectLink.projectId,
      url: projectLink.url,
    })
    .from(projectLink)
    .where(
      and(
        eq(projectLink.provider, 'github'),
        eq(projectLink.kind, 'repo'),
        sql`${projectLink.metadata} ->> 'fullName' = ${fullName}`,
      ),
    );
}

/**
 * Every linked GitHub repo across the workspace, joined with its
 * `integration_resource` snapshot so the stats sync can fan-out one event
 * per repo with everything it needs.
 */
export async function listLinkedGithubReposWithResource(workspaceId: string) {
  const db = getDb();
  return db
    .select({
      projectId: projectLink.projectId,
      projectName: project.name,
      resourceId: integrationResource.id,
      integrationId: integrationResource.integrationId,
      repoFullName: integrationResource.externalId,
      url: projectLink.url,
      lastSyncedAt: integrationResource.lastSyncedAt,
    })
    .from(projectLink)
    .innerJoin(project, eq(project.id, projectLink.projectId))
    .innerJoin(integrationResource, eq(integrationResource.id, projectLink.resourceId))
    .where(
      and(
        eq(projectLink.workspaceId, workspaceId),
        eq(projectLink.provider, 'github'),
        eq(projectLink.kind, 'repo'),
      ),
    );
}

/** All workspaces with at least one GitHub repo link — used by the cron fan-out. */
export async function listWorkspacesWithGithubRepos() {
  const db = getDb();
  const rows = await db
    .selectDistinct({ workspaceId: projectLink.workspaceId })
    .from(projectLink)
    .where(and(eq(projectLink.provider, 'github'), eq(projectLink.kind, 'repo')));
  return rows.map((r) => r.workspaceId);
}

export interface ProjectGithubStats {
  resourceId: string;
  repoFullName: string;
  url: string;
  defaultBranch: string | null;
  primaryLanguage: string | null;
  languageBytes: Record<string, number>;
  stargazers: number;
  forks: number;
  openIssues: number;
  openPullRequests: number;
  commitsLast7d: number;
  commitsLast30d: number;
  commitsAllLast7d: number;
  commitsAllLast30d: number;
  branchesActiveLast30d: number;
  branchesTotal: number;
  contributorsLast30d: number;
  mergedPrsLast30d: number;
  closedIssuesLast30d: number;
  currentStreakDays: number;
  weeklyCommitHistogram: number[];
  topContributors: Array<{ login: string; contributions: number; avatarUrl: string | null }>;
  recentCommits: Array<{
    sha: string;
    message: string;
    authorLogin: string | null;
    url: string;
    authoredAt: string | null;
  }>;
  recentMergedPrs: Array<{ number: number; title: string; url: string; mergedAt: string }>;
  recentClosedIssues: Array<{ number: number; title: string; url: string; closedAt: string }>;
  lastCommitAt: string | null;
  lastSyncedAt: string;
  lastSyncError: string | null;
}

/** Per-project list of GitHub repo stats joined via `project_link → integration_resource`. */
export async function listGithubRepoStatsForProject(
  workspaceId: string,
  projectId: string,
): Promise<ProjectGithubStats[]> {
  const db = getDb();
  const rows = await db
    .select({
      resourceId: githubRepoStats.resourceId,
      repoFullName: githubRepoStats.repoFullName,
      url: projectLink.url,
      defaultBranch: githubRepoStats.defaultBranch,
      primaryLanguage: githubRepoStats.primaryLanguage,
      languageBytes: githubRepoStats.languageBytes,
      stargazers: githubRepoStats.stargazers,
      forks: githubRepoStats.forks,
      openIssues: githubRepoStats.openIssues,
      openPullRequests: githubRepoStats.openPullRequests,
      commitsLast7d: githubRepoStats.commitsLast7d,
      commitsLast30d: githubRepoStats.commitsLast30d,
      commitsAllLast7d: githubRepoStats.commitsAllLast7d,
      commitsAllLast30d: githubRepoStats.commitsAllLast30d,
      branchesActiveLast30d: githubRepoStats.branchesActiveLast30d,
      branchesTotal: githubRepoStats.branchesTotal,
      contributorsLast30d: githubRepoStats.contributorsLast30d,
      mergedPrsLast30d: githubRepoStats.mergedPrsLast30d,
      closedIssuesLast30d: githubRepoStats.closedIssuesLast30d,
      currentStreakDays: githubRepoStats.currentStreakDays,
      weeklyCommitHistogram: githubRepoStats.weeklyCommitHistogram,
      topContributors: githubRepoStats.topContributors,
      recentCommits: githubRepoStats.recentCommits,
      recentMergedPrs: githubRepoStats.recentMergedPrs,
      recentClosedIssues: githubRepoStats.recentClosedIssues,
      lastCommitAt: githubRepoStats.lastCommitAt,
      lastSyncedAt: githubRepoStats.lastSyncedAt,
      lastSyncError: githubRepoStats.lastSyncError,
    })
    .from(githubRepoStats)
    .innerJoin(projectLink, eq(projectLink.resourceId, githubRepoStats.resourceId))
    .where(and(eq(githubRepoStats.workspaceId, workspaceId), eq(projectLink.projectId, projectId)));

  return rows.map((r) => ({
    resourceId: r.resourceId,
    repoFullName: r.repoFullName,
    url: r.url,
    defaultBranch: r.defaultBranch,
    primaryLanguage: r.primaryLanguage,
    languageBytes: (r.languageBytes ?? {}) as Record<string, number>,
    stargazers: r.stargazers,
    forks: r.forks,
    openIssues: r.openIssues,
    openPullRequests: r.openPullRequests,
    commitsLast7d: r.commitsLast7d,
    commitsLast30d: r.commitsLast30d,
    commitsAllLast7d: r.commitsAllLast7d,
    commitsAllLast30d: r.commitsAllLast30d,
    branchesActiveLast30d: r.branchesActiveLast30d,
    branchesTotal: r.branchesTotal,
    contributorsLast30d: r.contributorsLast30d,
    mergedPrsLast30d: r.mergedPrsLast30d,
    closedIssuesLast30d: r.closedIssuesLast30d,
    currentStreakDays: r.currentStreakDays,
    weeklyCommitHistogram: (r.weeklyCommitHistogram ?? []) as number[],
    topContributors: (r.topContributors ?? []) as ProjectGithubStats['topContributors'],
    recentCommits: (r.recentCommits ?? []) as ProjectGithubStats['recentCommits'],
    recentMergedPrs: (r.recentMergedPrs ?? []) as ProjectGithubStats['recentMergedPrs'],
    recentClosedIssues: (r.recentClosedIssues ?? []) as ProjectGithubStats['recentClosedIssues'],
    lastCommitAt: r.lastCommitAt ? new Date(r.lastCommitAt).toISOString() : null,
    lastSyncedAt: new Date(r.lastSyncedAt).toISOString(),
    lastSyncError: r.lastSyncError,
  }));
}

/** Aggregated GitHub-stats summary keyed by projectId for grid badges. */
export async function listGithubStatsSummaryForProjects(
  workspaceId: string,
  projectIds: string[],
): Promise<
  Map<
    string,
    {
      repos: number;
      commitsLast7d: number;
      commitsLast30d: number;
      openPullRequests: number;
      openIssues: number;
      mergedPrsLast30d: number;
    }
  >
> {
  const out = new Map<
    string,
    {
      repos: number;
      commitsLast7d: number;
      commitsLast30d: number;
      openPullRequests: number;
      openIssues: number;
      mergedPrsLast30d: number;
    }
  >();
  if (projectIds.length === 0) return out;
  const db = getDb();
  const rows = await db
    .select({
      projectId: projectLink.projectId,
      repos: sql<number>`count(distinct ${githubRepoStats.id})::int`,
      commitsLast7d: sql<number>`coalesce(sum(${githubRepoStats.commitsLast7d}), 0)::int`,
      commitsLast30d: sql<number>`coalesce(sum(${githubRepoStats.commitsLast30d}), 0)::int`,
      openPullRequests: sql<number>`coalesce(sum(${githubRepoStats.openPullRequests}), 0)::int`,
      openIssues: sql<number>`coalesce(sum(${githubRepoStats.openIssues}), 0)::int`,
      mergedPrsLast30d: sql<number>`coalesce(sum(${githubRepoStats.mergedPrsLast30d}), 0)::int`,
    })
    .from(projectLink)
    .innerJoin(githubRepoStats, eq(githubRepoStats.resourceId, projectLink.resourceId))
    .where(
      and(
        eq(projectLink.workspaceId, workspaceId),
        eq(projectLink.provider, 'github'),
        eq(projectLink.kind, 'repo'),
        inArray(projectLink.projectId, projectIds),
      ),
    )
    .groupBy(projectLink.projectId);
  for (const r of rows) {
    out.set(r.projectId, {
      repos: r.repos,
      commitsLast7d: r.commitsLast7d,
      commitsLast30d: r.commitsLast30d,
      openPullRequests: r.openPullRequests,
      openIssues: r.openIssues,
      mergedPrsLast30d: r.mergedPrsLast30d,
    });
  }
  return out;
}

export interface BranchActivityRow {
  branch: string;
  commits: number;
  lastCommitAt: string | null;
  isDefault: boolean;
}

/**
 * Per-branch commit volume for a project's linked GitHub repos over the
 * last 30 days. Aggregates from `timeline_event` rows where the webhook
 * recorded a `branch` in the payload (commit.pushed + github.push).
 *
 * Returns top branches by commit count (capped at `limit`), default
 * branch always included if it appears in the data.
 */
export async function listGithubBranchActivity(
  workspaceId: string,
  projectId: string,
  limit = 8,
): Promise<BranchActivityRow[]> {
  const db = getDb();
  // Find the default branch(es) for this project's repos so we can flag them.
  const defaults = await db
    .select({ defaultBranch: githubRepoStats.defaultBranch })
    .from(githubRepoStats)
    .innerJoin(projectLink, eq(projectLink.resourceId, githubRepoStats.resourceId))
    .where(and(eq(projectLink.workspaceId, workspaceId), eq(projectLink.projectId, projectId)));
  const defaultSet = new Set(defaults.map((d) => d.defaultBranch).filter(Boolean));

  const rows = await db
    .select({
      branch: sql<string>`${timelineEvent.payload}->>'branch'`,
      commits: sql<number>`count(*)::int`,
      lastCommitAt: sql<Date>`max(${timelineEvent.occurredAt})`,
    })
    .from(timelineEvent)
    .where(
      and(
        eq(timelineEvent.workspaceId, workspaceId),
        eq(timelineEvent.projectId, projectId),
        inArray(timelineEvent.kind, ['commit.pushed', 'github.push']),
        sql`${timelineEvent.occurredAt} > now() - interval '30 days'`,
        sql`${timelineEvent.payload}->>'branch' is not null`,
      ),
    )
    .groupBy(sql`${timelineEvent.payload}->>'branch'`)
    .orderBy(desc(sql<number>`count(*)`))
    .limit(limit);

  return rows
    .filter((r) => r.branch && r.branch.length > 0)
    .map((r) => ({
      branch: r.branch,
      commits: r.commits,
      lastCommitAt: r.lastCommitAt ? new Date(r.lastCommitAt).toISOString() : null,
      isDefault: defaultSet.has(r.branch),
    }));
}

// ─── Unified social_post + ad_campaign upserts ─────────────────────────────
// Per-platform sync functions all funnel through these so we never have to
// re-implement the (workspaceId, platform, externalId) conflict logic.

export interface UpsertSocialPostInput {
  workspaceId: string;
  integrationId: string;
  platform: string;
  externalId: string;
  title?: string | null;
  url?: string | null;
  publishedAt?: Date | null;
  metrics?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export async function upsertSocialPost(input: UpsertSocialPostInput): Promise<string> {
  const db = getDb();
  const existing = await db
    .select({ id: socialPost.id })
    .from(socialPost)
    .where(
      and(
        eq(socialPost.workspaceId, input.workspaceId),
        eq(socialPost.platform, input.platform),
        eq(socialPost.externalId, input.externalId),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(socialPost)
      .set({
        integrationId: input.integrationId,
        title: input.title ?? null,
        url: input.url ?? null,
        publishedAt: input.publishedAt ?? null,
        metrics: input.metrics ?? {},
        metadata: input.metadata ?? {},
        lastSyncedAt: new Date(),
      })
      .where(and(eq(socialPost.workspaceId, input.workspaceId), eq(socialPost.id, existing[0].id)));
    return existing[0].id;
  }

  const inserted = await db
    .insert(socialPost)
    .values({
      workspaceId: input.workspaceId,
      integrationId: input.integrationId,
      platform: input.platform,
      externalId: input.externalId,
      title: input.title ?? null,
      url: input.url ?? null,
      publishedAt: input.publishedAt ?? null,
      metrics: input.metrics ?? {},
      metadata: input.metadata ?? {},
    })
    .returning();
  return inserted[0]!.id;
}

/**
 * Latest published social post per (integration, platform) for a workspace.
 * Used by the dashboard observatory to anchor "social_posts" stream items
 * to a real publishedAt rather than the integration's last sync time.
 */
export async function latestSocialPostsByIntegration(workspaceId: string) {
  const db = getDb();
  // DISTINCT ON (integration_id) — pick the row with greatest published_at
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (integration_id)
      integration_id AS "integrationId",
      platform,
      external_id   AS "externalId",
      title,
      url,
      published_at  AS "publishedAt"
    FROM social_post
    WHERE workspace_id = ${workspaceId}
      AND published_at IS NOT NULL
    ORDER BY integration_id, published_at DESC NULLS LAST
  `);
  return rows as unknown as Array<{
    integrationId: string;
    platform: string;
    externalId: string;
    title: string | null;
    url: string | null;
    publishedAt: Date;
  }>;
}

export interface UpsertAdCampaignInput {
  workspaceId: string;
  integrationId: string;
  platform: string;
  externalId: string;
  name: string;
  status?: string | null;
  currency?: string | null;
  spendTotal?: number;
  spendLast7d?: number;
  spendLast30d?: number;
  impressionsLast30d?: number;
  clicksLast30d?: number;
  conversionsLast30d?: number;
  startedAt?: Date | null;
  endedAt?: Date | null;
  metadata?: Record<string, unknown>;
}

export async function upsertAdCampaign(input: UpsertAdCampaignInput): Promise<string> {
  const db = getDb();
  const existing = await db
    .select({ id: adCampaign.id })
    .from(adCampaign)
    .where(
      and(
        eq(adCampaign.workspaceId, input.workspaceId),
        eq(adCampaign.platform, input.platform),
        eq(adCampaign.externalId, input.externalId),
      ),
    )
    .limit(1);

  const data = {
    integrationId: input.integrationId,
    name: input.name,
    status: input.status ?? null,
    currency: input.currency ?? null,
    spendTotal: input.spendTotal ?? 0,
    spendLast7d: input.spendLast7d ?? 0,
    spendLast30d: input.spendLast30d ?? 0,
    impressionsLast30d: input.impressionsLast30d ?? 0,
    clicksLast30d: input.clicksLast30d ?? 0,
    conversionsLast30d: input.conversionsLast30d ?? 0,
    startedAt: input.startedAt ?? null,
    endedAt: input.endedAt ?? null,
    metadata: input.metadata ?? {},
    lastSyncedAt: new Date(),
  };

  if (existing[0]) {
    await db
      .update(adCampaign)
      .set(data)
      .where(and(eq(adCampaign.workspaceId, input.workspaceId), eq(adCampaign.id, existing[0].id)));
    return existing[0].id;
  }

  const inserted = await db
    .insert(adCampaign)
    .values({
      workspaceId: input.workspaceId,
      platform: input.platform,
      externalId: input.externalId,
      ...data,
    })
    .returning();
  return inserted[0]!.id;
}

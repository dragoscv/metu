import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { getDb } from '../client';
import { githubRepoStats, integrationResource, project, projectLink } from '../schema';

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

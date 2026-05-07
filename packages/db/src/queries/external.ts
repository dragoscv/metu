import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { getDb } from '../client';
import { integrationResource, project, projectLink } from '../schema';

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

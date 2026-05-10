/**
 * Continuity briefing queries — surfaces the latest "where was I?" briefing
 * per project for dashboards.
 */
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../client';
import { continuityBriefing, project } from '../schema';

export interface RecentBriefing {
  id: string;
  projectId: string;
  projectName: string;
  briefing: string;
  modelProvider: string | null;
  modelId: string | null;
  generatedAt: Date;
  momentumScore: number | null;
}

/**
 * Latest briefing per project for the workspace, ordered by `generatedAt`
 * desc, capped to `limit`. One row per project (DISTINCT ON the project_id,
 * keeping the most recent briefing). Joins `project` to surface name +
 * momentum so the dashboard widget can sort/badge without a second round-trip.
 */
export async function listRecentBriefings(
  workspaceId: string,
  limit = 3,
): Promise<RecentBriefing[]> {
  const db = getDb();
  // DISTINCT ON requires the ordering key first → use a CTE-equivalent via
  // sql template so we get one row per project, newest briefing.
  const rows = await db.execute<{
    id: string;
    project_id: string;
    project_name: string;
    briefing: string;
    model_provider: string | null;
    model_id: string | null;
    generated_at: Date;
    momentum_score: number | null;
  }>(sql`
    SELECT DISTINCT ON (cb.project_id)
      cb.id,
      cb.project_id,
      p.name AS project_name,
      cb.briefing,
      cb.model_provider,
      cb.model_id,
      cb.generated_at,
      p.momentum_score
    FROM ${continuityBriefing} cb
    JOIN ${project} p ON p.id = cb.project_id
    WHERE cb.workspace_id = ${workspaceId}
      AND p.workspace_id = ${workspaceId}
      AND p.status IN ('active', 'paused')
      AND p.deleted_at IS NULL
    ORDER BY cb.project_id, cb.generated_at DESC
    LIMIT ${limit * 4}
  `);

  // The inner query gave us latest-per-project but ordered by project_id;
  // sort by recency and cap.
  const list = (Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? [])) as Array<{
    id: string;
    project_id: string;
    project_name: string;
    briefing: string;
    model_provider: string | null;
    model_id: string | null;
    generated_at: Date | string;
    momentum_score: number | null;
  }>;

  return list
    .map((r) => ({
      id: r.id,
      projectId: r.project_id,
      projectName: r.project_name,
      briefing: r.briefing,
      modelProvider: r.model_provider,
      modelId: r.model_id,
      generatedAt: r.generated_at instanceof Date ? r.generated_at : new Date(r.generated_at),
      momentumScore: r.momentum_score == null ? null : Number(r.momentum_score),
    }))
    .sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime())
    .slice(0, limit);
}

/** Lightweight count for the "needs prewarming" hint on the dashboard. */
export async function countActiveProjectsWithoutFreshBriefing(
  workspaceId: string,
  staleAfterMs = 24 * 60 * 60 * 1000,
): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - staleAfterMs);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(project)
    .where(
      and(
        eq(project.workspaceId, workspaceId),
        sql`${project.status} in ('active', 'paused')`,
        sql`${project.deletedAt} is null`,
        sql`not exists (
          select 1 from ${continuityBriefing} cb
          where cb.project_id = ${project.id}
            and cb.workspace_id = ${workspaceId}
            and cb.generated_at >= ${cutoff}
        )`,
      ),
    );
  return row?.n ?? 0;
}

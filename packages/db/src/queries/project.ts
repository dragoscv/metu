import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { getDb } from '../client';
import { project, task, decision } from '../schema';
import { goal } from '../schema/goals';

export async function listProjects(workspaceId: string) {
  const db = getDb();
  return db
    .select()
    .from(project)
    .where(and(eq(project.workspaceId, workspaceId), isNull(project.deletedAt)))
    .orderBy(desc(project.momentumScore), desc(project.updatedAt));
}

export interface ListProjectsParams {
  workspaceId: string;
  status?: string | null;
  sort?: 'momentum' | 'name' | 'recent' | null;
  includeArchived?: boolean;
  search?: string | null;
  hasLink?: boolean | null;
  linkProviders?: string[];
  stack?: string[];
  /** today | week | month | stale */
  lastActivity?: 'today' | 'week' | 'month' | 'stale' | null;
  hasOpenTasks?: boolean | null;
  hasBlockedTasks?: boolean | null;
  hasGoal?: boolean | null;
}

export async function listProjectsFiltered({
  workspaceId,
  status = null,
  sort = 'momentum',
  includeArchived = false,
  search = null,
  hasLink = null,
  linkProviders = [],
  stack = [],
  lastActivity = null,
  hasOpenTasks = null,
  hasBlockedTasks = null,
  hasGoal = null,
}: ListProjectsParams) {
  const db = getDb();
  const filters: SQL[] = [eq(project.workspaceId, workspaceId), isNull(project.deletedAt)];
  if (status) filters.push(sql`${project.status}::text = ${status}`);
  else if (!includeArchived) filters.push(sql`${project.status} not in ('archived','killed')`);

  if (search && search.trim()) {
    const q = `%${search.trim()}%`;
    filters.push(
      sql`(${project.name} ilike ${q} or coalesce(${project.summary}, '') ilike ${q} or coalesce(${project.stateSummary}, '') ilike ${q})`,
    );
  }

  if (hasLink === true) {
    filters.push(sql`exists (select 1 from project_link pl where pl.project_id = ${project.id})`);
  } else if (hasLink === false) {
    filters.push(
      sql`not exists (select 1 from project_link pl where pl.project_id = ${project.id})`,
    );
  }

  if (linkProviders.length > 0) {
    filters.push(
      sql`exists (select 1 from project_link pl where pl.project_id = ${project.id} and pl.provider = any(${sql.raw(`array[${linkProviders.map((p) => `'${p.replace(/'/g, "''")}'`).join(',')}]::text[]`)}))`,
    );
  }

  if (stack.length > 0) {
    // Match any tag in metadata.stack against the requested list.
    filters.push(
      sql`exists (
        select 1 from jsonb_array_elements_text(coalesce(${project.metadata} -> 'stack', '[]'::jsonb)) tag
        where tag = any(${sql.raw(`array[${stack.map((s) => `'${s.replace(/'/g, "''")}'`).join(',')}]::text[]`)})
      )`,
    );
  }

  if (lastActivity) {
    if (lastActivity === 'today') {
      filters.push(sql`${project.updatedAt} >= now() - interval '1 day'`);
    } else if (lastActivity === 'week') {
      filters.push(sql`${project.updatedAt} >= now() - interval '7 days'`);
    } else if (lastActivity === 'month') {
      filters.push(sql`${project.updatedAt} >= now() - interval '30 days'`);
    } else if (lastActivity === 'stale') {
      filters.push(sql`${project.updatedAt} < now() - interval '30 days'`);
    }
  }

  if (hasOpenTasks === true) {
    filters.push(
      sql`exists (
        select 1 from task t
        where t.project_id = ${project.id}
          and t.deleted_at is null
          and t.status not in ('done','dropped')
      )`,
    );
  }

  if (hasBlockedTasks === true) {
    filters.push(
      sql`exists (
        select 1 from task t
        where t.project_id = ${project.id} and t.deleted_at is null and t.status = 'blocked'
      )`,
    );
  }

  if (hasGoal === true) {
    filters.push(
      sql`exists (select 1 from goal g where g.project_id = ${project.id} and g.deleted_at is null)`,
    );
  }

  const order =
    sort === 'name'
      ? [asc(project.name)]
      : sort === 'recent'
        ? [desc(project.updatedAt)]
        : [desc(project.momentumScore), desc(project.updatedAt)];
  return db
    .select()
    .from(project)
    .where(and(...filters))
    .orderBy(...order);
}

export async function projectStatusFacets(workspaceId: string) {
  const db = getDb();
  const rows = await db
    .select({
      status: project.status,
      count: sql<number>`count(*)::int`,
    })
    .from(project)
    .where(and(eq(project.workspaceId, workspaceId), isNull(project.deletedAt)))
    .groupBy(project.status);
  return rows;
}

export async function getProject(workspaceId: string, projectId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(project)
    .where(
      and(
        eq(project.id, projectId),
        eq(project.workspaceId, workspaceId),
        isNull(project.deletedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getProjectMomentum(workspaceId: string) {
  const db = getDb();
  return db
    .select({
      id: project.id,
      name: project.name,
      momentumScore: project.momentumScore,
      lastMeaningfulActivityAt: project.lastMeaningfulActivityAt,
      status: project.status,
    })
    .from(project)
    .where(and(eq(project.workspaceId, workspaceId), isNull(project.deletedAt)))
    .orderBy(desc(project.momentumScore));
}

export async function listOpenTasks(workspaceId: string) {
  const db = getDb();
  return db
    .select()
    .from(task)
    .where(
      and(
        eq(task.workspaceId, workspaceId),
        isNull(task.deletedAt),
        sql`${task.status} not in ('done','dropped')`,
      ),
    )
    .orderBy(desc(task.leverageScore), desc(task.updatedAt));
}

export async function listProjectTasks(workspaceId: string, projectId: string) {
  const db = getDb();
  return db
    .select()
    .from(task)
    .where(
      and(eq(task.workspaceId, workspaceId), eq(task.projectId, projectId), isNull(task.deletedAt)),
    )
    .orderBy(
      sql`case when ${task.status} = 'doing' then 0
              when ${task.status} = 'next' then 1
              when ${task.status} = 'inbox' then 2
              when ${task.status} = 'blocked' then 3
              when ${task.status} = 'done' then 4
              else 5 end`,
      desc(task.leverageScore),
      desc(task.updatedAt),
    );
}

export async function getTaskById(workspaceId: string, taskId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(task)
    .where(and(eq(task.id, taskId), eq(task.workspaceId, workspaceId), isNull(task.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listBlockedTasks(workspaceId: string) {
  const db = getDb();
  return db
    .select()
    .from(task)
    .where(
      and(eq(task.workspaceId, workspaceId), eq(task.status, 'blocked'), isNull(task.deletedAt)),
    )
    .orderBy(desc(task.updatedAt));
}

export interface ListAllTasksParams {
  workspaceId: string;
  status?: string | null;
  kind?: string | null;
  projectId?: string | null;
  /** today | overdue | week | none */
  due?: 'today' | 'overdue' | 'week' | 'none' | null;
  search?: string | null;
  includeDone?: boolean;
}

/**
 * Workspace-wide task list with the parent project's name joined, plus
 * optional filters. Used by the dedicated /tasks page. Ordered by a status
 * rank (doing → next → inbox → blocked → done → dropped), then leverage.
 */
export async function listAllTasks(params: ListAllTasksParams) {
  const db = getDb();
  const filters: SQL[] = [eq(task.workspaceId, params.workspaceId), isNull(task.deletedAt)];

  if (params.status) filters.push(sql`${task.status}::text = ${params.status}`);
  else if (!params.includeDone) filters.push(sql`${task.status} not in ('done','dropped')`);

  if (params.kind) filters.push(sql`${task.kind}::text = ${params.kind}`);
  if (params.projectId) filters.push(eq(task.projectId, params.projectId));

  if (params.search && params.search.trim()) {
    const q = `%${params.search.trim()}%`;
    filters.push(sql`(${task.title} ilike ${q} or coalesce(${task.body}, '') ilike ${q})`);
  }

  if (params.due === 'overdue') {
    filters.push(sql`${task.dueAt} is not null and ${task.dueAt} < now()`);
  } else if (params.due === 'today') {
    filters.push(sql`${task.dueAt} is not null and ${task.dueAt}::date = now()::date`);
  } else if (params.due === 'week') {
    filters.push(sql`${task.dueAt} is not null and ${task.dueAt} < now() + interval '7 days'`);
  } else if (params.due === 'none') {
    filters.push(sql`${task.dueAt} is null`);
  }

  return db
    .select({
      id: task.id,
      title: task.title,
      body: task.body,
      status: task.status,
      kind: task.kind,
      leverageScore: task.leverageScore,
      blockedReason: task.blockedReason,
      dueAt: task.dueAt,
      projectId: task.projectId,
      projectName: project.name,
      goalId: task.goalId,
      aiSuggested: task.aiSuggested,
      sourceApp: task.sourceApp,
      sourceUrl: task.sourceUrl,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    })
    .from(task)
    .leftJoin(project, eq(project.id, task.projectId))
    .where(and(...filters))
    .orderBy(
      sql`case when ${task.status} = 'doing' then 0
              when ${task.status} = 'next' then 1
              when ${task.status} = 'inbox' then 2
              when ${task.status} = 'blocked' then 3
              when ${task.status} = 'done' then 4
              else 5 end`,
      desc(task.leverageScore),
      desc(task.updatedAt),
    );
}

export async function recentDecisions(workspaceId: string, limit = 10) {
  const db = getDb();
  return db
    .select()
    .from(decision)
    .where(and(eq(decision.workspaceId, workspaceId), isNull(decision.deletedAt)))
    .orderBy(desc(decision.decidedAt))
    .limit(limit);
}

export async function listProjectDecisions(workspaceId: string, projectId: string, limit = 50) {
  const db = getDb();
  return db
    .select()
    .from(decision)
    .where(
      and(
        eq(decision.workspaceId, workspaceId),
        eq(decision.projectId, projectId),
        isNull(decision.deletedAt),
      ),
    )
    .orderBy(desc(decision.decidedAt))
    .limit(limit);
}

export async function getDecisionById(workspaceId: string, decisionId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(decision)
    .where(
      and(
        eq(decision.id, decisionId),
        eq(decision.workspaceId, workspaceId),
        isNull(decision.deletedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Distinct stack tags discovered across non-deleted projects in a workspace. */
export async function listAvailableStackTags(workspaceId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db.execute<{ tag: string }>(
    sql`
      select distinct jsonb_array_elements_text(coalesce(metadata -> 'stack', '[]'::jsonb)) as tag
      from project
      where workspace_id = ${workspaceId} and deleted_at is null
      order by tag asc
    `,
  );
  // pg drivers wrap rows differently; normalize.
  const list =
    (rows as unknown as { rows?: { tag: string }[] }).rows ??
    (rows as unknown as { tag: string }[]);
  return Array.isArray(list) ? list.map((r) => r.tag).filter(Boolean) : [];
}

/** Per-project counts of open tasks, blocked tasks, and goals — for project cards. */
export async function listProjectsCounts(workspaceId: string, projectIds: string[]) {
  if (projectIds.length === 0)
    return new Map<string, { openTasks: number; blockedTasks: number; goals: number }>();
  const db = getDb();
  const taskRows = await db
    .select({
      projectId: task.projectId,
      open: sql<number>`count(*) filter (where ${task.status} not in ('done','dropped'))::int`,
      blocked: sql<number>`count(*) filter (where ${task.status} = 'blocked')::int`,
    })
    .from(task)
    .where(
      and(
        eq(task.workspaceId, workspaceId),
        isNull(task.deletedAt),
        inArray(task.projectId, projectIds),
      ),
    )
    .groupBy(task.projectId);

  const goalRows = await db
    .select({
      projectId: goal.projectId,
      count: sql<number>`count(*)::int`,
    })
    .from(goal)
    .where(
      and(
        eq(goal.workspaceId, workspaceId),
        isNull(goal.deletedAt),
        inArray(goal.projectId, projectIds),
      ),
    )
    .groupBy(goal.projectId);

  const map = new Map<string, { openTasks: number; blockedTasks: number; goals: number }>();
  for (const id of projectIds) map.set(id, { openTasks: 0, blockedTasks: 0, goals: 0 });
  for (const r of taskRows) {
    if (!r.projectId) continue;
    const e = map.get(r.projectId)!;
    e.openTasks = r.open ?? 0;
    e.blockedTasks = r.blocked ?? 0;
  }
  for (const r of goalRows) {
    if (!r.projectId) continue;
    const e = map.get(r.projectId)!;
    e.goals = r.count ?? 0;
  }
  return map;
}

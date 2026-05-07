import { and, desc, eq, ilike, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '../client';
import { capture, memoryChunk, project, timelineEvent } from '../schema';

export async function listRecentCaptures(workspaceId: string, limit = 50) {
  const db = getDb();
  return db
    .select()
    .from(capture)
    .where(and(eq(capture.workspaceId, workspaceId), isNull(capture.deletedAt)))
    .orderBy(desc(capture.capturedAt))
    .limit(limit);
}

export interface ListCapturesParams {
  workspaceId: string;
  limit?: number;
  cursor?: string | null;
  kind?: string | null;
  status?: string | null;
  source?: string | null;
  projectId?: string | null;
  search?: string | null;
}

/**
 * Filtered + cursor-paginated capture listing.
 * Cursor is an ISO `capturedAt` from the last row; rows older than that are returned.
 */
export async function listCaptures({
  workspaceId,
  limit = 30,
  cursor = null,
  kind = null,
  status = null,
  source = null,
  projectId = null,
  search = null,
}: ListCapturesParams) {
  const db = getDb();
  const filters: SQL[] = [eq(capture.workspaceId, workspaceId), isNull(capture.deletedAt)];
  if (kind) filters.push(sql`${capture.kind}::text = ${kind}`);
  if (status) filters.push(sql`${capture.status}::text = ${status}`);
  if (source) filters.push(eq(capture.source, source));
  if (projectId) filters.push(eq(capture.projectId, projectId));
  if (cursor) filters.push(lt(capture.capturedAt, new Date(cursor)));
  if (search && search.trim()) {
    const q = `%${search.trim()}%`;
    const matched = or(ilike(capture.content, q), ilike(capture.sourceUrl, q));
    if (matched) filters.push(matched);
  }
  const rows = await db
    .select()
    .from(capture)
    .where(and(...filters))
    .orderBy(desc(capture.capturedAt))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const trimmed = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore
    ? (trimmed[trimmed.length - 1]?.capturedAt.toISOString() ?? null)
    : null;
  return { rows: trimmed, nextCursor, hasMore };
}

export async function getCaptureById(workspaceId: string, id: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(capture)
    .where(and(eq(capture.id, id), eq(capture.workspaceId, workspaceId), isNull(capture.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function captureFacets(workspaceId: string) {
  const db = getDb();
  const rows = await db
    .select({
      kind: capture.kind,
      status: capture.status,
      source: capture.source,
      count: sql<number>`count(*)::int`,
    })
    .from(capture)
    .where(and(eq(capture.workspaceId, workspaceId), isNull(capture.deletedAt)))
    .groupBy(capture.kind, capture.status, capture.source);
  const kinds = new Map<string, number>();
  const statuses = new Map<string, number>();
  const sources = new Map<string, number>();
  for (const r of rows) {
    kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + r.count);
    statuses.set(r.status, (statuses.get(r.status) ?? 0) + r.count);
    sources.set(r.source, (sources.get(r.source) ?? 0) + r.count);
  }
  return {
    kinds: Array.from(kinds, ([value, count]) => ({ value, count })),
    statuses: Array.from(statuses, ([value, count]) => ({ value, count })),
    sources: Array.from(sources, ([value, count]) => ({ value, count })),
  };
}

export interface RecallParams {
  workspaceId: string;
  embedding: number[];
  projectId?: string;
  limit?: number;
}

/**
 * Hybrid recall — pgvector cosine similarity + recency boost.
 * Returns the top-k chunks, each annotated with similarity ∈ [0,1].
 */
export async function recallByEmbedding({
  workspaceId,
  embedding,
  projectId,
  limit = 10,
}: RecallParams) {
  const db = getDb();
  const vec = sql.raw(`'[${embedding.join(',')}]'::vector`);
  const projectFilter = projectId ? sql`and ${memoryChunk.projectId} = ${projectId}` : sql``;

  return db.execute<{
    id: string;
    content: string;
    similarity: number;
    source_kind: string;
    source_id: string | null;
    project_id: string | null;
    created_at: string;
  }>(sql`
    select
      id,
      content,
      source_kind,
      source_id,
      project_id,
      created_at,
      1 - (embedding <=> ${vec}) as similarity
    from ${memoryChunk}
    where ${memoryChunk.workspaceId} = ${workspaceId}
      and embedding is not null
      ${projectFilter}
    order by embedding <=> ${vec}
    limit ${limit}
  `);
}

export async function appendTimelineEvent(input: {
  workspaceId: string;
  userId?: string | null;
  projectId?: string | null;
  kind: string;
  title: string;
  body?: string;
  payload?: Record<string, unknown>;
  importance?: number;
}) {
  const db = getDb();
  const [row] = await db
    .insert(timelineEvent)
    .values({
      workspaceId: input.workspaceId,
      userId: input.userId ?? null,
      projectId: input.projectId ?? null,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      payload: input.payload ?? {},
      importance: input.importance ?? 0.5,
    })
    .returning();
  return row;
}

export async function listTimeline(workspaceId: string, limit = 50, projectId?: string) {
  const db = getDb();
  return db
    .select()
    .from(timelineEvent)
    .where(
      and(
        eq(timelineEvent.workspaceId, workspaceId),
        projectId ? eq(timelineEvent.projectId, projectId) : sql`true`,
      ),
    )
    .orderBy(desc(timelineEvent.occurredAt))
    .limit(limit);
}

export interface ListTimelineFilteredParams {
  workspaceId: string;
  kinds?: string[];
  projectId?: string | null;
  since?: Date | null;
  until?: Date | null;
  search?: string | null;
  cursor?: { occurredAt: Date; id: string } | null;
  limit?: number;
}

export async function listTimelineFiltered({
  workspaceId,
  kinds,
  projectId,
  since,
  until,
  search,
  cursor,
  limit = 40,
}: ListTimelineFilteredParams) {
  const db = getDb();
  const conditions: SQL[] = [eq(timelineEvent.workspaceId, workspaceId)];
  if (kinds && kinds.length > 0) conditions.push(inArray(timelineEvent.kind, kinds));
  if (projectId) conditions.push(eq(timelineEvent.projectId, projectId));
  if (since) conditions.push(sql`${timelineEvent.occurredAt} >= ${since}`);
  if (until) conditions.push(sql`${timelineEvent.occurredAt} <= ${until}`);
  if (search && search.trim()) {
    const q = `%${search.trim()}%`;
    const orClause = or(ilike(timelineEvent.title, q), ilike(timelineEvent.body, q));
    if (orClause) conditions.push(orClause);
  }
  if (cursor) {
    // Keyset: occurredAt < cursor.occurredAt OR (= AND id < cursor.id)
    conditions.push(
      sql`(${timelineEvent.occurredAt}, ${timelineEvent.id}) < (${cursor.occurredAt}, ${cursor.id})`,
    );
  }
  const rows = await db
    .select()
    .from(timelineEvent)
    .where(and(...conditions))
    .orderBy(desc(timelineEvent.occurredAt), desc(timelineEvent.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last ? { occurredAt: last.occurredAt.toISOString(), id: last.id } : null;
  return { items, nextCursor };
}

export async function timelineKindFacets(workspaceId: string, since?: Date | null) {
  const db = getDb();
  const conds: SQL[] = [eq(timelineEvent.workspaceId, workspaceId)];
  if (since) conds.push(sql`${timelineEvent.occurredAt} >= ${since}`);
  const rows = await db
    .select({
      kind: timelineEvent.kind,
      count: sql<number>`count(*)::int`,
    })
    .from(timelineEvent)
    .where(and(...conds))
    .groupBy(timelineEvent.kind)
    .orderBy(desc(sql`count(*)`));
  return rows;
}

export async function listTimelineProjectsForFilter(workspaceId: string) {
  const db = getDb();
  return db
    .select({ id: project.id, name: project.name })
    .from(project)
    .where(and(eq(project.workspaceId, workspaceId), isNull(project.deletedAt)))
    .orderBy(project.name);
}

export async function getTimelineEventById(workspaceId: string, id: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(timelineEvent)
    .where(and(eq(timelineEvent.workspaceId, workspaceId), eq(timelineEvent.id, id)))
    .limit(1);
  return row ?? null;
}

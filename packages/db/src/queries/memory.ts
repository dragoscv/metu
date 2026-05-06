import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '../client';
import { capture, memoryChunk, timelineEvent } from '../schema';

export async function listRecentCaptures(workspaceId: string, limit = 50) {
  const db = getDb();
  return db
    .select()
    .from(capture)
    .where(and(eq(capture.workspaceId, workspaceId), isNull(capture.deletedAt)))
    .orderBy(desc(capture.capturedAt))
    .limit(limit);
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

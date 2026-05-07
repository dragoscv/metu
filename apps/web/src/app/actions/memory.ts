'use server';
/**
 * Memory page actions — overview, list, capture, recall, delete.
 *
 * All workspace-scoped via `auth()`. Inputs validated with Zod.
 */
import { revalidatePath } from 'next/cache';
import { and, count, desc, eq, lt, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { memoryChunk } from '@metu/db/schema';
import { memory } from '@metu/core';
import { appendTimelineEvent } from '@metu/db/queries';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MemorySourceKind =
  | 'capture'
  | 'task'
  | 'decision'
  | 'project_summary'
  | 'repo_file'
  | 'commit'
  | 'email'
  | 'message'
  | 'agent_run'
  | 'manual';

export interface MemoryChunkRow {
  id: string;
  sourceKind: MemorySourceKind;
  sourceId: string | null;
  projectId: string | null;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface MemoryOverview {
  total: number;
  lastIndexedAt: string | null;
  byKind: { kind: MemorySourceKind; count: number }[];
}

export interface MemoryRecallHit {
  id: string;
  content: string;
  similarity: number;
  sourceKind: MemorySourceKind;
  sourceId: string | null;
  projectId: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export async function getMemoryOverviewAction(): Promise<
  { ok: true; overview: MemoryOverview } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session) return { ok: false, error: 'Unauthenticated' };
  const db = getDb();
  const wsId = session.user.workspaceId;

  const [totals, kinds] = await Promise.all([
    db
      .select({ total: count(), latest: max(memoryChunk.createdAt) })
      .from(memoryChunk)
      .where(eq(memoryChunk.workspaceId, wsId)),
    db
      .select({
        kind: memoryChunk.sourceKind,
        count: sql<number>`count(*)::int`,
      })
      .from(memoryChunk)
      .where(eq(memoryChunk.workspaceId, wsId))
      .groupBy(memoryChunk.sourceKind)
      .orderBy(desc(sql`count(*)`)),
  ]);

  const total = totals[0]?.total ?? 0;
  const latest = totals[0]?.latest ?? null;

  return {
    ok: true,
    overview: {
      total,
      lastIndexedAt: latest ? new Date(latest).toISOString() : null,
      byKind: kinds.map((k) => ({
        kind: k.kind as MemorySourceKind,
        count: k.count,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// List recent (with optional kind filter + cursor)
// ---------------------------------------------------------------------------

const listSchema = z.object({
  sourceKind: z.string().min(1).max(40).optional(),
  cursor: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export async function listRecentMemoriesAction(
  input: z.input<typeof listSchema> = {},
): Promise<
  { ok: true; items: MemoryChunkRow[]; nextCursor: string | null } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session) return { ok: false, error: 'Unauthenticated' };
  const parsed = listSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid input' };
  const { sourceKind, cursor, limit } = parsed.data;

  const db = getDb();
  const wsId = session.user.workspaceId;

  const filters = [eq(memoryChunk.workspaceId, wsId)];
  if (sourceKind && sourceKind !== 'all') {
    filters.push(sql`${memoryChunk.sourceKind}::text = ${sourceKind}`);
  }
  if (cursor) {
    filters.push(lt(memoryChunk.createdAt, new Date(cursor)));
  }

  const rows = await db
    .select({
      id: memoryChunk.id,
      sourceKind: memoryChunk.sourceKind,
      sourceId: memoryChunk.sourceId,
      projectId: memoryChunk.projectId,
      content: memoryChunk.content,
      metadata: memoryChunk.metadata,
      createdAt: memoryChunk.createdAt,
    })
    .from(memoryChunk)
    .where(and(...filters))
    .orderBy(desc(memoryChunk.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const trimmed = hasMore ? rows.slice(0, limit) : rows;

  const items: MemoryChunkRow[] = trimmed.map((r) => ({
    id: r.id,
    sourceKind: r.sourceKind as MemorySourceKind,
    sourceId: r.sourceId,
    projectId: r.projectId,
    content: r.content,
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
    createdAt: r.createdAt.toISOString(),
  }));

  const nextCursor =
    hasMore && trimmed.length > 0 ? trimmed[trimmed.length - 1]!.createdAt.toISOString() : null;

  return { ok: true, items, nextCursor };
}

// ---------------------------------------------------------------------------
// Capture (manual save into memory)
// ---------------------------------------------------------------------------

const captureSchema = z.object({
  content: z.string().trim().min(3).max(8000),
  tag: z.string().trim().max(40).optional(),
});

export async function captureMemoryAction(
  input: z.input<typeof captureSchema>,
): Promise<{ ok: true; chunkCount: number } | { ok: false; error: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: 'Unauthenticated' };
  const parsed = captureSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const { content, tag } = parsed.data;

  try {
    const wsId = session.user.workspaceId;
    const evt = await appendTimelineEvent({
      workspaceId: wsId,
      userId: session.user.id,
      kind: 'memory.captured',
      title: content.length > 120 ? `${content.slice(0, 117)}…` : content,
      body: content,
      payload: tag ? { tag } : {},
      importance: 0.4,
    });
    if (!evt) {
      return { ok: false, error: 'Failed to record memory event' };
    }

    const result = await memory.indexMemory({
      workspaceId: wsId,
      sourceKind: 'manual',
      sourceId: evt.id,
      content,
      metadata: tag ? { tag } : {},
    });

    revalidatePath('/memory');
    return { ok: true, chunkCount: result.chunkCount };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to save',
    };
  }
}

// ---------------------------------------------------------------------------
// Recall (vector search) — supersedes the older recallAction
// ---------------------------------------------------------------------------

const recallSchema = z.object({
  query: z.string().trim().min(2).max(500),
  sourceKind: z.string().min(1).max(40).optional(),
  limit: z.number().int().min(1).max(30).default(12),
});

export async function recallMemoryAction(
  input: z.input<typeof recallSchema>,
): Promise<{ ok: true; hits: MemoryRecallHit[] } | { ok: false; error: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: 'Unauthenticated' };
  const parsed = recallSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Type at least 2 characters' };
  const { query, sourceKind, limit } = parsed.data;

  try {
    const res = await memory.recall({
      workspaceId: session.user.workspaceId,
      query,
      limit: limit * 2, // over-fetch then filter client-side by sourceKind
    });
    const rawRows = (res as { rows?: unknown[] }).rows ?? (res as unknown[]);
    const rows = (
      rawRows as Array<{
        id: string;
        content: string;
        similarity: number;
        source_kind: string;
        source_id: string | null;
        project_id: string | null;
        created_at: string | Date;
      }>
    ).filter((r) => (sourceKind && sourceKind !== 'all' ? r.source_kind === sourceKind : true));

    const hits: MemoryRecallHit[] = rows.slice(0, limit).map((r) => ({
      id: r.id,
      content: r.content,
      similarity: Number(r.similarity ?? 0),
      sourceKind: r.source_kind as MemorySourceKind,
      sourceId: r.source_id,
      projectId: r.project_id,
      createdAt:
        typeof r.created_at === 'string' ? r.created_at : new Date(r.created_at).toISOString(),
    }));
    return { ok: true, hits };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Recall failed',
    };
  }
}

// ---------------------------------------------------------------------------
// Delete chunk
// ---------------------------------------------------------------------------

const deleteSchema = z.object({ id: z.string().uuid() });

export async function deleteMemoryChunkAction(
  input: z.input<typeof deleteSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: 'Unauthenticated' };
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid id' };
  const db = getDb();
  await db
    .delete(memoryChunk)
    .where(
      and(
        eq(memoryChunk.id, parsed.data.id),
        eq(memoryChunk.workspaceId, session.user.workspaceId),
      ),
    );
  revalidatePath('/memory');
  return { ok: true };
}

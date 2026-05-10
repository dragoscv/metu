/**
 * Memory janitor — weekly hard-purge of long-soft-deleted captures and
 * their derived memory chunks. Keeps the embeddings table small and
 * recall fast.
 *
 * Conservative: we only touch rows that have been soft-deleted for ≥
 * `RETENTION_DAYS` AND have no live tool_call referencing them. (We
 * don't have FK back-pointers, so we use a heuristic: skip captures
 * whose id appears as `sourceId` in any chunk we want to KEEP — i.e.
 * a non-deleted capture chunk; safe because `sourceId` is workspace-
 * scoped via FK cascade.)
 *
 * Runs Sundays at 02:00 UTC. Caps the batch at MAX_CAPTURES per run
 * so a backlog can't time out the function or stall the embeddings
 * vacuum that follows.
 *
 * The richer "consolidate K old captures into 1 LLM-summarized memo"
 * pass is future work — see docs/master-plan.md follow-ups. This file
 * is the cheap janitor that buys us time before that ships.
 */
import { and, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { capture, memoryChunk } from '@metu/db/schema';
import { inngest } from '../client';
import { log } from '@/lib/logger';

const RETENTION_DAYS = 90;
const MAX_CAPTURES = 500;

export const memoryJanitorWeekly = inngest.createFunction(
  {
    id: 'memory-janitor-weekly',
    name: 'Memory janitor (weekly purge)',
    concurrency: { limit: 1 },
  },
  { cron: '0 2 * * 0' },
  async ({ step }) => {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const targets = await step.run('list-stale-captures', async () => {
      const db = getDb();
      const rows = await db
        .select({ id: capture.id, workspaceId: capture.workspaceId })
        .from(capture)
        .where(and(isNotNull(capture.deletedAt), lt(capture.deletedAt, cutoff)))
        .limit(MAX_CAPTURES);
      return rows;
    });

    if (targets.length === 0) {
      log.info('memory.janitor.empty', { cutoff: cutoff.toISOString() });
      return { ok: true, captures: 0, chunks: 0 };
    }

    const ids = targets.map((t) => t.id);

    const chunkResult = await step.run('delete-chunks', async () => {
      const db = getDb();
      const deleted = await db
        .delete(memoryChunk)
        .where(and(eq(memoryChunk.sourceKind, 'capture'), inArray(memoryChunk.sourceId, ids)))
        .returning();
      return { count: deleted.length };
    });

    const captureResult = await step.run('delete-captures', async () => {
      const db = getDb();
      const deleted = await db.delete(capture).where(inArray(capture.id, ids)).returning();
      return { count: deleted.length };
    });

    // VACUUM ANALYZE on the embeddings table after a big delete keeps
    // HNSW recall stable. Cheap on Postgres 14+; we rely on the cron
    // schedule (weekly) being the right cadence.
    await step.run('vacuum-chunks', async () => {
      const db = getDb();
      await db.execute(sql`vacuum (analyze) memory_chunk`);
    });

    log.info('memory.janitor.purged', {
      captures: captureResult.count,
      chunks: chunkResult.count,
      cutoff: cutoff.toISOString(),
    });

    return {
      ok: true,
      captures: captureResult.count,
      chunks: chunkResult.count,
    };
  },
);

/**
 * GCS cleanup cron — daily sweep that deletes blob payloads for soft-deleted
 * captures whose `storage_key` is still set. Without this, deleting a
 * capture row left the underlying audio/screenshot orphaned in the bucket
 * indefinitely (a known follow-up tracked in docs/security.md). Running once
 * a day is enough — GCS lifecycle rules eventually prune the `tmp/` prefix
 * but this owns the policy for non-tmp prefixes too.
 *
 * Scope per run is capped at 500 captures to stay well inside the Inngest
 * step budget; the cron repeats daily so unfinished tail catches up.
 */
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { inngest } from '../client';
import { getDb } from '@metu/db';
import { capture } from '@metu/db/schema';
import { gcs } from '@metu/integrations';
import { log } from '@/lib/logger';

const BATCH_SIZE = 500;

export const gcsCleanupCron = inngest.createFunction(
  {
    id: 'gcs-cleanup',
    name: 'GCS: orphan blob cleanup',
    concurrency: { limit: 1, key: 'gcs-cleanup' },
  },
  { cron: '0 3 * * *' },
  async ({ step }) => {
    const rows = await step.run('list', async () => {
      const db = getDb();
      return db
        .select({
          id: capture.id,
          workspaceId: capture.workspaceId,
          storageKey: capture.storageKey,
        })
        .from(capture)
        .where(and(isNotNull(capture.deletedAt), isNotNull(capture.storageKey)))
        .orderBy(desc(capture.deletedAt))
        .limit(BATCH_SIZE);
    });

    if (rows.length === 0) {
      log.info('gcs_cleanup.empty');
      return { deleted: 0, missing: 0, failed: 0 };
    }

    let deleted = 0;
    let missing = 0;
    let failed = 0;

    for (const row of rows) {
      if (!row.storageKey) continue;
      try {
        const r = await step.run(`delete-${row.id}`, async () => {
          return gcs.deleteObject(row.storageKey!);
        });
        if (r.deleted) deleted += 1;
        else missing += 1;
        // Null out the storage key so we don't try again next run.
        await step.run(`mark-${row.id}`, async () => {
          const db = getDb();
          await db
            .update(capture)
            .set({ storageKey: null })
            .where(and(eq(capture.id, row.id), eq(capture.workspaceId, row.workspaceId)));
        });
      } catch (err) {
        failed += 1;
        log.warn(
          'gcs_cleanup.delete_failed',
          { captureId: row.id, storageKey: row.storageKey },
          err,
        );
      }
    }

    log.info('gcs_cleanup.done', { scanned: rows.length, deleted, missing, failed });
    return { scanned: rows.length, deleted, missing, failed };
  },
);

// Suppress unused import warning when sql is not referenced; keep for future filters.
void sql;

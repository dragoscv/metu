/**
 * Hub DLQ replay — every 5 minutes, re-attempt pending dead-lettered
 * hub broadcasts so that a temporary hub outage doesn't permanently
 * lose notifications / tool invocations.
 *
 * Conservative policy:
 * - Only rows with attempts < MAX_ATTEMPTS are retried; beyond that the
 *   row stays pending for manual operator replay via /admin/hub-dlq.
 * - Small batch per run (MAX_BATCH) so a large backlog can't stall the
 *   function; the next cron tick picks up the rest.
 * - Backoff: skip rows whose lastAttemptAt is more recent than
 *   MIN_RETRY_GAP_MS (avoids hammering a hub that's still down).
 */
import { and, asc, eq, isNull, lt, sql } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { hubDlqEnvelope } from '@metu/db/schema';
import { hubBroadcast, type DeviceKindFilter, type ServerEvent } from '@/lib/hub';
import { inngest } from '../client';
import { log } from '@/lib/logger';

const MAX_ATTEMPTS = 10;
const MAX_BATCH = 50;
const MIN_RETRY_GAP_MS = 4 * 60 * 1000; // just under the cron cadence

export const hubDlqReplay = inngest.createFunction(
  {
    id: 'hub-dlq-replay',
    name: 'Hub DLQ replay (5-min retry)',
    concurrency: { limit: 1 },
  },
  { cron: '*/5 * * * *' },
  async ({ step }) => {
    const targets = await step.run('list-pending', async () => {
      const db = getDb();
      const retryCutoff = new Date(Date.now() - MIN_RETRY_GAP_MS);
      // workspace-scope-ignore: cross-tenant operator cron by design;
      // rows are replayed to their own workspace via row.workspaceId.
      const rows = await db
        .select()
        .from(hubDlqEnvelope)
        .where(
          and(
            isNull(hubDlqEnvelope.replayedAt),
            lt(hubDlqEnvelope.attempts, MAX_ATTEMPTS),
            lt(hubDlqEnvelope.lastAttemptAt, retryCutoff),
          ),
        )
        .orderBy(asc(hubDlqEnvelope.createdAt))
        .limit(MAX_BATCH);
      return rows;
    });

    if (targets.length === 0) return { ok: true, replayed: 0, failed: 0 };

    const result = await step.run('replay-batch', async () => {
      const db = getDb();
      let replayed = 0;
      let failed = 0;
      for (const row of targets) {
        const res = await hubBroadcast({
          workspaceId: row.workspaceId,
          envelope: row.envelope as ServerEvent,
          kinds: (row.kinds as DeviceKindFilter[]) ?? undefined,
          deviceIds: (row.deviceIds as string[]) ?? undefined,
        });
        if (res) {
          await db
            .update(hubDlqEnvelope)
            .set({ replayedAt: sql`now()`, lastAttemptAt: sql`now()` })
            .where(
              and(eq(hubDlqEnvelope.id, row.id), eq(hubDlqEnvelope.workspaceId, row.workspaceId)),
            );
          replayed++;
        } else {
          await db
            .update(hubDlqEnvelope)
            .set({ attempts: sql`${hubDlqEnvelope.attempts} + 1`, lastAttemptAt: sql`now()` })
            .where(
              and(eq(hubDlqEnvelope.id, row.id), eq(hubDlqEnvelope.workspaceId, row.workspaceId)),
            );
          failed++;
        }
      }
      return { replayed, failed };
    });

    log.info('hub.dlq.replay', {
      batch: targets.length,
      replayed: result.replayed,
      failed: result.failed,
    });
    return { ok: true, ...result };
  },
);

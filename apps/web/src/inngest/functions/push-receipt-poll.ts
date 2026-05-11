/**
 * Push receipt poll.
 *
 * Every 15 minutes, picks up to 1000 `push_receipt` rows still in
 * `status='pending'` (and < 24h old — Expo discards receipts after that
 * window so older rows can never resolve), groups them in chunks of 1000
 * (Expo's documented max), and calls `getPushNotificationReceiptsAsync`.
 *
 * For each receipt:
 *   - status 'ok'                     → mark row 'ok'
 *   - status 'error' DeviceNotRegistered → mark 'error', disable the subscription
 *   - status 'error' other            → mark 'error', leave subscription as-is
 *
 * Rows that didn't resolve are left as 'pending' for the next tick. If a
 * pending row is older than 24h the cron promotes it to 'error' with
 * code 'expired' (Expo will never return it).
 */
import { and, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import { Expo } from 'expo-server-sdk';
import { getDb } from '@metu/db';
import { notificationSubscription, pushReceipt } from '@metu/db/schema';
import { inngest } from '../client';
import { log } from '@/lib/logger';

const MAX_PER_TICK = 1000;
const RECEIPT_TTL_HOURS = 24;

export const pushReceiptPollCron = inngest.createFunction(
  { id: 'push-receipt-poll-cron', name: 'Push receipt poll' },
  { cron: '*/15 * * * *' },
  async ({ step }) => {
    const db = getDb();
    const cutoff = new Date(Date.now() - RECEIPT_TTL_HOURS * 60 * 60 * 1000);

    // 1. Promote stale pending rows to 'error' with code='expired'. Expo
    //    no longer holds receipts past 24h so polling them is hopeless.
    const expired = await step.run('expire-stale', async () => {
      const rows = await db
        .update(pushReceipt)
        .set({ status: 'error', errorCode: 'expired', checkedAt: sql`now()` })
        .where(and(eq(pushReceipt.status, 'pending'), lt(pushReceipt.createdAt, cutoff)))
        .returning();
      return rows.length;
    });

    // 2. Fetch a batch of fresh pending rows.
    const pending = await db
      .select({
        id: pushReceipt.id,
        ticketId: pushReceipt.ticketId,
        subId: pushReceipt.subscriptionId,
      })
      .from(pushReceipt)
      .where(and(eq(pushReceipt.status, 'pending'), gt(pushReceipt.createdAt, cutoff)))
      .limit(MAX_PER_TICK);

    if (pending.length === 0) {
      log.info('push.receipt.poll.empty', { expired });
      return { polled: 0, ok: 0, error: 0, expired };
    }

    const expo = new Expo();
    const ticketIds = pending.map((r) => r.ticketId);
    const idToRow = new Map(pending.map((r) => [r.ticketId, r] as const));

    let okCount = 0;
    let errCount = 0;
    const disabledSubs = new Set<string>();

    const chunks = expo.chunkPushNotificationReceiptIds(ticketIds);
    for (const chunk of chunks) {
      try {
        const receipts = await expo.getPushNotificationReceiptsAsync(chunk);
        for (const [tid, receipt] of Object.entries(receipts)) {
          const row = idToRow.get(tid);
          if (!row) continue;
          if (receipt.status === 'ok') {
            okCount++;
            await db
              .update(pushReceipt)
              .set({ status: 'ok', checkedAt: sql`now()` })
              .where(eq(pushReceipt.id, row.id));
          } else {
            errCount++;
            const code = (receipt.details as { error?: string } | undefined)?.error ?? 'unknown';
            await db
              .update(pushReceipt)
              .set({ status: 'error', errorCode: code, checkedAt: sql`now()` })
              .where(eq(pushReceipt.id, row.id));
            if (code === 'DeviceNotRegistered') disabledSubs.add(row.subId);
          }
        }
      } catch (err) {
        log.error('push.receipt.poll.fetch_failed', { chunkSize: chunk.length }, err);
      }
    }

    if (disabledSubs.size > 0) {
      await db
        .update(notificationSubscription)
        .set({ enabled: false })
        .where(inArray(notificationSubscription.id, Array.from(disabledSubs)));
    }

    log.info('push.receipt.poll.done', {
      polled: pending.length,
      ok: okCount,
      error: errCount,
      expired,
      disabled: disabledSubs.size,
    });

    return { polled: pending.length, ok: okCount, error: errCount, expired };
  },
);

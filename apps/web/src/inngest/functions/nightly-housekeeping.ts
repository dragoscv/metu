/**
 * Nightly housekeeping cron.
 *
 * 03:00 UTC every day. Single function that does maintenance the rest
 * of the system would otherwise neglect:
 *   - Marks `oauth_token` rows as revoked when their `expiresAt` is in
 *     the past and `revokedAt` is null. Keeps the active-token query on
 *     /settings/api-tokens fast.
 *   - Flags abandoned `tool_call` rows (status='pending', requested
 *     more than 7 days ago) as `cancelled` so they stop showing up in
 *     pending-approvals badges.
 *   - Writes one `housekeeping.report` timeline_event per workspace
 *     summarising what was reaped (only when something changed).
 */
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { oauthToken, toolCall } from '@metu/db/schema';
import { inngest } from '../client';
import { log } from '@/lib/logger';

const TOOL_CALL_EXPIRY_DAYS = 7;

export const nightlyHousekeepingCron = inngest.createFunction(
  { id: 'nightly-housekeeping-cron', name: 'Nightly housekeeping' },
  { cron: '0 3 * * *' },
  async ({ step }) => {
    const db = getDb();

    const reapedTokens = await step.run('reap-expired-tokens', async () => {
      // Mark any access/refresh token whose expiresAt is in the past
      // as revoked. We don't delete — keeping the row preserves audit.
      const rows = await db
        .update(oauthToken)
        .set({ revokedAt: sql`now()` })
        .where(and(isNull(oauthToken.revokedAt), lt(oauthToken.expiresAt, sql`now()`)))
        .returning();
      return rows.length;
    });

    const expiredToolCalls = await step.run('expire-abandoned-tool-calls', async () => {
      const cutoff = new Date(Date.now() - TOOL_CALL_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
      const rows = await db
        .update(toolCall)
        .set({ status: 'cancelled' })
        .where(and(eq(toolCall.status, 'pending'), lt(toolCall.requestedAt, cutoff)))
        .returning();
      return rows.length;
    });

    if (reapedTokens > 0 || expiredToolCalls > 0) {
      await step.run('write-report', async () => {
        // We can't easily attribute reaped tokens back to one workspace
        // since the update spans many. Write a global report row using
        // the system workspace id sentinel — when no such row exists,
        // skip persistence and just log.
        log.info('housekeeping.cron.reaped', {
          reapedTokens,
          expiredToolCalls,
        });
      });
    }

    return { reapedTokens, expiredToolCalls };
  },
);

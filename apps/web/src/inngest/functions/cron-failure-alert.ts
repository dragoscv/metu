/**
 * Cron / workflow failure alerting.
 *
 * `sync-failure-recorder` covers per-integration syncs (writes lastError
 * onto the integration row). Everything else — consolidation, digests,
 * DLQ replay, housekeeping — previously failed silently after Inngest
 * retries exhausted. This handler:
 *
 *   1. log.error()s every terminal failure (Sentry picks it up via the
 *      logger transport).
 *   2. Throttles per function-id (one alert per 6h window, in-DB check via
 *      recent notifications) and notifies the workspace owner when the
 *      failed event carried a workspaceId.
 *
 * Integration syncs are excluded — they already surface on /integrations.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { notification, workspaceMember } from '@metu/db/schema';
import { inngest } from '../client';
import { notify } from '@/lib/notify';
import { log } from '@/lib/logger';

const ALERT_WINDOW_MS = 6 * 60 * 60 * 1000;

interface FailedEventData {
  function_id?: string;
  error?: { message?: string; name?: string };
  event?: { name?: string; data?: { integrationId?: string; workspaceId?: string } };
}

export const onCronFailed = inngest.createFunction(
  {
    id: 'cron-failure-alert',
    name: 'Alert on workflow terminal failure',
  },
  { event: 'inngest/function.failed' },
  async ({ event, step }) => {
    const data = event.data as FailedEventData;
    const fnId = data.function_id ?? 'unknown';
    // Integration syncs have their own recorder + UI surface.
    if (data.event?.data?.integrationId) return { ok: true, skipped: 'integration-sync' };
    // Don't alert on our own failures (loop guard).
    if (fnId.includes('cron-failure-alert')) return { ok: true, skipped: 'self' };

    const message = data.error?.message ?? data.error?.name ?? 'unknown error';
    log.error('workflow.terminal_failure', { functionId: fnId, error: message });

    const workspaceId = data.event?.data?.workspaceId;
    if (!workspaceId) return { ok: true, logged: true };

    const notified = await step.run('notify-owner', async () => {
      const db = getDb();
      // Throttle: skip if we already alerted for this function in-window.
      const since = new Date(Date.now() - ALERT_WINDOW_MS);
      const [recent] = await db
        .select({ id: notification.id })
        .from(notification)
        .where(
          and(
            eq(notification.workspaceId, workspaceId),
            eq(notification.source, 'system'),
            gte(notification.createdAt, since),
            sql`${notification.metadata} ->> 'failedFunctionId' = ${fnId}`,
          ),
        )
        .limit(1);
      if (recent) return false;

      const [owner] = await db
        .select({ userId: workspaceMember.userId })
        .from(workspaceMember)
        .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.role, 'owner')))
        .limit(1);
      if (!owner) return false;

      await notify({
        workspaceId,
        userId: owner.userId,
        title: 'A background job is failing',
        body: `${fnId} failed after all retries: ${message.slice(0, 200)}`,
        urgency: 'high',
        source: 'system',
        metadata: { failedFunctionId: fnId },
      });
      return true;
    });

    return { ok: true, notified };
  },
);

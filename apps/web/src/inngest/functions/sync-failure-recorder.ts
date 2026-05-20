/**
 * Generic capture: when any per-platform sync handler fails (after all
 * Inngest retries are exhausted), record the error onto the
 * `integration.lastError` column so the user can see something is wrong
 * on the /integrations page.
 *
 * Inngest emits `inngest/function.failed` system events automatically
 * on terminal failure. We filter to events whose payload's
 * `data.integrationId` is set — that's our convention for
 * per-integration sync events.
 */
import { inngest } from '../client';
import { markIntegrationSyncError } from '@metu/db/queries';

interface FailedEventData {
  function_id?: string;
  error?: { message?: string; name?: string };
  event?: { name?: string; data?: { integrationId?: string; workspaceId?: string } };
}

export const onSyncFailed = inngest.createFunction(
  {
    id: 'integration-sync-failed-recorder',
    name: 'Record sync failure on integration row',
  },
  { event: 'inngest/function.failed' },
  async ({ event }) => {
    const data = event.data as FailedEventData;
    const integrationId = data.event?.data?.integrationId;
    if (!integrationId) return { ok: false, reason: 'not-an-integration-sync' };
    const message =
      data.error?.message ?? data.error?.name ?? `failed: ${data.function_id ?? 'unknown'}`;
    await markIntegrationSyncError(integrationId, message);
    return { ok: true, integrationId };
  },
);

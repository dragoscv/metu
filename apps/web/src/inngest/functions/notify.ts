/**
 * Notification fabric Inngest functions.
 *
 * `conductor/notify` is the canonical event for "produce a user-visible
 * notification". It can be sent by the Conductor, server actions, integration
 * webhooks, and SDK app endpoints.
 */
import { inngest } from '../client';
import { notify } from '@/lib/notify';

export const onConductorNotify = inngest.createFunction(
  {
    id: 'conductor/notify',
    name: 'Conductor → notify',
    concurrency: { limit: 50, key: 'event.data.workspaceId' },
  },
  { event: 'conductor/notify' },
  async ({ event, step }) => {
    const result = await step.run('notify', () =>
      notify({
        workspaceId: event.data.workspaceId,
        userId: event.data.userId,
        title: event.data.title,
        body: event.data.body,
        urgency: event.data.urgency,
        source: event.data.source ?? 'conductor',
        actionUrl: event.data.actionUrl,
        actions: event.data.actions,
        metadata: event.data.metadata,
      }),
    );
    return result;
  },
);

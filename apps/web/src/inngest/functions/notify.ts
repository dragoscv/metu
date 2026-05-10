/**
 * Notification fabric Inngest functions.
 *
 * `conductor/notify` is the canonical event for "produce a user-visible
 * notification". It can be sent by the Conductor, server actions, integration
 * webhooks, and SDK app endpoints.
 */
import { inngest } from '../client';
import { notify } from '@/lib/notify';
import { parseEvent } from '../schemas';

export const onConductorNotify = inngest.createFunction(
  {
    id: 'conductor/notify',
    name: 'Conductor → notify',
    concurrency: { limit: 50, key: 'event.data.workspaceId' },
  },
  { event: 'conductor/notify' },
  async ({ event, step }) => {
    const data = parseEvent('conductor/notify', event.data);
    const result = await step.run('notify', () =>
      notify({
        workspaceId: data.workspaceId,
        userId: data.userId,
        title: data.title,
        body: data.body,
        urgency: data.urgency,
        source: data.source ?? 'conductor',
        actionUrl: data.actionUrl,
        actions: data.actions,
        metadata: data.metadata,
      }),
    );
    return result;
  },
);

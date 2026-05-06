import { focus, projectIntel } from '@metu/core';
import { inngest } from '../client';

export const onFocusRecompute = inngest.createFunction(
  {
    id: 'focus-recompute',
    name: 'Focus recompute',
    // debounce so a flurry of captures only triggers one heavy LLM call
    debounce: { period: '60s', key: 'event.data.userId' },
  },
  { event: 'focus/recompute' },
  async ({ event, step }) => {
    const { workspaceId, userId } = event.data;
    const result = await step.run('compute-focus', () =>
      focus.computeFocus({ workspaceId, userId }),
    );
    return { ok: true, provider: result.provider };
  },
);

export const onProjectMomentum = inngest.createFunction(
  { id: 'project-momentum', name: 'Project momentum recompute' },
  { event: 'project/momentum-recompute' },
  async ({ event }) => {
    const { workspaceId, projectId } = event.data;
    return projectIntel.recomputeMomentum(workspaceId, projectId);
  },
);

/** Nightly cron: pulse + momentum for every active project */
export const nightlyProjectPulse = inngest.createFunction(
  { id: 'nightly-pulse', name: 'Nightly project pulse' },
  { cron: '0 3 * * *' },
  async () => {
    // Iterate all workspaces would require an admin query — V1: skip, V2: workspace iterator.
    return { ran: true };
  },
);

import { focus, projectIntel } from '@metu/core';
import { getDb } from '@metu/db';
import { project } from '@metu/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { inngest } from '../client';
import { parseEvent } from '../schemas';

export const onFocusRecompute = inngest.createFunction(
  {
    id: 'focus-recompute',
    name: 'Focus recompute',
    // debounce so a flurry of captures only triggers one heavy LLM call
    debounce: { period: '60s', key: 'event.data.userId' },
  },
  { event: 'focus/recompute' },
  async ({ event, step }) => {
    const { workspaceId, userId } = parseEvent('focus/recompute', event.data);
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
    const { workspaceId, projectId } = parseEvent('project/momentum-recompute', event.data);
    return projectIntel.recomputeMomentum(workspaceId, projectId);
  },
);

/** Nightly cron: pulse + momentum for every active project. */
export const nightlyProjectPulse = inngest.createFunction(
  { id: 'nightly-pulse', name: 'Nightly project pulse', concurrency: { limit: 4 } },
  { cron: '0 3 * * *' },
  async ({ step, logger }) => {
    const projects = await step.run('list-active-projects', async () => {
      const db = getDb();
      return db
        .select({ id: project.id, workspaceId: project.workspaceId })
        .from(project)
        .where(and(eq(project.status, 'active'), isNull(project.deletedAt)));
    });

    let ok = 0;
    let failed = 0;
    for (const p of projects) {
      try {
        await step.run(`momentum-${p.id}`, () =>
          projectIntel.recomputeMomentum(p.workspaceId, p.id),
        );
        ok += 1;
      } catch (err) {
        failed += 1;
        logger.error('nightly-pulse momentum failed', {
          projectId: p.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { ran: true, projects: projects.length, ok, failed };
  },
);

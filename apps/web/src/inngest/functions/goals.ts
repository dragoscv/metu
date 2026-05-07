/**
 * Goals — drift detection cron + per-workspace handler.
 *
 * Two crons enumerate all workspaces with active goals and fan out a
 * `goals/review` event per workspace. The handler runs `reviewGoals()` and
 * fires `conductor/notify` for every drifting goal with action buttons.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { goal, workspace } from '@metu/db/schema';
import { goals } from '@metu/core';
import { inngest } from '../client';

async function workspacesWithActiveGoals(): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .selectDistinct({ id: workspace.id })
    .from(workspace)
    .innerJoin(goal, eq(goal.workspaceId, workspace.id))
    .where(and(eq(goal.status, 'active'), isNull(goal.deletedAt)));
  return rows.map((r) => r.id);
}

/** Daily 8am UTC — morning brief: top weighted goals + ask for daily check-in. */
export const goalsMorningCheckin = inngest.createFunction(
  { id: 'goals-morning-checkin', name: 'Goals — morning check-in' },
  { cron: '0 8 * * *' },
  async ({ step }) => {
    const workspaceIds = await step.run('list-workspaces', workspacesWithActiveGoals);
    for (const id of workspaceIds) {
      await step.sendEvent(`fan-${id}`, {
        name: 'goals/review',
        data: { workspaceId: id, reason: 'morning' as const },
      });
    }
    return { ran: workspaceIds.length };
  },
);

/** Sunday 18:00 UTC — weekly review. */
export const goalsWeeklyReview = inngest.createFunction(
  { id: 'goals-weekly-review', name: 'Goals — weekly review' },
  { cron: '0 18 * * 0' },
  async ({ step }) => {
    const workspaceIds = await step.run('list-workspaces', workspacesWithActiveGoals);
    for (const id of workspaceIds) {
      await step.sendEvent(`fan-${id}`, {
        name: 'goals/review',
        data: { workspaceId: id, reason: 'weekly' as const },
      });
    }
    return { ran: workspaceIds.length };
  },
);

/** Per-workspace review handler. Fans out notify events for drift. */
export const onGoalsReview = inngest.createFunction(
  {
    id: 'goals-review',
    name: 'Goals — review workspace',
    concurrency: { key: 'event.data.workspaceId', limit: 1 },
  },
  { event: 'goals/review' },
  async ({ event, step }) => {
    const { workspaceId, reason } = event.data;
    const results = await step.run('review', () => goals.reviewGoals(workspaceId));

    // Pick the goal owner — first active goal's userId — for notification routing.
    const db = getDb();
    const [owner] = await db
      .select({ userId: goal.userId })
      .from(goal)
      .where(and(eq(goal.workspaceId, workspaceId), eq(goal.status, 'active')))
      .limit(1);
    const userId = owner?.userId;
    if (!userId) return { reviewed: results.length, notified: 0 };

    let notified = 0;
    const drifting = results
      .filter((r) => r.drift !== 'on_track')
      .sort((a, b) => b.weight - a.weight);

    if (reason === 'morning') {
      // One consolidated brief at most; surface top 3 weighted goals.
      const top = results.sort((a, b) => b.weight - a.weight).slice(0, 3);
      if (top.length > 0) {
        await step.sendEvent('morning-brief', {
          name: 'conductor/notify',
          data: {
            workspaceId,
            userId,
            title: 'Morning brief — top goals',
            body: top
              .map((g) => `• ${g.title} — ${(g.progress * 100).toFixed(0)}% (${g.drift})`)
              .join('\n'),
            urgency: 'normal',
            source: 'goals',
            actionUrl: '/goals',
          },
        });
        notified += 1;
      }
    }

    for (const g of drifting) {
      await step.sendEvent(`drift-${g.goalId}`, {
        name: 'conductor/notify',
        data: {
          workspaceId,
          userId,
          title: g.drift === 'stalled' ? `Stalled: ${g.title}` : `Slipping: ${g.title}`,
          body:
            g.nudge ??
            `Currently ${(g.progress * 100).toFixed(0)}%. Conductor proposes a next-step task — approve to add it.`,
          urgency: g.drift === 'stalled' ? 'high' : 'normal',
          source: 'goals',
          actionUrl: `/goals?goal=${g.goalId}`,
          actions: [
            { id: 'checkin', label: 'Quick check-in', kind: 'open' as const },
            { id: 'propose-task', label: 'Propose next step', kind: 'approve' as const },
            { id: 'snooze', label: 'Snooze', kind: 'custom' as const },
          ],
          metadata: { goalId: g.goalId, drift: g.drift, weight: g.weight },
        },
      });
      notified += 1;
    }

    return { reviewed: results.length, notified };
  },
);

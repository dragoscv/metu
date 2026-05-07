/**
 * Conductor — the always-on supervisor.
 *
 * Three Inngest functions:
 *   - conductor/observe — fast write-only ingest of an interesting event;
 *                          schedules a tick.
 *   - conductor/tick    — debounced supervisor heartbeat. Plans (LLM, structured
 *                          output), pipes each suggested action through
 *                          `runTool()` so per-tool ACLs decide ask / auto / observe,
 *                          posts the pulse into the Conductor thread, then sleeps.
 *   - conductor/approved — record-only audit hook. Tool execution itself is done
 *                          synchronously by the server action (`approveToolCallAction`).
 */
import { and, eq } from 'drizzle-orm';
import { getDb } from '@metu/db';
import {
  agentPolicy,
  conversation,
  message,
  timelineEvent,
  workspaceMember,
} from '@metu/db/schema';
import { agent } from '@metu/core';
import { inngest } from '../client';

async function ensureConductorThread(workspaceId: string) {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(conversation)
    .where(and(eq(conversation.workspaceId, workspaceId), eq(conversation.kind, 'conductor')))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(conversation)
    .values({
      workspaceId,
      kind: 'conductor',
      status: 'pinned',
      title: 'Conductor',
      summary: 'Your always-on supervisor.',
    })
    .returning();
  return created!;
}

async function ensurePolicy(workspaceId: string) {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(agentPolicy)
    .where(eq(agentPolicy.workspaceId, workspaceId))
    .limit(1);
  if (existing) return existing;
  const [created] = await db.insert(agentPolicy).values({ workspaceId }).returning();
  return created!;
}

async function workspaceOwner(workspaceId: string): Promise<string> {
  const db = getDb();
  const [row] = await db
    .select({ userId: workspaceMember.userId })
    .from(workspaceMember)
    .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.role, 'owner')))
    .limit(1);
  return row?.userId ?? '';
}

export const onConductorObserve = inngest.createFunction(
  {
    id: 'conductor-observe',
    name: 'Conductor: observe event',
    concurrency: { key: 'event.data.workspaceId', limit: 4 },
  },
  { event: 'conductor/observe' },
  async ({ event, step }) => {
    const { workspaceId, eventKind, payload } = event.data;
    await step.run('record', async () => {
      const db = getDb();
      await db.insert(timelineEvent).values({
        workspaceId,
        kind: `conductor.observed.${eventKind}`,
        title: `Conductor saw ${eventKind}`,
        payload: payload as Record<string, unknown>,
        importance: 0.2,
      });
    });
    await step.sendEvent('schedule-tick', {
      name: 'conductor/tick',
      data: { workspaceId, reason: eventKind },
    });
    return { ok: true };
  },
);

export const onConductorTick = inngest.createFunction(
  {
    id: 'conductor-tick',
    name: 'Conductor: tick',
    concurrency: { key: 'event.data.workspaceId', limit: 1 },
    debounce: { period: '15s', key: 'event.data.workspaceId' },
  },
  { event: 'conductor/tick' },
  async ({ event, step }) => {
    const { workspaceId } = event.data;
    const policy = await step.run('policy', () => ensurePolicy(workspaceId));

    // Master kill-switch: stay alive (so flipping back on resumes) but skip
    // any planning/tool execution this tick. Re-emit a long sleep + retry.
    if (policy.enabled === false) {
      await step.sleep('paused', '15m');
      await step.sendEvent('next', {
        name: 'conductor/tick',
        data: { workspaceId, reason: 'paused-recheck' },
      });
      return { ok: true, paused: true };
    }

    const thread = await step.run('thread', () => ensureConductorThread(workspaceId));
    const ownerUserId = await step.run('owner', () => workspaceOwner(workspaceId));

    // ─── Plan (structured output) ─────────────────────────────────────────
    let plan: {
      pulse: string;
      actions: { tool: string; args: Record<string, unknown>; why: string }[];
      notes?: string;
    } | null = null;
    let provider = '';
    let modelId = '';
    try {
      const r = await step.run('plan', () =>
        agent.planConductor({ workspaceId, reason: event.data.reason }),
      );
      plan = r.plan;
      provider = r.provider;
      modelId = r.modelId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await step.run('plan-failed', async () => {
        const db = getDb();
        await db.insert(message).values({
          workspaceId,
          conversationId: thread.id,
          role: 'system',
          content: `Conductor tick: planner unavailable (${msg}). Will retry next tick.`,
          metadata: { synthetic: true, error: msg },
        });
      });
    }

    if (plan) {
      await step.run('post-pulse', async () => {
        const db = getDb();
        await db.insert(message).values({
          workspaceId,
          conversationId: thread.id,
          role: 'assistant',
          content: plan!.pulse,
          provider,
          model: modelId,
          metadata: {
            actions: plan!.actions,
            notes: plan!.notes,
            synthetic: true,
          },
        });
        await db
          .update(conversation)
          .set({ lastMessageAt: new Date() })
          .where(eq(conversation.id, thread.id));
      });

      for (let i = 0; i < plan.actions.length; i++) {
        const action = plan.actions[i]!;
        await step.run(`run-${i}-${action.tool}`, async () => {
          const result = await agent.runTool({
            workspaceId,
            userId: ownerUserId,
            conversationId: thread.id,
            tool: action.tool,
            args: action.args,
          });
          // If the tool is gated, ping the user across every device so they
          // can approve/reject from the slider notification.
          if (result.status === 'awaiting_approval') {
            await inngest.send({
              name: 'conductor/notify',
              data: {
                workspaceId,
                userId: ownerUserId,
                title: `Approve: ${action.tool}`,
                body: action.why ?? 'Conductor proposed an action.',
                urgency: 'high',
                source: 'conductor',
                actionUrl: `/chat?toolCall=${result.toolCallId}`,
                actions: [
                  { id: 'approve', label: 'Approve', kind: 'approve' },
                  { id: 'reject', label: 'Reject', kind: 'reject' },
                ],
                metadata: { toolCallId: result.toolCallId, tool: action.tool },
              },
            });
          } else if (result.status === 'failed') {
            // Don't swallow tool failures — the user should hear about them so
            // they can fix integrations / args / etc.
            await inngest.send({
              name: 'conductor/notify',
              data: {
                workspaceId,
                userId: ownerUserId,
                title: `Tool failed: ${action.tool}`,
                body: (result.error ?? 'unknown error').slice(0, 240),
                urgency: 'normal',
                source: 'conductor',
                actionUrl: `/chat?toolCall=${result.toolCallId}`,
                metadata: { toolCallId: result.toolCallId, tool: action.tool },
              },
            });
          }
        });
      }
    }

    const sleepSec = policy.tickIntervalSec ?? 300;
    await step.sleep('idle', `${sleepSec}s`);
    await step.sendEvent('next', {
      name: 'conductor/tick',
      data: { workspaceId, reason: 'scheduled' },
    });

    return { ok: true, sleepSec, actions: plan?.actions.length ?? 0 };
  },
);

export const onConductorApproved = inngest.createFunction(
  { id: 'conductor-approved', name: 'Conductor: tool approved' },
  { event: 'conductor/approved' },
  async ({ event, step }) => {
    const { workspaceId, toolCallId } = event.data;
    await step.run('audit', async () => {
      const db = getDb();
      await db.insert(timelineEvent).values({
        workspaceId,
        kind: 'conductor.tool.approved',
        title: `Approved tool_call ${toolCallId}`,
        importance: 0.4,
        payload: { toolCallId },
      });
    });
    return { ok: true };
  },
);

/**
 * Backstop cron — fires every 15 minutes and emits a `conductor/tick` for
 * every workspace whose autonomy is enabled. The tick handler debounces on
 * workspaceId, so this is a no-op when the self-rescheduling chain is healthy
 * but rescues us if the chain ever breaks (deploy, restart, sleep > 15min).
 */
export const conductorBackstop = inngest.createFunction(
  { id: 'conductor-backstop', name: 'Conductor: backstop scheduler' },
  { cron: '*/15 * * * *' },
  async ({ step }) => {
    const rows = await step.run('list-enabled', async () => {
      const db = getDb();
      const r = await db
        .select({ workspaceId: agentPolicy.workspaceId })
        .from(agentPolicy)
        .where(eq(agentPolicy.enabled, true));
      return r;
    });
    for (const r of rows) {
      await step.sendEvent(`tick-${r.workspaceId}`, {
        name: 'conductor/tick',
        data: { workspaceId: r.workspaceId, reason: 'backstop' },
      });
    }
    return { ok: true, scheduled: rows.length };
  },
);

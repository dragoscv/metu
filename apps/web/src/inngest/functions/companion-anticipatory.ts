/**
 * Companion-Agent anticipatory cron.
 *
 * Slice 9 — gives the persona's `mode` enum real teeth.
 *
 *   silent          — never proactively pings.
 *   ambient_nudges  — only reacts to explicit observe events (default).
 *   anticipatory    — fires a `conductor/tick` every TICK_MIN minutes IF the
 *                     workspace had timeline activity in the last LOOKBACK_MIN.
 *   autonomous      — same as anticipatory but skips the activity gate
 *                     (always ticks; trusted users only).
 *
 * The cron fans out one tick event per qualifying workspace; the existing
 * `conductor/tick` debounce (15 s, keyed on workspaceId) prevents storms when
 * multiple personas in the same workspace want a tick.
 *
 * We deliberately don't run inside the existing `conductorBackstop` because
 * (a) backstop ticks every workspace with `agent_policy.enabled=true`
 *     unconditionally — that's the safety net, not anticipatory behaviour;
 * (b) anticipatory personas should ride at a faster cadence than backstop
 *     (5 min vs 15 min) so the user feels them.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { agentPolicy, persona, timelineEvent } from '@metu/db/schema';
import { inngest } from '../client';

const TICK_REASON = 'companion-agent anticipatory';
type AnticipatoryMode = 'anticipatory' | 'autonomous';
const ANTICIPATORY_MODES: AnticipatoryMode[] = ['anticipatory', 'autonomous'];
const LOOKBACK_MINUTES = 30;

export const companionAgentAnticipatory = inngest.createFunction(
  { id: 'companion-agent-anticipatory', name: 'Companion-Agent: anticipatory pulse' },
  { cron: '*/5 * * * *' },
  async ({ step }) => {
    const candidates = await step.run('list-candidates', async () => {
      const db = getDb();
      // Workspaces with at least one persona in anticipatory/autonomous mode
      // AND an enabled agent policy. Aggregate the strongest mode per ws so
      // we can apply the per-mode activity gate below.
      const rows = await db
        .select({
          workspaceId: persona.workspaceId,
          maxMode: sql<string>`max(${persona.mode}::text)`.as('max_mode'),
        })
        .from(persona)
        .innerJoin(agentPolicy, eq(agentPolicy.workspaceId, persona.workspaceId))
        .where(and(inArray(persona.mode, ANTICIPATORY_MODES), eq(agentPolicy.enabled, true)))
        .groupBy(persona.workspaceId);
      return rows;
    });

    if (candidates.length === 0) {
      return { ok: true, scheduled: 0 };
    }

    // Activity gate: anticipatory mode only fires if the workspace had any
    // timeline event in the last LOOKBACK_MINUTES. autonomous skips the gate.
    const since = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000);
    const activeIds = await step.run('activity-gate', async () => {
      const db = getDb();
      const workspaceIds = candidates.map((c) => c.workspaceId);
      const recent = await db
        .selectDistinct({ workspaceId: timelineEvent.workspaceId })
        .from(timelineEvent)
        .where(
          and(
            inArray(timelineEvent.workspaceId, workspaceIds),
            sql`${timelineEvent.occurredAt} >= ${since}`,
          ),
        );
      return recent.map((r) => r.workspaceId);
    });
    const active = new Set<string>(activeIds);

    let scheduled = 0;
    for (const c of candidates) {
      const isAutonomous = c.maxMode === 'autonomous';
      if (!isAutonomous && !active.has(c.workspaceId)) continue;
      await step.sendEvent(`tick-${c.workspaceId}`, {
        name: 'conductor/tick',
        data: {
          workspaceId: c.workspaceId,
          reason: `${TICK_REASON}: mode=${c.maxMode}`,
        },
      });
      scheduled++;
    }
    return { ok: true, scheduled, candidates: candidates.length };
  },
);

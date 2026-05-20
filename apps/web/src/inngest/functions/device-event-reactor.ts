/**
 * Conductor reactor on the `device/event` event stream. Every heartbeat
 * from VS Code, browser, companion, mobile, etc. flows here. Behavior is
 * gated by the workspace's `conductorActivityLevel` preference:
 *
 *   - off:        no-op.
 *   - passive:    pass-through to `conductor/observe` (Conductor sees it
 *                 in its working memory but never proactively pings).
 *   - gentle:     observe + after 30 min of editor idleness on the same
 *                 file/project, fire a single 'continue where you left off'
 *                 nudge via conductor/notify (rate-limited to one per workspace per 2h).
 *   - aggressive: observe + on every context-switch (different file/project
 *                 than the last heartbeat, > 5 min apart) suggest filing
 *                 the previous chunk and surface the most relevant project.
 *
 * The 'gentle' and 'aggressive' policies are intentionally cheap: we only
 * READ the existing focus_session row + the most recent device_event for
 * the same workspace; no additional LLM calls in the reactor itself. The
 * Conductor (downstream `conductor/tick`) does the heavy lifting.
 */
import { inngest } from '../client';
import { getDb } from '@metu/db';
import { deviceEvent, timelineEvent, workspaceMember } from '@metu/db/schema';
import { and, desc, eq, lt } from 'drizzle-orm';
import { getConductorActivityLevel } from '@/app/actions/workspace-preferences';
import { findRelevantProjects } from './conductor-proactive';

const IDLE_THRESHOLD_MS = 30 * 60_000; // 30 min
const SWITCH_THRESHOLD_MS = 5 * 60_000; // 5 min

interface HeartbeatPayload {
  editor?: { baseName?: string; languageId?: string };
  workspace?: { name?: string };
  url?: string;
  host?: string;
}

export const onDeviceEventReact = inngest.createFunction(
  {
    id: 'conductor-device-event-reactor',
    name: 'Conductor: react to device/event by activity level',
    concurrency: { key: 'event.data.workspaceId', limit: 4 },
  },
  { event: 'device/event' },
  async ({ event, step }) => {
    const { workspaceId, deviceId, kind, payload } = event.data;

    // Project auto-attach: vscode.git.state with branchChanged becomes a
    // first-class timeline event, with projectId resolved by name match.
    // Runs at every activity level (including 'off') because it's data
    // capture, not a nudge.
    if (kind === 'vscode.git.state') {
      const p = (payload as { branchChanged?: boolean; repo?: string; branch?: string }) ?? {};
      if (p.branchChanged) {
        const relevant = await step.run('git-attach-project', () =>
          findRelevantProjects(workspaceId, p.repo ?? null),
        );
        const projectId = relevant[0]?.id ?? null;
        await step.run('git-timeline', async () => {
          await getDb()
            .insert(timelineEvent)
            .values({
              workspaceId,
              projectId,
              kind: 'vscode.branch.changed',
              title: `Branch → ${p.branch ?? '(unknown)'}${p.repo ? ` in ${p.repo}` : ''}`,
              payload: { source: 'vscode-ext', deviceId, ...p },
              importance: 0.4,
            });
        });
      }
    }

    const level = await step.run('level', () => getConductorActivityLevel(workspaceId));
    if (level === 'off') return { ok: true, level, reacted: false };

    // Always feed Conductor's working memory.
    await step.sendEvent('observe', {
      name: 'conductor/observe',
      data: {
        workspaceId,
        eventKind: `device.${kind}`,
        payload: { deviceId, ...((payload as Record<string, unknown>) ?? {}) },
      },
    });

    if (level === 'passive') return { ok: true, level, reacted: false };

    // Gentle + aggressive both want to compare against the previous heartbeat.
    const previous = await step.run('prev-heartbeat', async () => {
      const db = getDb();
      const rows = await db
        .select({
          kind: deviceEvent.kind,
          payload: deviceEvent.payload,
          occurredAt: deviceEvent.occurredAt,
        })
        .from(deviceEvent)
        .where(
          and(eq(deviceEvent.workspaceId, workspaceId), lt(deviceEvent.occurredAt, new Date())),
        )
        .orderBy(desc(deviceEvent.occurredAt))
        .limit(2);
      // Rows[0] is the current event; rows[1] is the previous one.
      return rows[1] ?? null;
    });

    const now = Date.now();
    const prevTs = previous?.occurredAt ? new Date(previous.occurredAt).getTime() : 0;
    const gapMs = prevTs ? now - prevTs : Infinity;
    const cur = (payload as HeartbeatPayload | undefined) ?? {};
    const prev = (previous?.payload as HeartbeatPayload | null) ?? {};

    const sameFile =
      cur.editor?.baseName && prev.editor?.baseName
        ? cur.editor.baseName === prev.editor.baseName
        : false;
    const sameProject =
      cur.workspace?.name && prev.workspace?.name
        ? cur.workspace.name === prev.workspace.name
        : false;

    if (level === 'gentle') {
      // Only nudge when the gap exceeds the idle threshold AND the user
      // has just returned to the SAME project (avoids nagging on context switch).
      if (gapMs >= IDLE_THRESHOLD_MS && sameProject) {
        await step.sendEvent('nudge', {
          name: 'conductor/notify',
          data: {
            workspaceId,
            userId: '',
            title: 'Welcome back',
            body: cur.workspace?.name
              ? `Continue where you left off in ${cur.workspace.name}?`
              : 'Continue where you left off?',
            urgency: 'low',
            source: 'conductor.activity-reactor',
            metadata: { reason: 'idle-return', gapMs, level },
          },
        });
        return { ok: true, level, reacted: true, reason: 'idle-return' };
      }
      return { ok: true, level, reacted: false };
    }

    // aggressive
    if (gapMs >= SWITCH_THRESHOLD_MS && (!sameFile || !sameProject)) {
      const hint = cur.workspace?.name ?? cur.editor?.baseName ?? cur.host ?? null;
      const relevant = await step.run('relevant-projects', () =>
        findRelevantProjects(workspaceId, hint),
      );
      await step.sendEvent('switch-tick', {
        name: 'conductor/tick',
        data: {
          workspaceId,
          reason: `context-switch:${cur.workspace?.name ?? 'unknown'}`,
        },
      });
      await step.sendEvent('switch-observe', {
        name: 'conductor/observe',
        data: {
          workspaceId,
          eventKind: 'context.switch',
          payload: {
            from: prev.workspace?.name ?? prev.editor?.baseName ?? null,
            to: cur.workspace?.name ?? cur.editor?.baseName ?? null,
            relevantProjects: relevant.map((p) => ({ id: p.id, name: p.name })),
          },
        },
      });

      // Surface a one-click 'Create task in {project}' proposal so aggressive
      // mode actually proposes a tool call (not just observes). The notify
      // carries metadata.toolProposal which the in-app notification UI can
      // render as an Approve/Reject pair calling runTool() server-side.
      if (relevant[0]) {
        const target = relevant[0];
        const fromLabel = prev.workspace?.name ?? prev.editor?.baseName ?? 'previous chunk';
        const ownerId = await step.run('switch-owner', async () => {
          const db = getDb();
          const [row] = await db
            .select({ userId: workspaceMember.userId })
            .from(workspaceMember)
            .where(
              and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.role, 'owner')),
            )
            .limit(1);
          return row?.userId ?? '';
        });
        if (ownerId) {
          const proposalId = `task-create-${Date.now()}`;
          await step.sendEvent('switch-propose', {
            name: 'conductor/notify',
            data: {
              workspaceId,
              userId: ownerId,
              title: `File the previous chunk under ${target.name}?`,
              body: `You switched away from "${fromLabel}". Create a follow-up task so it doesn't get lost.`,
              urgency: 'low',
              source: 'conductor.activity-reactor',
              actions: [
                { id: 'approve', label: `Create task in ${target.name}`, kind: 'approve' },
                { id: 'reject', label: 'Dismiss', kind: 'reject' },
              ],
              metadata: {
                reason: 'context-switch-proposal',
                proposalId,
                toolProposal: {
                  tool: 'create_task',
                  args: {
                    projectId: target.id,
                    title: `Follow up on ${fromLabel}`,
                  },
                },
              },
            },
          });
        }
      }

      return {
        ok: true,
        level,
        reacted: true,
        reason: 'context-switch',
        relevantProjects: relevant.length,
      };
    }
    return { ok: true, level, reacted: false };
  },
);

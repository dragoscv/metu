/**
 * Anomaly detector — find integrations whose `lastSyncAt` is overdue
 * relative to its expected cadence and notify the workspace owner.
 *
 * Cadence per kind matches the cron schedules in the per-platform sync
 * functions; each entry is the **maximum tolerated gap** in milliseconds
 * (cron interval × 1.5 + a small grace). Anything older fires one
 * `conductor/notify` per overdue integration per run, plus marks
 * `lastError` on the row so the integrations grid lights up.
 *
 * Runs every 30 minutes — frequent enough to surface a stuck sync within
 * one cycle, infrequent enough to avoid notification spam.
 */
import { and, eq, lt, isNotNull } from 'drizzle-orm';
import { inngest } from '../client';
import { getDb } from '@metu/db';
import { integration, workspace, workspaceMember, user } from '@metu/db/schema';
import { markIntegrationSyncError } from '@metu/db/queries';
import { log } from '@/lib/logger';

const HOUR = 60 * 60_000;
const MIN = 60_000;

/** Maximum tolerated gap (ms) between successful syncs, per integration kind. */
const MAX_GAP_MS: Partial<Record<string, number>> = {
  // Realtime/15-min cadences.
  stripe: 30 * MIN,
  vercel: 30 * MIN,
  // Hourly+ cadences.
  slack: 90 * MIN,
  linear: 90 * MIN,
  reddit: 2 * HOUR,
  twitter: 2 * HOUR,
  youtube: 3 * HOUR,
  spotify: 3 * HOUR,
  instagram: 3 * HOUR,
  notion: 9 * HOUR,
  gcal: 90 * MIN,
};

export const integrationStaleDetector = inngest.createFunction(
  {
    id: 'integration-stale-detector',
    name: 'Integrations: detect stale syncs',
    concurrency: { limit: 1 },
  },
  { cron: '*/30 * * * *' },
  async ({ step, logger }) => {
    const db = getDb();
    const cutoff = new Date(Date.now() - 30 * MIN); // never alert about syncs <30min old

    const candidates = await step.run('candidates', async () => {
      return db
        .select({
          id: integration.id,
          workspaceId: integration.workspaceId,
          kind: integration.kind,
          label: integration.label,
          lastSyncAt: integration.lastSyncAt,
          lastError: integration.lastError,
          status: integration.status,
        })
        .from(integration)
        .where(
          and(
            eq(integration.status, 'active'),
            isNotNull(integration.lastSyncAt),
            lt(integration.lastSyncAt, cutoff),
          ),
        );
    });

    let alerted = 0;
    const now = Date.now();
    for (const row of candidates) {
      const max = MAX_GAP_MS[row.kind];
      if (!max) continue;
      const last = row.lastSyncAt ? new Date(row.lastSyncAt).getTime() : 0;
      const gap = now - last;
      if (gap < max) continue;
      // Don't re-alert if we already marked it stale on a prior run.
      if (row.lastError?.startsWith('stale_sync:')) continue;

      await step.run(`mark-${row.id}`, () =>
        markIntegrationSyncError(
          row.id,
          `stale_sync:no successful sync in ${Math.round(gap / 60_000)} min (limit ${Math.round(max / 60_000)} min)`,
        ),
      );

      // Find the workspace owner so the notification has a userId.
      const owner = await step.run(`owner-${row.id}`, async () => {
        const rows = await db
          .select({ userId: workspaceMember.userId, email: user.email, name: workspace.name })
          .from(workspaceMember)
          .innerJoin(user, eq(user.id, workspaceMember.userId))
          .innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
          .where(
            and(
              eq(workspaceMember.workspaceId, row.workspaceId),
              eq(workspaceMember.role, 'owner'),
            ),
          )
          .limit(1);
        return rows[0] ?? null;
      });
      if (!owner) continue;

      await step.sendEvent(`notify-${row.id}`, {
        name: 'conductor/notify',
        data: {
          workspaceId: row.workspaceId,
          userId: owner.userId,
          title: `${row.kind} sync looks stuck`,
          body: `"${row.label}" hasn't synced in ${Math.round(gap / 60_000)} min. Try Sync now in Integrations.`,
          urgency: 'low',
          source: 'integration.stale-detector',
          actionUrl: '/integrations',
          metadata: { integrationId: row.id, kind: row.kind, gapMs: gap },
        },
      });
      alerted++;
    }

    if (alerted > 0) {
      log.info('integration.stale.alerted', { alerted, candidates: candidates.length });
    }
    return { ok: true, candidates: candidates.length, alerted };
  },
);

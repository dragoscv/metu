/**
 * Vercel sync: every 10 min, list the user's recent deployments. Each
 * deployment → timeline_event(kind='vercel.deployment'), importance
 * scaled by READY/ERROR state. Idempotent on (workspaceId, externalId).
 *
 * Token is a Vercel personal access token (BYOK). Optional team scope:
 * if `integration.config.teamId` is set, list deployments for that team.
 */
import { inngest } from '../client';
import { parseEvent } from '../schemas';
import { getDb } from '@metu/db';
import { listActiveIntegrationsByKind, markIntegrationSyncSuccess } from '@metu/db/queries';
import { timelineEvent } from '@metu/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { getIntegrationToken } from './_integration-token';

const UA = 'metu/0.1.0';

interface VercelDeployment {
  uid?: string;
  name?: string;
  url?: string;
  state?: 'INITIALIZING' | 'BUILDING' | 'READY' | 'ERROR' | 'CANCELED' | 'QUEUED';
  source?: string;
  target?: string | null;
  created?: number;
  inspectorUrl?: string;
  meta?: { githubCommitMessage?: string; githubCommitRef?: string };
}

function importanceFor(state: string | undefined, target: string | null | undefined): number {
  const isProd = target === 'production';
  if (state === 'ERROR') return isProd ? 0.9 : 0.7;
  if (state === 'READY') return isProd ? 0.65 : 0.45;
  return 0.4;
}

export const vercelSyncCron = inngest.createFunction(
  { id: 'vercel-sync-cron', name: 'Vercel: fan-out (every 10min)', concurrency: { limit: 1 } },
  { cron: '*/10 * * * *' },
  async ({ step }) => {
    const rows = await step.run('list', () => listActiveIntegrationsByKind('vercel'));
    for (const r of rows) {
      await step.sendEvent(`vercel-${r.integrationId}`, {
        name: 'vercel/sync.requested',
        data: { workspaceId: r.workspaceId, integrationId: r.integrationId, reason: 'cron' },
      });
    }
    return { queued: rows.length };
  },
);

export const onVercelSync = inngest.createFunction(
  {
    id: 'vercel-sync',
    name: 'Vercel: sync recent deployments',
    concurrency: { key: 'event.data.workspaceId', limit: 2 },
    retries: 2,
  },
  { event: 'vercel/sync.requested' },
  async ({ event, step }) => {
    const { workspaceId, integrationId } = parseEvent('vercel/sync.requested', event.data);
    const creds = await step.run('token', () =>
      getIntegrationToken(workspaceId, 'vercel', integrationId),
    );
    if (!creds) return { ok: false, reason: 'no-token' };
    const teamId = (creds.config?.teamId as string | undefined) ?? null;

    const deployments = await step.run('fetch', async () => {
      const params = new URLSearchParams({ limit: '50' });
      if (teamId) params.set('teamId', teamId);
      const res = await fetch(`https://api.vercel.com/v6/deployments?${params.toString()}`, {
        headers: { Authorization: `Bearer ${creds.token}`, 'User-Agent': UA },
      });
      if (!res.ok) throw new Error(`Vercel ${res.status}`);
      const data = (await res.json()) as { deployments?: VercelDeployment[] };
      return data.deployments ?? [];
    });

    let upserted = 0;
    for (const d of deployments) {
      if (!d.uid) continue;
      const externalId = d.uid;
      const occurredAt = new Date(d.created ?? Date.now());
      const stateLabel = d.state ?? 'UNKNOWN';
      const targetLabel = d.target ?? 'preview';
      const title = `Vercel ${d.name ?? 'project'} (${targetLabel}): ${stateLabel}`.slice(0, 200);
      await step.run(`dep-${externalId}`, async () => {
        const db = getDb();
        await db
          .delete(timelineEvent)
          .where(
            and(
              eq(timelineEvent.workspaceId, workspaceId),
              eq(timelineEvent.kind, 'vercel.deployment'),
              sql`${timelineEvent.payload}->>'externalId' = ${externalId}`,
            ),
          );
        await db.insert(timelineEvent).values({
          workspaceId,
          kind: 'vercel.deployment',
          title,
          body: d.meta?.githubCommitMessage?.slice(0, 500) ?? null,
          payload: {
            externalId,
            integrationId,
            uid: d.uid,
            url: d.url ? `https://${d.url}` : null,
            inspectorUrl: d.inspectorUrl,
            state: d.state,
            target: d.target,
            project: d.name,
            ref: d.meta?.githubCommitRef,
          },
          importance: importanceFor(d.state, d.target),
          occurredAt,
        });
      });
      upserted++;
    }

    await step.run('mark-success', () => markIntegrationSyncSuccess(integrationId));
    return { ok: true, upserted };
  },
);

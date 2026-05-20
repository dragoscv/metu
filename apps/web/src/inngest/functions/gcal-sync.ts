/**
 * Google Calendar sync: every 1h, for each connected workspace, pull events
 * from primary calendar in the [-7d, +14d] window and persist each as a
 * `timeline_event` (kind='gcal.event') so the focus + Conductor systems
 * can reason about upcoming commitments.
 */
import { inngest } from '../client';
import { parseEvent } from '../schemas';
import { getDb } from '@metu/db';
import { listActiveIntegrationsByKind, markIntegrationSyncSuccess } from '@metu/db/queries';
import { timelineEvent } from '@metu/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { getIntegrationToken } from './_integration-token';

const UA = 'metu/0.1.0';

interface GCalEvent {
  id: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  htmlLink?: string;
  attendees?: Array<{ email?: string; responseStatus?: string }>;
  location?: string;
  status?: string;
}

export const gcalSyncCron = inngest.createFunction(
  { id: 'gcal-sync-cron', name: 'GCal: fan-out (every 1h)', concurrency: { limit: 1 } },
  { cron: '23 * * * *' },
  async ({ step }) => {
    const rows = await step.run('list', () => listActiveIntegrationsByKind('gcal'));
    for (const r of rows) {
      await step.sendEvent(`gcal-${r.integrationId}`, {
        name: 'gcal/sync.requested',
        data: { workspaceId: r.workspaceId, integrationId: r.integrationId, reason: 'cron' },
      });
    }
    return { queued: rows.length };
  },
);

export const onGcalSync = inngest.createFunction(
  {
    id: 'gcal-sync',
    name: 'GCal: sync events for one workspace',
    concurrency: { key: 'event.data.workspaceId', limit: 2 },
    retries: 2,
  },
  { event: 'gcal/sync.requested' },
  async ({ event, step }) => {
    const { workspaceId, integrationId } = parseEvent('gcal/sync.requested', event.data);

    const creds = await step.run('token', () =>
      getIntegrationToken(workspaceId, 'gcal', integrationId),
    );
    if (!creds) return { ok: false, reason: 'no-token' };

    const events = await step.run('fetch', async () => {
      const timeMin = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const timeMax = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
      const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
      url.searchParams.set('timeMin', timeMin);
      url.searchParams.set('timeMax', timeMax);
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('orderBy', 'startTime');
      url.searchParams.set('maxResults', '250');
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${creds.token}`, 'User-Agent': UA },
      });
      if (!res.ok) throw new Error(`GCal ${res.status}`);
      const data = (await res.json()) as { items?: GCalEvent[] };
      return data.items ?? [];
    });

    let upserted = 0;
    for (const e of events) {
      if (e.status === 'cancelled') continue;
      const startsAt = e.start?.dateTime ?? e.start?.date;
      if (!startsAt) continue;
      const occurredAt = new Date(startsAt);
      const externalId = e.id;
      await step.run(`evt-${externalId}`, async () => {
        const db = getDb();
        // Idempotent on (workspaceId, payload->>externalId).
        await db
          .delete(timelineEvent)
          .where(
            and(
              eq(timelineEvent.workspaceId, workspaceId),
              eq(timelineEvent.kind, 'gcal.event'),
              sql`${timelineEvent.payload}->>'externalId' = ${externalId}`,
            ),
          );
        await db.insert(timelineEvent).values({
          workspaceId,
          kind: 'gcal.event',
          title: e.summary ?? '(no title)',
          body: e.description ?? null,
          payload: {
            externalId,
            integrationId,
            start: startsAt,
            end: e.end?.dateTime ?? e.end?.date,
            htmlLink: e.htmlLink,
            location: e.location,
            attendees: (e.attendees ?? []).map((a) => ({
              email: a.email,
              response: a.responseStatus,
            })),
          },
          importance: 0.6,
          occurredAt,
        });
      });
      upserted++;
    }
    await step.run('mark-success', () => markIntegrationSyncSuccess(integrationId));
    return { ok: true, upserted };
  },
);

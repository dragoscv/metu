/**
 * Spotify sync: every 1h, pull recently-played tracks (max 50). Each play
 * → timeline_event(kind='spotify.played'), idempotent on
 * (workspaceId, payload->>externalId) where externalId = `${trackId}:${playedAt}`.
 * Listening history is ambient signal — not a "post".
 */
import { inngest } from '../client';
import { parseEvent } from '../schemas';
import { getDb } from '@metu/db';
import { listActiveIntegrationsByKind, markIntegrationSyncSuccess } from '@metu/db/queries';
import { timelineEvent } from '@metu/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { getIntegrationToken } from './_integration-token';

const UA = 'metu/0.1.0';

interface PlayedItem {
  played_at?: string;
  track?: {
    id?: string;
    name?: string;
    duration_ms?: number;
    external_urls?: { spotify?: string };
    artists?: Array<{ name?: string }>;
    album?: { name?: string };
  };
}

export const spotifySyncCron = inngest.createFunction(
  { id: 'spotify-sync-cron', name: 'Spotify: fan-out (every 1h)', concurrency: { limit: 1 } },
  { cron: '29 * * * *' },
  async ({ step }) => {
    const rows = await step.run('list', () => listActiveIntegrationsByKind('spotify'));
    for (const r of rows) {
      await step.sendEvent(`spotify-${r.integrationId}`, {
        name: 'spotify/sync.requested',
        data: { workspaceId: r.workspaceId, integrationId: r.integrationId, reason: 'cron' },
      });
    }
    return { queued: rows.length };
  },
);

export const onSpotifySync = inngest.createFunction(
  {
    id: 'spotify-sync',
    name: 'Spotify: sync recently played',
    concurrency: { key: 'event.data.workspaceId', limit: 2 },
    retries: 2,
  },
  { event: 'spotify/sync.requested' },
  async ({ event, step }) => {
    const { workspaceId, integrationId } = parseEvent('spotify/sync.requested', event.data);
    const creds = await step.run('token', () =>
      getIntegrationToken(workspaceId, 'spotify', integrationId),
    );
    if (!creds) return { ok: false, reason: 'no-token' };

    const items = await step.run('fetch', async () => {
      const res = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=50', {
        headers: { Authorization: `Bearer ${creds.token}`, 'User-Agent': UA },
      });
      if (!res.ok) throw new Error(`Spotify ${res.status}`);
      const data = (await res.json()) as { items?: PlayedItem[] };
      return data.items ?? [];
    });

    let upserted = 0;
    for (const it of items) {
      if (!it.track?.id || !it.played_at) continue;
      const externalId = `${it.track.id}:${it.played_at}`;
      const occurredAt = new Date(it.played_at);
      const artists = (it.track.artists ?? [])
        .map((a) => a.name)
        .filter(Boolean)
        .join(', ');
      await step.run(`play-${externalId}`, async () => {
        const db = getDb();
        await db
          .delete(timelineEvent)
          .where(
            and(
              eq(timelineEvent.workspaceId, workspaceId),
              eq(timelineEvent.kind, 'spotify.played'),
              sql`${timelineEvent.payload}->>'externalId' = ${externalId}`,
            ),
          );
        await db.insert(timelineEvent).values({
          workspaceId,
          kind: 'spotify.played',
          title: artists ? `${it.track!.name} — ${artists}` : (it.track!.name ?? 'Unknown'),
          body: it.track?.album?.name ?? null,
          payload: {
            externalId,
            integrationId,
            trackId: it.track!.id,
            url: it.track?.external_urls?.spotify,
            durationMs: it.track?.duration_ms,
            artists,
            album: it.track?.album?.name,
          },
          importance: 0.2,
          occurredAt,
        });
      });
      upserted++;
    }
    await step.run('mark-success', () => markIntegrationSyncSuccess(integrationId));
    return { ok: true, upserted };
  },
);

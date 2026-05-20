/**
 * Instagram sync (Basic Display API): every 6h, list user media (recent
 * posts/reels/carousels) → social_post(platform='instagram'). The Basic
 * Display API does not expose engagement metrics — only counts come from
 * the Graph API (requires Meta app review). Metrics start empty and can
 * be backfilled when a Graph token is added.
 */
import { inngest } from '../client';
import { parseEvent } from '../schemas';
import {
  listActiveIntegrationsByKind,
  upsertSocialPost,
  markIntegrationSyncSuccess,
} from '@metu/db/queries';
import { getIntegrationToken } from './_integration-token';

const UA = 'metu/0.1.0';

interface IgMedia {
  id?: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  permalink?: string;
  thumbnail_url?: string;
  timestamp?: string;
}

export const instagramSyncCron = inngest.createFunction(
  { id: 'instagram-sync-cron', name: 'Instagram: fan-out (every 6h)', concurrency: { limit: 1 } },
  { cron: '41 */6 * * *' },
  async ({ step }) => {
    const rows = await step.run('list', () => listActiveIntegrationsByKind('instagram'));
    for (const r of rows) {
      await step.sendEvent(`ig-${r.integrationId}`, {
        name: 'instagram/sync.requested',
        data: { workspaceId: r.workspaceId, integrationId: r.integrationId, reason: 'cron' },
      });
    }
    return { queued: rows.length };
  },
);

export const onInstagramSync = inngest.createFunction(
  {
    id: 'instagram-sync',
    name: 'Instagram: sync recent media',
    concurrency: { key: 'event.data.workspaceId', limit: 2 },
    retries: 2,
  },
  { event: 'instagram/sync.requested' },
  async ({ event, step }) => {
    const { workspaceId, integrationId } = parseEvent('instagram/sync.requested', event.data);
    const creds = await step.run('token', () =>
      getIntegrationToken(workspaceId, 'instagram', integrationId),
    );
    if (!creds) return { ok: false, reason: 'no-token' };

    const media = await step.run('fetch', async () => {
      const fields = 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp';
      const url = `https://graph.instagram.com/me/media?fields=${fields}&access_token=${encodeURIComponent(creds.token)}&limit=50`;
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`Instagram ${res.status}`);
      const data = (await res.json()) as { data?: IgMedia[] };
      return data.data ?? [];
    });

    let upserted = 0;
    for (const m of media) {
      if (!m.id) continue;
      await step.run(`m-${m.id}`, () =>
        upsertSocialPost({
          workspaceId,
          integrationId,
          platform: 'instagram',
          externalId: m.id!,
          title: (m.caption ?? '').slice(0, 500),
          url: m.permalink ?? null,
          publishedAt: m.timestamp ? new Date(m.timestamp) : null,
          metrics: {},
          metadata: {
            mediaType: m.media_type,
            mediaUrl: m.media_url,
            thumbnailUrl: m.thumbnail_url,
          },
        }),
      );
      upserted++;
    }
    await step.run('mark-success', () => markIntegrationSyncSuccess(integrationId));
    return { ok: true, upserted };
  },
);

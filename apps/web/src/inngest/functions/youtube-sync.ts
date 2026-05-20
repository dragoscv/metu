/**
 * YouTube sync: every 6h, list the channel's recent uploads (via the
 * `uploads` playlist) plus statistics. Each video → social_post
 * (platform='youtube'). Token is a Google OAuth access token.
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

interface YtChannel {
  id?: string;
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
}

interface YtPlaylistItem {
  contentDetails?: { videoId?: string; videoPublishedAt?: string };
  snippet?: { title?: string; description?: string };
}

interface YtVideo {
  id?: string;
  snippet?: { title?: string; publishedAt?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
}

async function gFetch<T>(token: string, url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA } });
  if (!res.ok) throw new Error(`YouTube ${res.status}`);
  return (await res.json()) as T;
}

export const youtubeSyncCron = inngest.createFunction(
  { id: 'youtube-sync-cron', name: 'YouTube: fan-out (every 6h)', concurrency: { limit: 1 } },
  { cron: '7 */6 * * *' },
  async ({ step }) => {
    const rows = await step.run('list', () => listActiveIntegrationsByKind('youtube'));
    for (const r of rows) {
      await step.sendEvent(`youtube-${r.integrationId}`, {
        name: 'youtube/sync.requested',
        data: { workspaceId: r.workspaceId, integrationId: r.integrationId, reason: 'cron' },
      });
    }
    return { queued: rows.length };
  },
);

export const onYoutubeSync = inngest.createFunction(
  {
    id: 'youtube-sync',
    name: 'YouTube: sync recent uploads + stats',
    concurrency: { key: 'event.data.workspaceId', limit: 2 },
    retries: 2,
  },
  { event: 'youtube/sync.requested' },
  async ({ event, step }) => {
    const { workspaceId, integrationId } = parseEvent('youtube/sync.requested', event.data);
    const creds = await step.run('token', () =>
      getIntegrationToken(workspaceId, 'youtube', integrationId),
    );
    if (!creds) return { ok: false, reason: 'no-token' };

    const uploadsPlaylist = await step.run('uploads-playlist', async () => {
      const data = await gFetch<{ items?: YtChannel[] }>(
        creds.token,
        'https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true',
      );
      return data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads ?? null;
    });
    if (!uploadsPlaylist) return { ok: false, reason: 'no-uploads-playlist' };

    const videoIds = await step.run('list-uploads', async () => {
      const data = await gFetch<{ items?: YtPlaylistItem[] }>(
        creds.token,
        `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails,snippet&playlistId=${encodeURIComponent(uploadsPlaylist)}&maxResults=50`,
      );
      return (data.items ?? [])
        .map((i) => i.contentDetails?.videoId)
        .filter((v): v is string => !!v);
    });

    if (videoIds.length === 0) return { ok: true, upserted: 0 };

    const videos = await step.run('video-stats', async () => {
      const data = await gFetch<{ items?: YtVideo[] }>(
        creds.token,
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoIds.join(',')}`,
      );
      return data.items ?? [];
    });

    let upserted = 0;
    for (const v of videos) {
      if (!v.id) continue;
      await step.run(`vid-${v.id}`, () =>
        upsertSocialPost({
          workspaceId,
          integrationId,
          platform: 'youtube',
          externalId: v.id!,
          title: (v.snippet?.title ?? '').slice(0, 500),
          url: `https://www.youtube.com/watch?v=${v.id}`,
          publishedAt: v.snippet?.publishedAt ? new Date(v.snippet.publishedAt) : null,
          metrics: {
            views: Number(v.statistics?.viewCount ?? 0),
            likes: Number(v.statistics?.likeCount ?? 0),
            comments: Number(v.statistics?.commentCount ?? 0),
          },
          metadata: {},
        }),
      );
      upserted++;
    }
    await step.run('mark-success', () => markIntegrationSyncSuccess(integrationId));
    return { ok: true, upserted };
  },
);

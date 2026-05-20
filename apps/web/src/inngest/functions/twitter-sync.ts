/**
 * Twitter/X sync: every 6h, pull the connected user's recent tweets via
 * the v2 API, with public_metrics. Each tweet is a `social_post`
 * (platform='twitter'). Free-tier app rate limits apply — 1 user-tweets
 * call per integration per run is enough for the dashboard.
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

interface Tweet {
  id?: string;
  text?: string;
  created_at?: string;
  public_metrics?: {
    retweet_count?: number;
    reply_count?: number;
    like_count?: number;
    quote_count?: number;
    impression_count?: number;
  };
  entities?: { urls?: Array<{ expanded_url?: string }> };
}

export const twitterSyncCron = inngest.createFunction(
  { id: 'twitter-sync-cron', name: 'Twitter: fan-out (every 6h)', concurrency: { limit: 1 } },
  { cron: '53 */6 * * *' },
  async ({ step }) => {
    const rows = await step.run('list', () => listActiveIntegrationsByKind('twitter'));
    for (const r of rows) {
      await step.sendEvent(`twitter-${r.integrationId}`, {
        name: 'twitter/sync.requested',
        data: { workspaceId: r.workspaceId, integrationId: r.integrationId, reason: 'cron' },
      });
    }
    return { queued: rows.length };
  },
);

export const onTwitterSync = inngest.createFunction(
  {
    id: 'twitter-sync',
    name: 'Twitter: sync recent tweets for one workspace',
    concurrency: { key: 'event.data.workspaceId', limit: 1 },
    retries: 1,
  },
  { event: 'twitter/sync.requested' },
  async ({ event, step }) => {
    const { workspaceId, integrationId } = parseEvent('twitter/sync.requested', event.data);

    const creds = await step.run('token', () =>
      getIntegrationToken(workspaceId, 'twitter', integrationId),
    );
    if (!creds) return { ok: false, reason: 'no-token' };

    // externalId stored at OAuth callback is the user id
    const userId = creds.externalId;
    if (!userId) return { ok: false, reason: 'no-user-id' };

    const tweets = await step.run('fetch', async () => {
      const url = new URL(`https://api.twitter.com/2/users/${encodeURIComponent(userId)}/tweets`);
      url.searchParams.set('max_results', '50');
      url.searchParams.set('tweet.fields', 'created_at,public_metrics,entities');
      url.searchParams.set('exclude', 'retweets,replies');
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${creds.token}`, 'User-Agent': UA },
      });
      if (!res.ok) throw new Error(`Twitter ${res.status}`);
      const data = (await res.json()) as { data?: Tweet[] };
      return data.data ?? [];
    });

    let upserted = 0;
    for (const t of tweets) {
      if (!t.id) continue;
      const m = t.public_metrics ?? {};
      await step.run(`tw-${t.id}`, () =>
        upsertSocialPost({
          workspaceId,
          integrationId,
          platform: 'twitter',
          externalId: t.id!,
          title: (t.text ?? '').slice(0, 500),
          url: `https://twitter.com/${userId}/status/${t.id}`,
          publishedAt: t.created_at ? new Date(t.created_at) : null,
          metrics: {
            likes: m.like_count ?? 0,
            retweets: m.retweet_count ?? 0,
            replies: m.reply_count ?? 0,
            quotes: m.quote_count ?? 0,
            impressions: m.impression_count ?? 0,
          },
          metadata: { entities: t.entities },
        }),
      );
      upserted++;
    }
    await step.run('mark-success', () => markIntegrationSyncSuccess(integrationId));
    return { ok: true, upserted };
  },
);

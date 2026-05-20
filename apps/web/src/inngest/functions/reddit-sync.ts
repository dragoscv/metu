/**
 * Reddit sync: every 6h, pull the connected user's recent submissions and
 * comments. Submissions are stored as `social_post` (platform='reddit'),
 * comments as social_post with externalId='c:<id>' so they share the
 * (platform, externalId) unique index without colliding.
 */
import { inngest } from '../client';
import { parseEvent } from '../schemas';
import {
  listActiveIntegrationsByKind,
  upsertSocialPost,
  markIntegrationSyncSuccess,
} from '@metu/db/queries';
import { getIntegrationToken } from './_integration-token';

const UA = 'metu/0.1.0 (by /u/metu-app)';

interface RedditMe {
  name?: string;
  id?: string;
}

interface RedditPost {
  kind?: string;
  data?: {
    id?: string;
    name?: string;
    title?: string;
    selftext?: string;
    body?: string;
    permalink?: string;
    subreddit?: string;
    score?: number;
    num_comments?: number;
    upvote_ratio?: number;
    created_utc?: number;
    link_title?: string;
  };
}

async function redditFetch<T>(
  token: string,
  path: string,
  params: Record<string, string> = {},
): Promise<T> {
  const url = new URL(`https://oauth.reddit.com${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`Reddit ${path} ${res.status}`);
  return (await res.json()) as T;
}

export const redditSyncCron = inngest.createFunction(
  { id: 'reddit-sync-cron', name: 'Reddit: fan-out (every 6h)', concurrency: { limit: 1 } },
  { cron: '47 */6 * * *' },
  async ({ step }) => {
    const rows = await step.run('list', () => listActiveIntegrationsByKind('reddit'));
    for (const r of rows) {
      await step.sendEvent(`reddit-${r.integrationId}`, {
        name: 'reddit/sync.requested',
        data: { workspaceId: r.workspaceId, integrationId: r.integrationId, reason: 'cron' },
      });
    }
    return { queued: rows.length };
  },
);

export const onRedditSync = inngest.createFunction(
  {
    id: 'reddit-sync',
    name: 'Reddit: sync user posts + comments',
    concurrency: { key: 'event.data.workspaceId', limit: 2 },
    retries: 2,
  },
  { event: 'reddit/sync.requested' },
  async ({ event, step }) => {
    const { workspaceId, integrationId } = parseEvent('reddit/sync.requested', event.data);

    const creds = await step.run('token', () =>
      getIntegrationToken(workspaceId, 'reddit', integrationId),
    );
    if (!creds) return { ok: false, reason: 'no-token' };

    const me = await step.run('me', () => redditFetch<RedditMe>(creds.token, '/api/v1/me'));
    if (!me?.name) return { ok: false, reason: 'no-identity' };

    const submitted = await step.run('submitted', () =>
      redditFetch<{ data?: { children?: RedditPost[] } }>(
        creds.token,
        `/user/${me.name}/submitted`,
        { limit: '50' },
      ),
    );
    const comments = await step.run('comments', () =>
      redditFetch<{ data?: { children?: RedditPost[] } }>(
        creds.token,
        `/user/${me.name}/comments`,
        { limit: '50' },
      ),
    );

    let upserted = 0;
    for (const c of submitted.data?.children ?? []) {
      const d = c.data;
      if (!d?.id) continue;
      await step.run(`sub-${d.id}`, () =>
        upsertSocialPost({
          workspaceId,
          integrationId,
          platform: 'reddit',
          externalId: d.id!,
          title: (d.title ?? '').slice(0, 500),
          url: d.permalink ? `https://www.reddit.com${d.permalink}` : null,
          publishedAt: d.created_utc ? new Date(d.created_utc * 1000) : null,
          metrics: {
            score: d.score ?? 0,
            comments: d.num_comments ?? 0,
            upvoteRatio: d.upvote_ratio ?? 0,
          },
          metadata: { subreddit: d.subreddit, kind: 'submission', body: d.selftext ?? null },
        }),
      );
      upserted++;
    }
    for (const c of comments.data?.children ?? []) {
      const d = c.data;
      if (!d?.id) continue;
      const externalId = `c:${d.id}`;
      await step.run(`com-${d.id}`, () =>
        upsertSocialPost({
          workspaceId,
          integrationId,
          platform: 'reddit',
          externalId,
          title: (d.body ?? '').slice(0, 500),
          url: d.permalink ? `https://www.reddit.com${d.permalink}` : null,
          publishedAt: d.created_utc ? new Date(d.created_utc * 1000) : null,
          metrics: { score: d.score ?? 0 },
          metadata: { subreddit: d.subreddit, kind: 'comment', linkTitle: d.link_title },
        }),
      );
      upserted++;
    }
    await step.run('mark-success', () => markIntegrationSyncSuccess(integrationId));
    return { ok: true, upserted };
  },
);

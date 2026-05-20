/**
 * Slack sync: every 6h, for each connected workspace, list channels the
 * bot is in and pull the latest 20 messages per channel. Each message is
 * persisted as a `social_post` (platform='slack', externalId='C…:ts') so
 * the social dashboard + Conductor can search them like any other post.
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

interface SlackChannel {
  id: string;
  name?: string;
  is_member?: boolean;
}

interface SlackMessage {
  ts?: string;
  text?: string;
  user?: string;
  permalink?: string;
  reactions?: Array<{ name: string; count: number }>;
  reply_count?: number;
  thread_ts?: string;
}

async function slackFetch<T>(token: string, path: string, params: Record<string, string> = {}) {
  const url = new URL(`https://slack.com/api/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`Slack ${path} ${res.status}`);
  const data = (await res.json()) as { ok?: boolean; error?: string } & T;
  if (!data.ok) throw new Error(`Slack ${path}: ${data.error ?? 'unknown'}`);
  return data;
}

export const slackSyncCron = inngest.createFunction(
  { id: 'slack-sync-cron', name: 'Slack: fan-out (every 6h)', concurrency: { limit: 1 } },
  { cron: '11 */6 * * *' },
  async ({ step }) => {
    const rows = await step.run('list', () => listActiveIntegrationsByKind('slack'));
    for (const r of rows) {
      await step.sendEvent(`slack-${r.integrationId}`, {
        name: 'slack/sync.requested',
        data: { workspaceId: r.workspaceId, integrationId: r.integrationId, reason: 'cron' },
      });
    }
    return { queued: rows.length };
  },
);

export const onSlackSync = inngest.createFunction(
  {
    id: 'slack-sync',
    name: 'Slack: sync messages for one workspace',
    concurrency: { key: 'event.data.workspaceId', limit: 2 },
    retries: 2,
  },
  { event: 'slack/sync.requested' },
  async ({ event, step }) => {
    const { workspaceId, integrationId } = parseEvent('slack/sync.requested', event.data);

    const creds = await step.run('token', () =>
      getIntegrationToken(workspaceId, 'slack', integrationId),
    );
    if (!creds) return { ok: false, reason: 'no-token' };

    const channels = await step.run('channels', async () => {
      const data = await slackFetch<{ channels?: SlackChannel[] }>(
        creds.token,
        'conversations.list',
        {
          types: 'public_channel,private_channel',
          limit: '100',
          exclude_archived: 'true',
        },
      );
      return (data.channels ?? []).filter((c) => c.is_member && c.id);
    });

    // DMs are opt-in per integration via `config.includeDms = true` (set
    // from the /integrations/slack settings page). When enabled we list
    // the most recent direct/group DMs and treat them like a channel.
    const includeDms = creds.config?.includeDms === true;
    const dms = includeDms
      ? await step.run('dms', async () => {
          try {
            const data = await slackFetch<{ channels?: SlackChannel[] }>(
              creds.token,
              'conversations.list',
              { types: 'im,mpim', limit: '50', exclude_archived: 'true' },
            );
            return (data.channels ?? []).filter((c) => c.id);
          } catch {
            return [];
          }
        })
      : [];

    const allChats = [...channels.slice(0, 25), ...dms.slice(0, 25)];

    let upserted = 0;
    for (const ch of allChats) {
      const messages = await step.run(`hist-${ch.id}`, async () => {
        try {
          const data = await slackFetch<{ messages?: SlackMessage[] }>(
            creds.token,
            'conversations.history',
            {
              channel: ch.id,
              limit: '20',
            },
          );
          return data.messages ?? [];
        } catch {
          return [];
        }
      });
      for (const m of messages) {
        if (!m.ts) continue;
        const text = (m.text ?? '').slice(0, 500);
        const reactions = (m.reactions ?? []).reduce((s, r) => s + r.count, 0);
        await step.run(`msg-${ch.id}-${m.ts}`, () =>
          upsertSocialPost({
            workspaceId,
            integrationId,
            platform: 'slack',
            externalId: `${ch.id}:${m.ts}`,
            title: text || null,
            url: m.permalink ?? null,
            publishedAt: new Date(Math.floor(Number(m.ts) * 1000)),
            metrics: { reactions, replies: m.reply_count ?? 0 },
            metadata: {
              channelId: ch.id,
              channelName: ch.name,
              user: m.user,
              threadTs: m.thread_ts,
            },
          }),
        );
        upserted++;
      }
    }
    await step.run('mark-success', () => markIntegrationSyncSuccess(integrationId));
    return { ok: true, channels: channels.length, dms: dms.length, upserted };
  },
);

/**
 * Linear sync: every 4h, pull issues assigned to the connected user that
 * were updated in the last 14 days, plus active cycles. Each issue is
 * stored as a `timeline_event` (kind='linear.issue.updated'). Token is the
 * raw key (no Bearer prefix) — Linear's GraphQL convention.
 */
import { inngest } from '../client';
import { parseEvent } from '../schemas';
import { getDb } from '@metu/db';
import { listActiveIntegrationsByKind, markIntegrationSyncSuccess } from '@metu/db/queries';
import { timelineEvent } from '@metu/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { getIntegrationToken } from './_integration-token';

const QUERY = `
  query MetuLinearSync($since: DateTimeOrDuration!) {
    viewer { id name }
    issues(
      first: 100
      filter: { assignee: { isMe: { eq: true } }, updatedAt: { gte: $since } }
      orderBy: updatedAt
    ) {
      nodes {
        id
        identifier
        title
        url
        priority
        state { name type }
        updatedAt
        team { key name }
        cycle { id name endsAt }
      }
    }
    comments(
      first: 50
      filter: { user: { isMe: { eq: true } }, updatedAt: { gte: $since } }
      orderBy: updatedAt
    ) {
      nodes {
        id
        body
        url
        updatedAt
        issue { id identifier title }
      }
    }
  }
`;

interface LinearComment {
  id: string;
  body: string;
  url: string;
  updatedAt: string;
  issue?: { id: string; identifier: string; title: string } | null;
}

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  priority: number;
  state?: { name: string; type: string } | null;
  updatedAt: string;
  team?: { key: string; name: string } | null;
  cycle?: { id: string; name: string; endsAt: string | null } | null;
}

export const linearSyncCron = inngest.createFunction(
  { id: 'linear-sync-cron', name: 'Linear: fan-out (every 4h)', concurrency: { limit: 1 } },
  { cron: '37 */4 * * *' },
  async ({ step }) => {
    const rows = await step.run('list', () => listActiveIntegrationsByKind('linear'));
    for (const r of rows) {
      await step.sendEvent(`linear-${r.integrationId}`, {
        name: 'linear/sync.requested',
        data: { workspaceId: r.workspaceId, integrationId: r.integrationId, reason: 'cron' },
      });
    }
    return { queued: rows.length };
  },
);

export const onLinearSync = inngest.createFunction(
  {
    id: 'linear-sync',
    name: 'Linear: sync assigned issues for one workspace',
    concurrency: { key: 'event.data.workspaceId', limit: 2 },
    retries: 2,
  },
  { event: 'linear/sync.requested' },
  async ({ event, step }) => {
    const { workspaceId, integrationId } = parseEvent('linear/sync.requested', event.data);

    const creds = await step.run('token', () =>
      getIntegrationToken(workspaceId, 'linear', integrationId),
    );
    if (!creds) return { ok: false, reason: 'no-token' };

    const result = await step.run('fetch', async () => {
      const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
      const res = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: {
          Authorization: creds.token,
          'Content-Type': 'application/json',
          'User-Agent': 'metu/0.1.0',
        },
        body: JSON.stringify({ query: QUERY, variables: { since } }),
      });
      if (!res.ok) throw new Error(`Linear ${res.status}`);
      const data = (await res.json()) as {
        data?: {
          issues?: { nodes?: LinearIssue[] };
          comments?: { nodes?: LinearComment[] };
        };
      };
      return {
        issues: data.data?.issues?.nodes ?? [],
        comments: data.data?.comments?.nodes ?? [],
      };
    });

    const issues = result.issues;
    const comments = result.comments;

    let upserted = 0;
    for (const i of issues) {
      await step.run(`iss-${i.id}`, async () => {
        const db = getDb();
        await db
          .delete(timelineEvent)
          .where(
            and(
              eq(timelineEvent.workspaceId, workspaceId),
              eq(timelineEvent.kind, 'linear.issue.updated'),
              sql`${timelineEvent.payload}->>'externalId' = ${i.id}`,
            ),
          );
        await db.insert(timelineEvent).values({
          workspaceId,
          kind: 'linear.issue.updated',
          title: `${i.identifier}: ${i.title}`,
          body: i.state?.name ? `state: ${i.state.name}` : null,
          payload: {
            externalId: i.id,
            integrationId,
            identifier: i.identifier,
            url: i.url,
            priority: i.priority,
            stateType: i.state?.type,
            team: i.team,
            cycle: i.cycle,
          },
          importance: i.priority === 1 ? 0.85 : i.priority === 2 ? 0.7 : 0.55,
          occurredAt: new Date(i.updatedAt),
        });
      });
      upserted++;
    }
    await step.run('mark-success', () => markIntegrationSyncSuccess(integrationId));
    let commentsUpserted = 0;
    for (const c of comments) {
      await step.run(`cmt-${c.id}`, async () => {
        const db = getDb();
        await db
          .delete(timelineEvent)
          .where(
            and(
              eq(timelineEvent.workspaceId, workspaceId),
              eq(timelineEvent.kind, 'linear.comment'),
              sql`${timelineEvent.payload}->>'externalId' = ${c.id}`,
            ),
          );
        await db.insert(timelineEvent).values({
          workspaceId,
          kind: 'linear.comment',
          title: c.issue
            ? `Comment on ${c.issue.identifier}: ${c.issue.title}`.slice(0, 200)
            : 'Linear comment',
          body: c.body.slice(0, 1000),
          payload: {
            externalId: c.id,
            integrationId,
            url: c.url,
            issueId: c.issue?.id,
            issueIdentifier: c.issue?.identifier,
          },
          importance: 0.4,
          occurredAt: new Date(c.updatedAt),
        });
      });
      commentsUpserted++;
    }
    return { ok: true, upserted, commentsUpserted };
  },
);

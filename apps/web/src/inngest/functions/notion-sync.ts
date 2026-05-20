/**
 * Notion sync: every 6h, list pages the user has access to via the search
 * endpoint, plus their recent comments. Each page → timeline_event(kind='notion.page'),
 * each comment → timeline_event(kind='notion.comment'). Idempotent on
 * `(workspaceId, payload->>'externalId')` per kind.
 */
import { inngest } from '../client';
import { parseEvent } from '../schemas';
import { getDb } from '@metu/db';
import { listActiveIntegrationsByKind, markIntegrationSyncSuccess } from '@metu/db/queries';
import { timelineEvent } from '@metu/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { getIntegrationToken } from './_integration-token';

const UA = 'metu/0.1.0';
const NOTION_VERSION = '2022-06-28';

interface NotionPage {
  id?: string;
  url?: string;
  last_edited_time?: string;
  created_time?: string;
  properties?: Record<string, unknown>;
  parent?: { type?: string; database_id?: string; page_id?: string; workspace?: boolean };
  object?: 'page' | 'database';
}

function pageTitle(p: NotionPage): string {
  const props = p.properties ?? {};
  for (const v of Object.values(props)) {
    const node = v as { type?: string; title?: Array<{ plain_text?: string }> };
    if (node?.type === 'title' && Array.isArray(node.title)) {
      const txt = node.title.map((t) => t.plain_text ?? '').join('');
      if (txt) return txt.slice(0, 200);
    }
  }
  return 'Untitled';
}

async function notionFetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'User-Agent': UA,
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Notion ${res.status}`);
  return (await res.json()) as T;
}

export const notionSyncCron = inngest.createFunction(
  { id: 'notion-sync-cron', name: 'Notion: fan-out (every 6h)', concurrency: { limit: 1 } },
  { cron: '17 */6 * * *' },
  async ({ step }) => {
    const rows = await step.run('list', () => listActiveIntegrationsByKind('notion'));
    for (const r of rows) {
      await step.sendEvent(`notion-${r.integrationId}`, {
        name: 'notion/sync.requested',
        data: { workspaceId: r.workspaceId, integrationId: r.integrationId, reason: 'cron' },
      });
    }
    return { queued: rows.length };
  },
);

export const onNotionSync = inngest.createFunction(
  {
    id: 'notion-sync',
    name: 'Notion: sync recent pages + comments',
    concurrency: { key: 'event.data.workspaceId', limit: 2 },
    retries: 2,
  },
  { event: 'notion/sync.requested' },
  async ({ event, step }) => {
    const { workspaceId, integrationId } = parseEvent('notion/sync.requested', event.data);
    const creds = await step.run('token', () =>
      getIntegrationToken(workspaceId, 'notion', integrationId),
    );
    if (!creds) return { ok: false, reason: 'no-token' };

    const pages = await step.run('search-pages', async () => {
      const data = await notionFetch<{ results?: NotionPage[] }>(creds.token, '/search', {
        method: 'POST',
        body: JSON.stringify({
          filter: { property: 'object', value: 'page' },
          sort: { direction: 'descending', timestamp: 'last_edited_time' },
          page_size: 50,
        }),
      });
      return data.results ?? [];
    });

    let upserted = 0;
    for (const p of pages) {
      if (!p.id) continue;
      const externalId = p.id;
      const occurredAt = new Date(p.last_edited_time ?? p.created_time ?? Date.now());
      const title = pageTitle(p);
      await step.run(`page-${externalId}`, async () => {
        const db = getDb();
        await db
          .delete(timelineEvent)
          .where(
            and(
              eq(timelineEvent.workspaceId, workspaceId),
              eq(timelineEvent.kind, 'notion.page'),
              sql`${timelineEvent.payload}->>'externalId' = ${externalId}`,
            ),
          );
        await db.insert(timelineEvent).values({
          workspaceId,
          kind: 'notion.page',
          title,
          body: null,
          payload: {
            externalId,
            integrationId,
            pageId: p.id,
            url: p.url,
            parentType: p.parent?.type,
          },
          importance: 0.5,
          occurredAt,
        });
      });
      upserted++;
    }

    await step.run('mark-success', () => markIntegrationSyncSuccess(integrationId));
    return { ok: true, upserted };
  },
);

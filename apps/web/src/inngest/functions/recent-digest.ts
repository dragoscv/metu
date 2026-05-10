/**
 * Recent-activity digest refresher.
 *
 * Cron every 15 minutes — for every workspace with an enabled agent
 * policy, builds a tiny natural-language digest from the last few
 * timeline events and upserts into `workspace_recent_digest`. Powers
 * the `{{recentDigest}}` persona prompt placeholder without paying an
 * embed/recall cost on every companion turn.
 *
 * Format: "Recently: <title1>; <title2>; <title3>. (3 events in the
 * last 6h)". Truncated to ~280 chars so it never blows up the prompt.
 */
import { and, eq, gte, sql, desc } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { agentPolicy, timelineEvent, workspaceRecentDigest } from '@metu/db/schema';
import { inngest } from '../client';

const LOOKBACK_HOURS = 6;
const MAX_TITLES = 5;
const MAX_LEN = 280;

export const recentDigestRefresh = inngest.createFunction(
  { id: 'recent-digest-refresh', name: 'Companion-Agent: recent digest refresh' },
  { cron: '*/15 * * * *' },
  async ({ step }) => {
    const workspaces = await step.run('list-workspaces', async () => {
      const db = getDb();
      const rows = await db
        .select({ workspaceId: agentPolicy.workspaceId })
        .from(agentPolicy)
        .where(eq(agentPolicy.enabled, true));
      return rows.map((r) => r.workspaceId);
    });

    if (workspaces.length === 0) return { workspaces: 0, refreshed: 0 };

    let refreshed = 0;
    const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);

    for (const wsId of workspaces) {
      const digest = await step.run(`build-${wsId}`, async () => {
        const db = getDb();
        const events = await db
          .select({ title: timelineEvent.title })
          .from(timelineEvent)
          .where(and(eq(timelineEvent.workspaceId, wsId), gte(timelineEvent.occurredAt, cutoff)))
          .orderBy(desc(timelineEvent.occurredAt))
          .limit(MAX_TITLES);

        if (events.length === 0) {
          return `No notable activity in the last ${LOOKBACK_HOURS}h.`;
        }
        const titles = events.map((e) => e.title).join('; ');
        const total = events.length === MAX_TITLES ? `${MAX_TITLES}+` : `${events.length}`;
        const out = `Recently: ${titles}. (${total} events in the last ${LOOKBACK_HOURS}h)`;
        return out.length > MAX_LEN ? out.slice(0, MAX_LEN - 1) + '\u2026' : out;
      });

      await step.run(`upsert-${wsId}`, async () => {
        const db = getDb();
        await db
          .insert(workspaceRecentDigest)
          .values({ workspaceId: wsId, digest })
          .onConflictDoUpdate({
            target: workspaceRecentDigest.workspaceId,
            set: { digest, updatedAt: sql`now()` },
          });
      });
      refreshed++;
    }

    return { workspaces: workspaces.length, refreshed };
  },
);

/**
 * Continuity workflows — auto-prewarm stale "where was I?" briefings.
 *
 * Fired (a) when a user opens a project page and the latest briefing is
 * older than 24h (or absent), and (b) by the future C4 morning cron.
 *
 * Debounced per-project so a flurry of page visits collapses to one LLM
 * call. Concurrency-limited per-workspace so a noisy workspace can't
 * starve everyone else.
 */
import { and, desc, eq, gt, gte, isNull, sql } from 'drizzle-orm';
import { restoreProjectContext } from '@metu/core/continuity';
import { getDb } from '@metu/db';
import { workspacesWithLiveDevices } from '@metu/db/queries';
import {
  continuityBriefing,
  notification,
  project,
  telegramChatLink,
  workspaceMember,
} from '@metu/db/schema';
import { sendTextMessage as sendTelegramText } from '@metu/integrations/telegram';
import { hubBroadcast } from '../../lib/hub';
import { inngest } from '../client';
import { parseEvent } from '../schemas';

/** A briefing is "fresh" if generated within this window. */
const FRESHNESS_MS = 24 * 60 * 60 * 1000;

export const onContinuityPrewarm = inngest.createFunction(
  {
    id: 'continuity-prewarm',
    name: 'Continuity briefing prewarm',
    concurrency: { key: 'event.data.workspaceId', limit: 2 },
    debounce: { period: '5m', key: 'event.data.projectId' },
  },
  { event: 'continuity/prewarm' },
  async ({ event, step, logger }) => {
    const { workspaceId, projectId, reason } = parseEvent('continuity/prewarm', event.data);

    // Confirm scoping + freshness inside the function so the same event
    // can be fired without callers having to re-check.
    const fresh = await step.run('check-freshness', async () => {
      const db = getDb();
      const [proj] = await db
        .select({ id: project.id })
        .from(project)
        .where(and(eq(project.id, projectId), eq(project.workspaceId, workspaceId)))
        .limit(1);
      if (!proj) return { skip: 'project_not_found' as const };

      const cutoff = new Date(Date.now() - FRESHNESS_MS);
      const [recent] = await db
        .select({ id: continuityBriefing.id })
        .from(continuityBriefing)
        .where(
          and(
            eq(continuityBriefing.workspaceId, workspaceId),
            eq(continuityBriefing.projectId, projectId),
            gt(continuityBriefing.generatedAt, cutoff),
          ),
        )
        .orderBy(desc(continuityBriefing.generatedAt))
        .limit(1);
      return recent ? { skip: 'already_fresh' as const } : { skip: false as const };
    });

    if (fresh.skip) {
      logger.info('continuity-prewarm skipped', { projectId, reason: fresh.skip });
      return { ok: true, skipped: fresh.skip };
    }

    const generated = await step.run('generate', () =>
      restoreProjectContext(workspaceId, projectId),
    );

    await step.run('persist', async () => {
      const db = getDb();
      await db.insert(continuityBriefing).values({
        workspaceId,
        projectId,
        briefing: generated.briefing,
        modelProvider: generated.provider,
        modelId: generated.modelId,
      });
    });

    return {
      ok: true,
      reason: reason ?? 'stale',
      provider: generated.provider,
      modelId: generated.modelId,
    };
  },
);

/**
 * Daily morning prewarm — at 06:00 every workspace's top-N most active
 * projects get a fresh briefing so the dashboard's morning view loads
 * on cached context. We rank by `momentumScore` (the existing decayed
 * score that already folds recency in) and cap at TOP_N per workspace.
 *
 * Concurrency-limited globally so a hundred workspaces can't stampede
 * the LLM provider; the per-project debounce inside `onContinuityPrewarm`
 * still applies.
 */
const TOP_N = 5;

export const continuityMorningCron = inngest.createFunction(
  {
    id: 'continuity-morning-cron',
    name: 'Continuity morning prewarm',
    concurrency: { limit: 4 },
  },
  { cron: '0 6 * * *' },
  async ({ step, logger }) => {
    const candidates = await step.run('pick-projects', async () => {
      const db = getDb();
      // Top-N per workspace by momentum. We pull all active projects
      // ordered by (workspaceId, momentumScore desc) and bucket in JS;
      // it's fine for the expected workspace count (<10k).
      const rows = await db
        .select({
          id: project.id,
          workspaceId: project.workspaceId,
          momentumScore: project.momentumScore,
        })
        .from(project)
        .where(and(eq(project.status, 'active'), isNull(project.deletedAt)))
        .orderBy(desc(project.momentumScore));

      const seen = new Map<string, number>();
      const picked: Array<{ workspaceId: string; projectId: string }> = [];
      for (const row of rows) {
        const count = seen.get(row.workspaceId) ?? 0;
        if (count >= TOP_N) continue;
        seen.set(row.workspaceId, count + 1);
        picked.push({ workspaceId: row.workspaceId, projectId: row.id });
      }
      return picked;
    });

    if (candidates.length === 0) {
      logger.info('continuity-morning-cron no candidates');
      return { ok: true, dispatched: 0 };
    }

    await step.sendEvent(
      'fan-out',
      candidates.map((c) => ({
        name: 'continuity/prewarm' as const,
        data: { workspaceId: c.workspaceId, projectId: c.projectId, reason: 'morning-cron' },
      })),
    );

    return { ok: true, dispatched: candidates.length };
  },
);

/**
 * Morning brief delivery — runs 30 min after the prewarm cron.
 *
 * For every workspace that has a fresh briefing (generated in the last 24h)
 * for at least one active project, picks the highest-momentum one and
 * inserts a `notification` row per workspace member. Title + body come
 * from the briefing's last paragraph (the smallest-next-step paragraph),
 * actionUrl deep-links to /resume so a tap takes the user straight there.
 *
 * Notifications dedupe on `(userId, source, metadata.briefingId)` via a
 * pre-check so re-runs of the same briefing don't spam.
 */
function nextStepParagraph(briefing: string): string {
  const paras = briefing
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const last = paras[paras.length - 1] ?? briefing.trim();
  return last.length > 600 ? last.slice(0, 597).replace(/\s+\S*$/, '') + '…' : last;
}

export const continuityMorningDelivery = inngest.createFunction(
  {
    id: 'continuity-morning-delivery',
    name: 'Continuity morning brief delivery',
    concurrency: { limit: 4 },
  },
  { cron: '30 6 * * *' },
  async ({ step, logger }) => {
    const recipients = await step.run('pick-recipients', async () => {
      const db = getDb();
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // One latest fresh briefing per workspace, joined with the highest-
      // momentum project. SELECT DISTINCT ON (workspace_id) gives us the
      // top row per workspace ordered by (momentum desc, generated_at desc).
      const briefingRows = await db.execute<{
        workspace_id: string;
        project_id: string;
        project_name: string;
        briefing_id: string;
        briefing: string;
      }>(sql`
        SELECT DISTINCT ON (cb.workspace_id)
          cb.workspace_id,
          cb.project_id,
          p.name AS project_name,
          cb.id AS briefing_id,
          cb.briefing
        FROM ${continuityBriefing} cb
        JOIN ${project} p ON p.id = cb.project_id
        WHERE cb.generated_at >= ${cutoff}
          AND p.status = 'active'
          AND p.deleted_at IS NULL
        ORDER BY cb.workspace_id, p.momentum_score DESC NULLS LAST, cb.generated_at DESC
      `);

      const briefings = (
        Array.isArray(briefingRows)
          ? briefingRows
          : ((briefingRows as { rows?: unknown[] }).rows ?? [])
      ) as Array<{
        workspace_id: string;
        project_id: string;
        project_name: string;
        briefing_id: string;
        briefing: string;
      }>;
      if (briefings.length === 0) return [];

      // Members of those workspaces.
      const wsIds = Array.from(new Set(briefings.map((b) => b.workspace_id)));
      const members = await db
        .select({ workspaceId: workspaceMember.workspaceId, userId: workspaceMember.userId })
        .from(workspaceMember)
        .where(sql`${workspaceMember.workspaceId} = any(${wsIds})`);

      const byWs = new Map(briefings.map((b) => [b.workspace_id, b]));
      return members
        .map((m) => {
          const b = byWs.get(m.workspaceId);
          if (!b) return null;
          return {
            userId: m.userId,
            workspaceId: m.workspaceId,
            projectId: b.project_id,
            projectName: b.project_name,
            briefingId: b.briefing_id,
            nextStep: nextStepParagraph(b.briefing),
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
    });

    if (recipients.length === 0) {
      logger.info('continuity-morning-delivery no recipients');
      return { ok: true, delivered: 0 };
    }

    const inserted = await step.run('insert-notifications', async () => {
      const db = getDb();
      const since = new Date(Date.now() - 18 * 60 * 60 * 1000);

      // Filter out users who already received the morning brief in the last 18h.
      const existing = await db
        .select({
          userId: notification.userId,
          briefingId: sql<string>`${notification.metadata}->>'briefingId'`,
        })
        .from(notification)
        .where(
          and(
            eq(notification.source, 'conductor:morning-brief'),
            gte(notification.createdAt, since),
            sql`${notification.userId} = any(${recipients.map((r) => r.userId)})`,
          ),
        );
      const seen = new Set(existing.map((e) => `${e.userId}:${e.briefingId}`));

      const fresh = recipients.filter((r) => !seen.has(`${r.userId}:${r.briefingId}`));
      if (fresh.length === 0) return 0;

      await db.insert(notification).values(
        fresh.map((r) => ({
          workspaceId: r.workspaceId,
          userId: r.userId,
          title: `Where to start: ${r.projectName}`,
          body: r.nextStep,
          urgency: 'normal' as const,
          source: 'conductor:morning-brief',
          actionUrl: '/resume?since=3d',
          actions: [
            { id: 'resume', label: 'Resume', kind: 'open' as const, href: '/resume?since=3d' },
            {
              id: 'project',
              label: 'Open project',
              kind: 'open' as const,
              href: `/projects/${r.projectId}`,
            },
          ],
          metadata: { briefingId: r.briefingId, projectId: r.projectId },
        })),
      );
      return fresh.length;
    });

    // Best-effort Telegram push. Skips silently if the bot token is unset
    // or the workspace has no linked chats; per-chat failures are logged
    // but never fail the whole step.
    const telegramSent = await step.run('telegram-deliver', async () => {
      if (!process.env.TELEGRAM_BOT_TOKEN) return 0;
      const wsIds = Array.from(new Set(recipients.map((r) => r.workspaceId)));
      if (wsIds.length === 0) return 0;
      const db = getDb();
      const links = await db
        .select({
          chatId: telegramChatLink.chatId,
          workspaceId: telegramChatLink.workspaceId,
        })
        .from(telegramChatLink)
        .where(sql`${telegramChatLink.workspaceId} = any(${wsIds})`);
      if (links.length === 0) return 0;

      // Best-effort de-dup: one chat = one message per workspace.
      const byWs = new Map(recipients.map((r) => [r.workspaceId, r]));
      let sent = 0;
      for (const link of links) {
        const r = byWs.get(link.workspaceId);
        if (!r) continue;
        const text = `🌅 *${r.projectName}*\n\n${r.nextStep}\n\nOpen: ${process.env.METU_WEB_URL ?? ''}/resume?since=3d`;
        try {
          await sendTelegramText(link.chatId, text, {
            parseMode: 'Markdown',
            disableNotification: true,
          });
          sent += 1;
        } catch (err) {
          logger.warn('telegram morning brief failed', {
            chatId: link.chatId,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return sent;
    });

    // Live push to connected devices (companion / vscode-ext / browser-ext /
    // mobile). Best-effort, returns null if HUB_URL/HUB_INTERNAL_SECRET unset.
    // Skips workspaces with no fresh-online device to avoid pointless broadcasts.
    const hubDelivered = await step.run('hub-broadcast', async () => {
      const wsIds = Array.from(new Set(recipients.map((r) => r.workspaceId)));
      const live = await workspacesWithLiveDevices(wsIds);
      if (live.size === 0) return 0;
      let total = 0;
      const seen = new Set<string>();
      for (const r of recipients) {
        if (!live.has(r.workspaceId)) continue;
        if (seen.has(r.workspaceId)) continue;
        seen.add(r.workspaceId);
        const res = await hubBroadcast({
          workspaceId: r.workspaceId,
          envelope: {
            type: 'event.notification',
            id: crypto.randomUUID(),
            title: `Where to start: ${r.projectName}`,
            body: r.nextStep,
            urgency: 'normal',
            actionUrl: '/resume?since=3d',
            actions: [
              { id: 'resume', label: 'Resume', kind: 'open' },
              { id: 'project', label: 'Open project', kind: 'open' },
            ],
          },
        });
        total += res?.delivered ?? 0;
      }
      return total;
    });

    return {
      ok: true,
      delivered: inserted,
      telegramSent,
      hubDelivered,
      candidates: recipients.length,
    };
  },
);

/**
 * Pre-morning prewarm — at 05:30 daily, find every active project with
 * any momentum but no fresh briefing in the last 24h and fan out
 * continuity/prewarm events. Ensures the 06:30 morning delivery has
 * fresh content to pick from instead of yesterday's leftovers.
 */
export const continuityMorningPrewarm = inngest.createFunction(
  {
    id: 'continuity-morning-prewarm',
    name: 'Continuity morning prewarm fan-out',
    concurrency: { limit: 2 },
  },
  { cron: '30 5 * * *' },
  async ({ step, logger }) => {
    const stale = await step.run('list-stale-projects', async () => {
      const db = getDb();
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return db
        .select({ workspaceId: project.workspaceId, projectId: project.id })
        .from(project)
        .where(
          and(
            eq(project.status, 'active'),
            isNull(project.deletedAt),
            gt(project.momentumScore, 0.05),
            sql`not exists (
              select 1 from ${continuityBriefing} cb
              where cb.project_id = ${project.id}
                and cb.workspace_id = ${project.workspaceId}
                and cb.generated_at >= ${cutoff}
            )`,
          ),
        )
        .limit(200);
    });

    if (stale.length === 0) {
      logger.info('continuity-morning-prewarm nothing stale');
      return { ok: true, fanned: 0 };
    }

    await step.sendEvent(
      'fan-prewarm',
      stale.map((s) => ({
        name: 'continuity/prewarm' as const,
        data: {
          workspaceId: s.workspaceId,
          projectId: s.projectId,
          reason: 'morning-prewarm',
        },
      })),
    );

    return { ok: true, fanned: stale.length };
  },
);

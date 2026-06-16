/**
 * Proactive smart-message sweep.
 *
 * Hourly (and on-demand) the sweep walks workspaces that have an active,
 * outbound-enabled, *bound* Telegram bot and asks the workspace `chat` model
 * (CodAI) whether anything is worth proactively telling the user right now.
 * If so, the model writes the message and we route it through `notify()` —
 * which delivers to Telegram + push and enforces quiet hours, daily caps and
 * spacing. The MODEL is the "when" gate; notify() is the hard guardrail.
 *
 * This complements the event-driven `conductor-proactive-cron` (which reacts
 * to specific stalls/deadlines) with a holistic salience pass.
 */
import { and, eq } from 'drizzle-orm';
import { inngest } from '../client';
import { parseEvent } from '../schemas';
import { getDb } from '@metu/db';
import { telegramBot, discordBot } from '@metu/db/schema';
import { composeProactiveMessage } from '@/lib/proactive-compose';
import { notify } from '@/lib/notify';
import { log } from '@/lib/logger';

interface EligibleBot {
  workspaceId: string;
  userId: string;
  tone: string;
}

async function eligibleBots(onlyWorkspaceId?: string): Promise<EligibleBot[]> {
  const db = getDb();
  const tgRows = await db
    .select({
      workspaceId: telegramBot.workspaceId,
      userId: telegramBot.connectedByUserId,
      tone: telegramBot.tone,
      outboundEnabled: telegramBot.outboundEnabled,
      allowed: telegramBot.allowedTelegramUserId,
      status: telegramBot.status,
    })
    .from(telegramBot)
    .where(
      onlyWorkspaceId
        ? eq(telegramBot.workspaceId, onlyWorkspaceId)
        : and(eq(telegramBot.outboundEnabled, true), eq(telegramBot.status, 'active')),
    );
  const dcRows = await db
    .select({
      workspaceId: discordBot.workspaceId,
      userId: discordBot.connectedByUserId,
      tone: discordBot.tone,
      outboundEnabled: discordBot.outboundEnabled,
      allowed: discordBot.allowedDiscordUserId,
      status: discordBot.status,
    })
    .from(discordBot)
    .where(
      onlyWorkspaceId
        ? eq(discordBot.workspaceId, onlyWorkspaceId)
        : and(eq(discordBot.outboundEnabled, true), eq(discordBot.status, 'active')),
    );
  // Union both channels; de-dup by workspace (notify() fans out to all bound
  // channels anyway, so we only need one sweep per workspace).
  const byWs = new Map<string, EligibleBot>();
  for (const r of [...tgRows, ...dcRows]) {
    if (r.outboundEnabled && r.status === 'active' && !!r.allowed && !byWs.has(r.workspaceId)) {
      byWs.set(r.workspaceId, { workspaceId: r.workspaceId, userId: r.userId, tone: r.tone });
    }
  }
  return [...byWs.values()];
}

async function sweepOne(bot: EligibleBot, hint?: string): Promise<boolean> {
  const composed = await composeProactiveMessage({
    workspaceId: bot.workspaceId,
    tone: bot.tone,
    hint,
  });
  if (!composed) return false;
  await notify({
    workspaceId: bot.workspaceId,
    userId: bot.userId,
    title: composed.title,
    body: composed.body,
    urgency: 'normal',
    source: 'proactive',
    metadata: { reason: composed.reason },
  });
  return true;
}

export const proactiveSweepCron = inngest.createFunction(
  {
    id: 'conductor-proactive-sweep-cron',
    name: 'Conductor proactive smart-message sweep',
    concurrency: { limit: 3 },
  },
  { cron: '0 * * * *' },
  async ({ step }) => {
    const bots = await step.run('eligible', () => eligibleBots());
    let sent = 0;
    for (const bot of bots) {
      // Each workspace is independent; failures shouldn't abort the sweep.
      const did = await step.run(`sweep-${bot.workspaceId}`, async () => {
        try {
          return await sweepOne(bot);
        } catch (err) {
          log.error('proactive.sweep.failed', { workspaceId: bot.workspaceId }, err);
          return false;
        }
      });
      if (did) sent += 1;
    }
    return { ok: true, eligible: bots.length, sent };
  },
);

export const onProactiveSweep = inngest.createFunction(
  {
    id: 'conductor-proactive-sweep',
    name: 'Conductor proactive sweep (on-demand)',
    concurrency: { key: 'event.data.workspaceId', limit: 1 },
  },
  { event: 'conductor/proactive-sweep' },
  async ({ event, step }) => {
    const { workspaceId, hint } = parseEvent('conductor/proactive-sweep', event.data);
    const bots = await step.run('eligible', () => eligibleBots(workspaceId));
    let sent = 0;
    for (const bot of bots) {
      const did = await step.run(`sweep-${bot.workspaceId}`, () => sweepOne(bot, hint));
      if (did) sent += 1;
    }
    return { ok: true, eligible: bots.length, sent };
  },
);

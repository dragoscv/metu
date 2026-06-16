/**
 * Discord interaction processor for the BYO per-workspace bot.
 *
 * Discord requires a response within 3s, but Conductor turns are slower, so
 * for content commands we DEFER (type 5) and edit the original response via
 * the interaction webhook once the turn completes. Utility commands answer
 * inline (type 4). Access is locked to a single Discord user id.
 */
import 'server-only';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { getDb } from '@metu/db';
import {
  agentPolicy,
  autonomyGrant,
  discordBot,
  telegramLinkCode,
} from '@metu/db/schema';
import { task as taskTable } from '@metu/db/schema';
import { listOpenTasks } from '@metu/db/queries';
import { indexMemory } from '@metu/core/memory';
import { log } from '@metu/logger';
import { runConductorTurn } from '@/lib/conductor-turn';
import { applyApproval } from '@/lib/telegram-approvals';
import { type DiscordBotRow } from '@/lib/discord-bot';
import { approveRejectRow } from '@metu/integrations/discord/api';

const API_BASE = 'https://discord.com/api/v10';

export interface DiscordInteraction {
  id: string;
  type: number; // 1=ping 2=command 3=component
  token: string;
  application_id: string;
  data?: {
    name?: string;
    options?: { name: string; value: string }[];
    custom_id?: string;
  };
  member?: { user?: { id: string; username?: string } };
  user?: { id: string; username?: string };
  channel_id?: string;
}

const HELP = [
  '**METU Conductor**',
  '`/ask` — ask anything · `/do` — take an action',
  '`/now` `/today` `/goals` `/blocked` `/resume`',
  '`/capture` — save a note · `/autopilot on|off|3h`',
  '`/status` · `/help`',
].join('\n');

const PROMPTS: Record<string, string> = {
  now: 'What should I focus on right now? Be specific and brief.',
  today: "What's my plan for today and what are my open tasks?",
  goals: 'Give me a quick status of my goals and the next step for each.',
  blocked: "What's currently blocked and why? How do I unblock it?",
  resume: 'Where did I leave off? Summarize so I can resume quickly.',
};

function interactionUserId(i: DiscordInteraction): string {
  return i.member?.user?.id ?? i.user?.id ?? '';
}

function optvalue(i: DiscordInteraction, name: string): string {
  return i.data?.options?.find((o) => o.name === name)?.value ?? '';
}

/** Edit the original (deferred) interaction response. */
async function editOriginal(
  applicationId: string,
  interactionToken: string,
  content: string,
  components?: ReturnType<typeof approveRejectRow>,
): Promise<void> {
  await fetch(
    `${API_BASE}/webhooks/${applicationId}/${interactionToken}/messages/@original`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: content.slice(0, 1900), components }),
    },
  );
}

async function setAutopilot(bot: DiscordBotRow, userId: string, arg: string): Promise<string> {
  const db = getDb();
  const a = arg.trim().toLowerCase();
  if (a === 'on') {
    await db.update(agentPolicy).set({ defaultMode: 'autopilot' }).where(eq(agentPolicy.workspaceId, bot.workspaceId));
    return '🤖 Autopilot ON (permanent). Use `/autopilot off` to stop.';
  }
  if (a === 'off') {
    await db.update(agentPolicy).set({ defaultMode: 'ask' }).where(eq(agentPolicy.workspaceId, bot.workspaceId));
    await db.update(autonomyGrant).set({ revokedAt: new Date() }).where(and(eq(autonomyGrant.workspaceId, bot.workspaceId), isNull(autonomyGrant.revokedAt)));
    return '🛑 Autopilot OFF.';
  }
  if (!a) {
    const [pol] = await db.select({ mode: agentPolicy.defaultMode }).from(agentPolicy).where(eq(agentPolicy.workspaceId, bot.workspaceId)).limit(1);
    return `🤖 Autopilot: ${pol?.mode === 'autopilot' ? 'ON (permanent)' : `OFF (${pol?.mode ?? 'ask'})`}.`;
  }
  const m = a.match(/^(\d+)\s*([hm])$/);
  if (!m) return 'Use `/autopilot on`, `off`, or `3h`.';
  const ms = m[2] === 'h' ? Number(m[1]) * 3600_000 : Number(m[1]) * 60_000;
  const expiresAt = new Date(Date.now() + ms);
  await db.insert(autonomyGrant).values({ workspaceId: bot.workspaceId, userId, tool: null, note: 'granted via Discord', expiresAt });
  return `🤖 Autopilot ON until ${expiresAt.toLocaleString()}.`;
}

/** Bind via /link <code>. Returns reply text. */
async function handleLink(bot: DiscordBotRow, discordUserId: string, code: string): Promise<string> {
  if (!code) return 'Usage: `/link <code>` (code from the web app).';
  const db = getDb();
  const [row] = await db
    .select()
    .from(telegramLinkCode)
    .where(and(eq(telegramLinkCode.code, code), eq(telegramLinkCode.workspaceId, bot.workspaceId), gt(telegramLinkCode.expiresAt, new Date())))
    .limit(1);
  if (!row) return 'That code is invalid or expired. Generate a fresh one in the web app.';
  await db.delete(telegramLinkCode).where(eq(telegramLinkCode.code, row.code));
  if (!bot.allowedDiscordUserId) {
    await db.update(discordBot).set({ allowedDiscordUserId: discordUserId }).where(eq(discordBot.id, bot.id));
  }
  return '✅ Linked! You can now use the METU Conductor here. Try `/now`.';
}

/** Render the top open tasks as a numbered list for /tasks. */
async function renderTaskList(workspaceId: string): Promise<string> {
  const rows = await listOpenTasks(workspaceId);
  if (rows.length === 0) return '✅ No open tasks. Inbox zero!';
  const top = rows.slice(0, 15);
  const lines = top.map((t, i) => {
    const due = t.dueAt ? ` · due ${new Date(t.dueAt).toLocaleDateString()}` : '';
    const flag = t.status === 'blocked' ? ' 🚧' : t.status === 'doing' ? ' ▶️' : '';
    return `${i + 1}. ${t.title}${flag}${due}`;
  });
  return [`**Open tasks (${rows.length})**`, ...lines, '', 'Complete with `/done <number>`.'].join(
    '\n',
  );
}

/** Complete the Nth task from the same order /tasks shows. */
async function completeTaskByIndex(workspaceId: string, n: number): Promise<string> {
  const rows = await listOpenTasks(workspaceId);
  const target = rows.slice(0, 15)[n - 1];
  if (!target) return `No task #${n}. Run /tasks to see the list.`;
  await getDb()
    .update(taskTable)
    .set({ status: 'done' })
    .where(and(eq(taskTable.id, target.id), eq(taskTable.workspaceId, workspaceId)));
  return `✅ Done: ${target.title}`;
}

/**
 * Handle a slash command or component. For slow content commands the caller
 * has already returned a DEFER (type 5); we edit the original message here.
 */
export async function processDiscordCommand(
  bot: DiscordBotRow,
  i: DiscordInteraction,
): Promise<void> {
  const discordUserId = interactionUserId(i);
  const name = i.data?.name ?? '';

  // Access lock (link is allowed pre-lock).
  if (name !== 'link' && bot.allowedDiscordUserId && discordUserId !== bot.allowedDiscordUserId) {
    await editOriginal(bot.applicationId, i.token, 'This is a private METU bot. Access denied.');
    return;
  }

  if (name === 'link') {
    await editOriginal(bot.applicationId, i.token, await handleLink(bot, discordUserId, optvalue(i, 'code')));
    return;
  }
  if (name === 'help') {
    await editOriginal(bot.applicationId, i.token, HELP);
    return;
  }
  if (name === 'status') {
    await editOriginal(
      bot.applicationId,
      i.token,
      `Connected as ${bot.botUsername ?? 'bot'} · proactive ${bot.outboundEnabled ? 'on' : 'off'} (${bot.sentToday}/${bot.dailyCap}) · tone ${bot.tone}`,
    );
    return;
  }
  if (name === 'autopilot') {
    await editOriginal(bot.applicationId, i.token, await setAutopilot(bot, bot.connectedByUserId, optvalue(i, 'mode')));
    return;
  }
  if (name === 'capture') {
    const textVal = optvalue(i, 'text');
    if (!textVal) {
      await editOriginal(bot.applicationId, i.token, 'Usage: /capture <text>');
      return;
    }
    await indexMemory({ workspaceId: bot.workspaceId, sourceKind: 'capture', content: textVal, metadata: { channel: 'discord' } });
    await editOriginal(bot.applicationId, i.token, '📥 Captured.');
    return;
  }
  if (name === 'tasks') {
    await editOriginal(bot.applicationId, i.token, await renderTaskList(bot.workspaceId));
    return;
  }
  if (name === 'task') {
    const textVal = optvalue(i, 'text');
    if (!textVal) {
      await editOriginal(bot.applicationId, i.token, 'Usage: /task <title>');
      return;
    }
    await getDb().insert(taskTable).values({
      workspaceId: bot.workspaceId,
      title: textVal.slice(0, 200),
      status: 'inbox',
      kind: 'shallow',
      sourceApp: 'discord',
    });
    await editOriginal(bot.applicationId, i.token, `📝 Added to inbox: ${textVal.slice(0, 200)}`);
    return;
  }
  if (name === 'done') {
    const n = Number(optvalue(i, 'number').trim());
    if (!Number.isInteger(n) || n < 1) {
      await editOriginal(bot.applicationId, i.token, 'Usage: /done <number> (see /tasks)');
      return;
    }
    await editOriginal(bot.applicationId, i.token, await completeTaskByIndex(bot.workspaceId, n));
    return;
  }

  // Conductor-backed
  let prompt: string;
  let intent: 'chat' | 'agentic' = 'chat';
  if (name === 'ask') prompt = optvalue(i, 'q') || 'Hello';
  else if (name === 'do') {
    prompt = optvalue(i, 'action');
    intent = 'agentic';
  } else if (PROMPTS[name]) prompt = PROMPTS[name]!;
  else {
    await editOriginal(bot.applicationId, i.token, `Unknown command /${name}.`);
    return;
  }

  let result: Awaited<ReturnType<typeof runConductorTurn>>;
  try {
    result = await runConductorTurn({
      workspaceId: bot.workspaceId,
      userId: bot.connectedByUserId,
      text: prompt,
      channel: 'Discord',
      intent,
    });
  } catch (err) {
    log.error('discord.conductor.failed', { workspaceId: bot.workspaceId }, err);
    result = { text: 'Sorry — something went wrong.', pendingApprovals: [] };
  }
  const first = result.pendingApprovals[0];
  await editOriginal(
    bot.applicationId,
    i.token,
    result.text,
    first ? approveRejectRow(first.toolCallId) : undefined,
  );
}

/** Handle an inline button (component) interaction. Returns reply text. */
export async function processDiscordComponent(
  bot: DiscordBotRow,
  i: DiscordInteraction,
): Promise<string> {
  const discordUserId = interactionUserId(i);
  if (bot.allowedDiscordUserId && discordUserId !== bot.allowedDiscordUserId) {
    return 'Not authorized.';
  }
  const data = i.data?.custom_id ?? '';
  const [action, toolCallId] = data.split(':');
  if ((action === 'approve' || action === 'reject') && toolCallId) {
    const result = await applyApproval(bot.workspaceId, toolCallId, action === 'approve');
    return result.message;
  }
  return 'Done.';
}

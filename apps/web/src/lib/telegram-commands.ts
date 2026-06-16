/**
 * Telegram command processor for the BYO per-workspace bot.
 *
 * Maps inbound updates → actions. Content questions (/ask, /now, /today,
 * /goals, /blocked, /resume, and any plain text) are routed through the
 * Conductor so they answer from real workspace data. Utility commands
 * (/capture, /mute, /quiet, /status, /approve, /help) are handled directly.
 *
 * Access control: a bot is locked to a single Telegram user id on first
 * successful `/start <code>`. Every later update must come from that user.
 */
import 'server-only';
import { and, eq, gt } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { agentPolicy, telegramBot, telegramChatLink, telegramLinkCode } from '@metu/db/schema';
import { indexMemory } from '@metu/core/memory';
import { log } from '@metu/logger';
import { runConductorTurn } from '@/lib/conductor-turn';
import {
  sendMessage,
  sendChatAction,
  answerCallbackQuery,
  type InlineKeyboardButton,
} from '@metu/integrations/telegram/api';
import { resolvePendingApproval, applyApproval } from '@/lib/telegram-approvals';
import type { TelegramBotRow } from '@/lib/telegram-bot';
import { botToken } from '@/lib/telegram-bot';

export interface TgUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string; first_name?: string };
    chat: { id: number };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number };
    message?: { chat: { id: number }; message_id: number };
    data?: string;
  };
}

const HELP = [
  'METU Conductor — commands:',
  '/ask <q> — ask me anything',
  '/now — what to focus on now',
  '/today — today’s plan',
  '/capture <text> — save a note',
  '/goals — goal status',
  '/blocked — what’s blocked',
  '/resume — where you left off',
  '/quiet 22-8 — set quiet hours',
  '/mute 3h — pause proactive msgs',
  '/unmute — resume them',
  '/approve — approve latest action',
  '/status — connection status',
].join('\n');

function parse(text: string): { cmd: string | null; arg: string } {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return { cmd: null, arg: trimmed };
  const sp = trimmed.indexOf(' ');
  if (sp === -1) return { cmd: trimmed.slice(1).split('@')[0]!.toLowerCase(), arg: '' };
  return {
    cmd: trimmed.slice(1, sp).split('@')[0]!.toLowerCase(),
    arg: trimmed.slice(sp + 1).trim(),
  };
}

/** Claim a one-time link code and bind + lock the bot. Returns reply text. */
async function handleStart(
  bot: TelegramBotRow,
  chatId: string,
  fromId: string,
  fromName: string | undefined,
  code: string,
): Promise<string> {
  if (!code) return 'Send `/start <code>` using the code from the web app.';
  const db = getDb();
  const now = new Date();
  const [row] = await db
    .select()
    .from(telegramLinkCode)
    .where(
      and(
        eq(telegramLinkCode.code, code),
        eq(telegramLinkCode.workspaceId, bot.workspaceId),
        gt(telegramLinkCode.expiresAt, now),
      ),
    )
    .limit(1);
  if (!row) return 'That code is invalid or expired. Generate a fresh one in the web app.';

  await db
    .insert(telegramChatLink)
    .values({
      chatId,
      workspaceId: bot.workspaceId,
      personaSlug: row.personaSlug ?? 'metu',
      linkedByUserId: row.issuedByUserId,
      telegramUserId: fromId,
      fromUserName: fromName ?? null,
      lastInboundAt: now,
    })
    .onConflictDoUpdate({
      target: telegramChatLink.chatId,
      set: { telegramUserId: fromId, lastInboundAt: now, fromUserName: fromName ?? null },
    });

  await db.delete(telegramLinkCode).where(eq(telegramLinkCode.code, row.code));

  // Lock the bot to this Telegram user if not already locked.
  if (!bot.allowedTelegramUserId) {
    await db
      .update(telegramBot)
      .set({ allowedTelegramUserId: fromId })
      .where(eq(telegramBot.id, bot.id));
  }

  return '✅ Linked! You can now talk to your METU Conductor. Send /help to see commands.';
}

async function setQuietHours(workspaceId: string, arg: string): Promise<string> {
  // Accept "22-8" or "22:00-08:00".
  const m = arg.match(/^(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return 'Use /quiet 22-8 (or /quiet 22:00-08:00).';
  const pad = (h: string, mm?: string) => `${h.padStart(2, '0')}:${(mm ?? '00').padStart(2, '0')}`;
  const start = pad(m[1]!, m[2]);
  const end = pad(m[3]!, m[4]);
  await getDb()
    .update(agentPolicy)
    .set({ quietHours: { start, end } })
    .where(eq(agentPolicy.workspaceId, workspaceId));
  return `🌙 Quiet hours set: ${start}–${end}.`;
}

async function setMute(bot: TelegramBotRow, arg: string): Promise<string> {
  // "3h", "30m", "off"
  if (!arg || arg === 'off') {
    await getDb().update(telegramBot).set({ mutedUntil: null }).where(eq(telegramBot.id, bot.id));
    return '🔔 Proactive messages resumed.';
  }
  const m = arg.match(/^(\d+)\s*([hm])$/i);
  if (!m) return 'Use /mute 3h or /mute 30m (or /unmute).';
  const n = Number(m[1]);
  const ms = m[2]!.toLowerCase() === 'h' ? n * 3600_000 : n * 60_000;
  const until = new Date(Date.now() + ms);
  await getDb().update(telegramBot).set({ mutedUntil: until }).where(eq(telegramBot.id, bot.id));
  return `🔕 Muted proactive messages until ${until.toLocaleString()}.`;
}

/**
 * Process one inbound update. Returns nothing — replies are sent directly via
 * the Bot API so we can show typing indicators for slow Conductor turns.
 */
export async function processTelegramUpdate(bot: TelegramBotRow, update: TgUpdate): Promise<void> {
  const token = botToken(bot);

  // ── Callback queries (inline approve/reject buttons) ───────────────────
  if (update.callback_query) {
    const cq = update.callback_query;
    const fromId = String(cq.from.id);
    if (bot.allowedTelegramUserId && fromId !== bot.allowedTelegramUserId) {
      await answerCallbackQuery(token, cq.id, 'Not authorized.');
      return;
    }
    const data = cq.data ?? '';
    const [action, toolCallId] = data.split(':');
    if ((action === 'approve' || action === 'reject') && toolCallId) {
      const result = await applyApproval(bot.workspaceId, toolCallId, action === 'approve');
      await answerCallbackQuery(token, cq.id, result.message);
      if (cq.message) {
        await sendMessage(token, String(cq.message.chat.id), result.message);
      }
    } else {
      await answerCallbackQuery(token, cq.id);
    }
    return;
  }

  const msg = update.message;
  if (!msg) return;
  const chatId = String(msg.chat.id);
  const fromId = String(msg.from?.id ?? '');
  const fromName = msg.from?.username ?? msg.from?.first_name;
  const text = msg.text ?? '';
  const { cmd, arg } = parse(text);

  // ── /start <code> — linking (allowed before lock) ──────────────────────
  if (cmd === 'start') {
    const reply = await handleStart(bot, chatId, fromId, fromName, arg);
    await sendMessage(token, chatId, reply);
    return;
  }

  // ── Access control: bot locked to a single Telegram user ───────────────
  if (bot.allowedTelegramUserId && fromId !== bot.allowedTelegramUserId) {
    await sendMessage(token, chatId, 'This is a private METU bot. Access denied.');
    return;
  }

  // Must be linked to act on workspace data.
  const [link] = await getDb()
    .select({ chatId: telegramChatLink.chatId })
    .from(telegramChatLink)
    .where(eq(telegramChatLink.chatId, chatId))
    .limit(1);
  if (!link) {
    await sendMessage(
      token,
      chatId,
      'Not linked yet. Generate a code in the web app and send /start <code>.',
    );
    return;
  }

  await getDb()
    .update(telegramChatLink)
    .set({ lastInboundAt: new Date() })
    .where(eq(telegramChatLink.chatId, chatId));

  // ── Utility commands ───────────────────────────────────────────────────
  switch (cmd) {
    case 'help':
      await sendMessage(token, chatId, HELP);
      return;
    case 'status': {
      await sendMessage(
        token,
        chatId,
        `Connected as @${bot.botUsername ?? 'bot'}\nProactive: ${bot.outboundEnabled ? 'on' : 'off'} (${bot.sentToday}/${bot.dailyCap} today)\nTone: ${bot.tone}`,
      );
      return;
    }
    case 'capture': {
      if (!arg) {
        await sendMessage(token, chatId, 'Usage: /capture <text>');
        return;
      }
      await indexMemory({
        workspaceId: bot.workspaceId,
        sourceKind: 'capture',
        content: arg,
        metadata: { channel: 'telegram', chatId },
      });
      await sendMessage(token, chatId, '📥 Captured.');
      return;
    }
    case 'quiet':
      await sendMessage(token, chatId, await setQuietHours(bot.workspaceId, arg));
      return;
    case 'mute':
      await sendMessage(token, chatId, await setMute(bot, arg));
      return;
    case 'unmute':
      await sendMessage(token, chatId, await setMute(bot, 'off'));
      return;
    case 'approve': {
      const pending = await resolvePendingApproval(bot.workspaceId);
      if (!pending) {
        await sendMessage(token, chatId, 'Nothing pending approval.');
        return;
      }
      const result = await applyApproval(bot.workspaceId, pending.toolCallId, true);
      await sendMessage(token, chatId, result.message);
      return;
    }
  }

  // ── Conductor-backed: /ask, /now, /today, /goals, /blocked, /resume, plain
  const prompts: Record<string, string> = {
    now: 'What should I focus on right now? Be specific and brief.',
    today: "What's my plan for today and what are my open tasks?",
    goals: 'Give me a quick status of my goals and the next step for each.',
    blocked: "What's currently blocked and why? How do I unblock it?",
    resume: 'Where did I leave off? Summarize so I can resume quickly.',
  };
  let prompt: string;
  if (cmd === 'ask') prompt = arg || 'Hello';
  else if (cmd && prompts[cmd]) prompt = prompts[cmd];
  else if (!cmd)
    prompt = text; // plain text = chat
  else {
    await sendMessage(token, chatId, `Unknown command /${cmd}. Try /help.`);
    return;
  }

  await sendChatAction(token, chatId).catch(() => {});
  let reply: string;
  try {
    reply = await runConductorTurn({
      workspaceId: bot.workspaceId,
      userId: bot.connectedByUserId,
      text: prompt,
      channel: 'Telegram',
    });
  } catch (err) {
    log.error('telegram.conductor.failed', { workspaceId: bot.workspaceId }, err);
    reply = 'Sorry — something went wrong. Try again.';
  }
  // Telegram hard-caps messages at 4096 chars.
  await sendMessage(token, chatId, reply.slice(0, 4000));
}

export type { InlineKeyboardButton };

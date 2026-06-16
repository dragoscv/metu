/**
 * BYO Telegram bot management — server-only helpers.
 *
 * One bot per workspace. The BotFather token is sealed (AES-256-GCM) at rest
 * and only opened in-process to call the Bot API. Inbound updates are routed
 * by a random `webhookId` in the path (never the token) and authenticated by
 * the `secretToken` Telegram echoes in `X-Telegram-Bot-Api-Secret-Token`.
 */
import 'server-only';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { telegramBot } from '@metu/db/schema';
import { seal, open, type Sealed } from '@metu/ai/crypto';
import {
  getMe,
  setWebhook,
  deleteWebhook,
  setMyCommands,
  sendMessage,
  type SendMessageOptions,
  type BotCommand,
} from '@metu/integrations/telegram/api';
import { telegramChatLink } from '@metu/db/schema';

export type TelegramBotRow = typeof telegramBot.$inferSelect;

/** The command menu published to Telegram (the "/" button). */
export const BOT_COMMANDS: BotCommand[] = [
  { command: 'ask', description: 'Ask the METU Conductor anything' },
  { command: 'do', description: 'Have METU take an action (agentic)' },
  { command: 'now', description: 'What should I focus on right now' },
  { command: 'today', description: "Today's plan & open tasks" },
  { command: 'capture', description: 'Capture a note or idea to METU' },
  { command: 'goals', description: 'Goal status & next steps' },
  { command: 'blocked', description: "What's blocked and why" },
  { command: 'resume', description: 'Where did I leave off' },
  { command: 'autopilot', description: 'Let METU act autonomously (on/off/3h)' },
  { command: 'quiet', description: 'Set quiet hours (e.g. /quiet 22-8)' },
  { command: 'mute', description: 'Pause proactive messages (e.g. /mute 3h)' },
  { command: 'unmute', description: 'Resume proactive messages' },
  { command: 'approve', description: 'Approve the latest pending action' },
  { command: 'status', description: 'Connection & workspace status' },
  { command: 'help', description: 'Show available commands' },
];

function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'https://metu.ro';
}

export function webhookUrlFor(webhookId: string): string {
  return `${appBaseUrl()}/api/webhooks/telegram/${webhookId}`;
}

/** Open the sealed token for a bot row. */
export function botToken(row: TelegramBotRow): string {
  const sealed: Sealed = {
    ciphertext: row.tokenCiphertext,
    iv: row.tokenIv,
    tag: row.tokenTag,
  };
  return open(sealed);
}

/** Resolve a workspace's bot, or null. */
export async function getBotForWorkspace(workspaceId: string): Promise<TelegramBotRow | null> {
  const [row] = await getDb()
    .select()
    .from(telegramBot)
    .where(eq(telegramBot.workspaceId, workspaceId))
    .limit(1);
  return row ?? null;
}

/** Resolve a bot by its webhook id (inbound routing). */
export async function getBotByWebhookId(webhookId: string): Promise<TelegramBotRow | null> {
  const [row] = await getDb()
    .select()
    .from(telegramBot)
    .where(eq(telegramBot.webhookId, webhookId))
    .limit(1);
  return row ?? null;
}

export interface ConnectResult {
  ok: boolean;
  botUsername?: string;
  error?: string;
}

/**
 * Validate a BotFather token, seal it, register the webhook + command menu,
 * and upsert the per-workspace bot row. Idempotent: re-connecting replaces
 * the token + rotates the webhook id and secret.
 */
export async function connectTelegramBot(
  workspaceId: string,
  userId: string,
  rawToken: string,
): Promise<ConnectResult> {
  const token = rawToken.trim();
  // Telegram tokens look like `123456:ABC-...`. Validate via getMe.
  let info;
  try {
    info = await getMe(token);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid token' };
  }

  const webhookId = randomBytes(18).toString('hex');
  const secretToken = randomBytes(24).toString('hex');
  const sealed = seal(token);
  const db = getDb();

  const existing = await getBotForWorkspace(workspaceId);

  try {
    await setWebhook(token, webhookUrlFor(webhookId), secretToken);
    await setMyCommands(token, BOT_COMMANDS);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to register webhook',
    };
  }

  const values = {
    workspaceId,
    webhookId,
    tokenCiphertext: sealed.ciphertext,
    tokenIv: sealed.iv,
    tokenTag: sealed.tag,
    secretToken,
    botUsername: info.username ?? null,
    botId: String(info.id),
    connectedByUserId: userId,
    status: 'active' as const,
    lastError: null,
  };

  if (existing) {
    await db.update(telegramBot).set(values).where(eq(telegramBot.id, existing.id));
  } else {
    await db.insert(telegramBot).values(values);
  }

  return { ok: true, botUsername: info.username ?? undefined };
}

/** Remove the webhook and delete the bot row. */
export async function disconnectTelegramBot(workspaceId: string): Promise<void> {
  const row = await getBotForWorkspace(workspaceId);
  if (!row) return;
  try {
    await deleteWebhook(botToken(row));
  } catch {
    // best-effort — still delete the row
  }
  await getDb().delete(telegramBot).where(eq(telegramBot.id, row.id));
}

/** Send a message using a workspace's BYO bot. Returns false if no bot/error. */
export async function sendViaWorkspaceBot(
  workspaceId: string,
  chatId: string,
  text: string,
  opts?: SendMessageOptions,
): Promise<boolean> {
  const row = await getBotForWorkspace(workspaceId);
  if (!row || row.status !== 'active') return false;
  try {
    await sendMessage(botToken(row), chatId, text, opts);
    return true;
  } catch {
    return false;
  }
}

function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export interface DeliverTelegramInput {
  workspaceId: string;
  title: string;
  body?: string;
  actionUrl?: string;
  urgency?: 'low' | 'normal' | 'high' | 'critical';
  /** Pending-approval style actions → inline buttons. */
  actions?: { id: string; label: string; kind: string }[];
  /** toolCallId to bind approve/reject buttons to, if any. */
  toolCallId?: string;
  /** When true, bypass cap/gap (e.g. critical alerts, direct replies). */
  bypassCaps?: boolean;
}

/**
 * Proactive Telegram delivery with guardrails. Enforces the bot's outbound
 * switch, mutedUntil, per-day cap and min spacing, then sends and bumps the
 * rolling counters. Returns true if a message was sent.
 */
export async function deliverTelegram(input: DeliverTelegramInput): Promise<boolean> {
  const db = getDb();
  const row = await getBotForWorkspace(input.workspaceId);
  if (!row || row.status !== 'active') return false;
  if (!row.allowedTelegramUserId) return false; // not bound yet

  const critical = input.urgency === 'critical';
  const bypass = input.bypassCaps || critical;

  if (!bypass) {
    if (!row.outboundEnabled) return false;
    if (row.mutedUntil && row.mutedUntil.getTime() > Date.now()) return false;
    // Daily cap (rolling UTC day).
    const today = utcDayKey();
    const sentToday = row.sentTodayDate === today ? row.sentToday : 0;
    if (row.dailyCap > 0 && sentToday >= row.dailyCap) return false;
    // Min gap.
    if (
      row.minGapMinutes > 0 &&
      row.lastProactiveAt &&
      Date.now() - row.lastProactiveAt.getTime() < row.minGapMinutes * 60_000
    ) {
      return false;
    }
  }

  // Find the linked chat for this workspace.
  const [link] = await db
    .select({ chatId: telegramChatLink.chatId })
    .from(telegramChatLink)
    .where(eq(telegramChatLink.workspaceId, input.workspaceId))
    .limit(1);
  if (!link) return false;

  const text = input.body ? `*${input.title}*\n${input.body}` : `*${input.title}*`;
  const inlineKeyboard =
    input.toolCallId && input.actions?.some((a) => a.kind === 'approve')
      ? [
          [
            { text: '✅ Approve', callback_data: `approve:${input.toolCallId}` },
            { text: '🚫 Reject', callback_data: `reject:${input.toolCallId}` },
          ],
        ]
      : undefined;

  try {
    await sendMessage(botToken(row), link.chatId, text, {
      parseMode: 'Markdown',
      disableNotification: input.urgency === 'low',
      inlineKeyboard,
    });
  } catch {
    return false;
  }

  // Bump counters (best-effort).
  const today = utcDayKey();
  const sentToday = row.sentTodayDate === today ? row.sentToday : 0;
  await db
    .update(telegramBot)
    .set({
      sentToday: sentToday + 1,
      sentTodayDate: today,
      lastProactiveAt: new Date(),
    })
    .where(eq(telegramBot.id, row.id));
  return true;
}

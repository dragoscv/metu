/**
 * BYO Discord bot management — server-only.
 *
 * Mirrors telegram-bot.ts: one bot per workspace, sealed token, slash command
 * menu, single-user lock, guardrailed proactive DM delivery.
 */
import 'server-only';
import { eq } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { discordBot } from '@metu/db/schema';
import { seal, open, type Sealed } from '@metu/ai/crypto';
import {
  getCurrentUser,
  registerGlobalCommands,
  createDM,
  sendChannelMessage,
  approveRejectRow,
  type DiscordCommand,
} from '@metu/integrations/discord/api';

export type DiscordBotRow = typeof discordBot.$inferSelect;

export const DISCORD_COMMANDS: DiscordCommand[] = [
  { name: 'ask', description: 'Ask the METU Conductor', type: 1, options: [{ name: 'q', description: 'Your question', type: 3, required: true }] },
  { name: 'do', description: 'Have METU take an action', type: 1, options: [{ name: 'action', description: 'What to do', type: 3, required: true }] },
  { name: 'now', description: 'What to focus on right now', type: 1 },
  { name: 'today', description: "Today's plan & open tasks", type: 1 },
  { name: 'capture', description: 'Capture a note', type: 1, options: [{ name: 'text', description: 'Note text', type: 3, required: true }] },
  { name: 'goals', description: 'Goal status & next steps', type: 1 },
  { name: 'blocked', description: "What's blocked and why", type: 1 },
  { name: 'resume', description: 'Where did I leave off', type: 1 },
  { name: 'autopilot', description: 'Autonomy on/off/3h', type: 1, options: [{ name: 'mode', description: 'on | off | 3h', type: 3, required: false }] },
  { name: 'link', description: 'Bind your account with a code', type: 1, options: [{ name: 'code', description: 'Code from the web app', type: 3, required: true }] },
  { name: 'status', description: 'Connection status', type: 1 },
  { name: 'help', description: 'Show commands', type: 1 },
];

export function botToken(row: DiscordBotRow): string {
  const sealed: Sealed = {
    ciphertext: row.tokenCiphertext,
    iv: row.tokenIv,
    tag: row.tokenTag,
  };
  return open(sealed);
}

export async function getDiscordBotForWorkspace(
  workspaceId: string,
): Promise<DiscordBotRow | null> {
  const [row] = await getDb()
    .select()
    .from(discordBot)
    .where(eq(discordBot.workspaceId, workspaceId))
    .limit(1);
  return row ?? null;
}

export async function getDiscordBotByApplicationId(
  applicationId: string,
): Promise<DiscordBotRow | null> {
  const [row] = await getDb()
    .select()
    .from(discordBot)
    .where(eq(discordBot.applicationId, applicationId))
    .limit(1);
  return row ?? null;
}

export interface ConnectResult {
  ok: boolean;
  botUsername?: string;
  error?: string;
}

export async function connectDiscordBot(
  workspaceId: string,
  userId: string,
  rawToken: string,
  applicationId: string,
  publicKey: string,
): Promise<ConnectResult> {
  const token = rawToken.trim();
  let info;
  try {
    info = await getCurrentUser(token);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid token' };
  }

  try {
    await registerGlobalCommands(token, applicationId.trim(), DISCORD_COMMANDS);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to register commands',
    };
  }

  const sealed = seal(token);
  const db = getDb();
  const existing = await getDiscordBotForWorkspace(workspaceId);
  const values = {
    workspaceId,
    applicationId: applicationId.trim(),
    publicKey: publicKey.trim(),
    tokenCiphertext: sealed.ciphertext,
    tokenIv: sealed.iv,
    tokenTag: sealed.tag,
    botUsername: info.username ?? null,
    botId: info.id,
    connectedByUserId: userId,
    status: 'active' as const,
    lastError: null,
  };
  if (existing) {
    await db.update(discordBot).set(values).where(eq(discordBot.id, existing.id));
  } else {
    await db.insert(discordBot).values(values);
  }
  return { ok: true, botUsername: info.username ?? undefined };
}

export async function disconnectDiscordBot(workspaceId: string): Promise<void> {
  await getDb().delete(discordBot).where(eq(discordBot.workspaceId, workspaceId));
}

function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export interface DeliverDiscordInput {
  workspaceId: string;
  title: string;
  body?: string;
  urgency?: 'low' | 'normal' | 'high' | 'critical';
  toolCallId?: string;
  bypassCaps?: boolean;
}

/** Guardrailed proactive Discord DM. Returns true if sent. */
export async function deliverDiscord(input: DeliverDiscordInput): Promise<boolean> {
  const db = getDb();
  const row = await getDiscordBotForWorkspace(input.workspaceId);
  if (!row || row.status !== 'active') return false;
  if (!row.allowedDiscordUserId) return false;

  const bypass = input.bypassCaps || input.urgency === 'critical';
  if (!bypass) {
    if (!row.outboundEnabled) return false;
    if (row.mutedUntil && row.mutedUntil.getTime() > Date.now()) return false;
    const today = utcDayKey();
    const sentToday = row.sentTodayDate === today ? row.sentToday : 0;
    if (row.dailyCap > 0 && sentToday >= row.dailyCap) return false;
    if (
      row.minGapMinutes > 0 &&
      row.lastProactiveAt &&
      Date.now() - row.lastProactiveAt.getTime() < row.minGapMinutes * 60_000
    ) {
      return false;
    }
  }

  const token = botToken(row);
  let channelId = row.dmChannelId;
  try {
    if (!channelId) {
      channelId = await createDM(token, row.allowedDiscordUserId);
      await db.update(discordBot).set({ dmChannelId: channelId }).where(eq(discordBot.id, row.id));
    }
    const content = input.body ? `**${input.title}**\n${input.body}` : `**${input.title}**`;
    const components =
      input.toolCallId ? approveRejectRow(input.toolCallId) : undefined;
    await sendChannelMessage(token, channelId, content, components);
  } catch {
    return false;
  }

  const today = utcDayKey();
  const sentToday = row.sentTodayDate === today ? row.sentToday : 0;
  await db
    .update(discordBot)
    .set({ sentToday: sentToday + 1, sentTodayDate: today, lastProactiveAt: new Date() })
    .where(eq(discordBot.id, row.id));
  return true;
}

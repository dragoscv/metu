'use server';
/**
 * BYO Telegram bot — connect / disconnect / status / preferences.
 *
 * The user creates a bot via @BotFather, pastes the token here. We validate
 * it, seal it, register a per-bot webhook, and publish the command menu.
 * Only the workspace owner can manage the bot. The token is never returned.
 */
import { auth } from '@metu/auth';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@metu/db';
import { telegramBot } from '@metu/db/schema';
import { connectTelegramBot, disconnectTelegramBot, getBotForWorkspace } from '@/lib/telegram-bot';

const TokenSchema = z
  .string()
  .trim()
  .regex(/^\d{6,12}:[A-Za-z0-9_-]{30,}$/, 'That does not look like a BotFather token');

const ToneSchema = z.enum(['chief_of_staff', 'minimal', 'friendly']);

const PrefsSchema = z.object({
  outboundEnabled: z.boolean().optional(),
  tone: ToneSchema.optional(),
  dailyCap: z.number().int().min(0).max(50).optional(),
  minGapMinutes: z.number().int().min(0).max(1440).optional(),
});

export interface TelegramBotStatus {
  connected: boolean;
  botUsername: string | null;
  locked: boolean;
  outboundEnabled: boolean;
  tone: string;
  dailyCap: number;
  minGapMinutes: number;
  sentToday: number;
  status: string;
  lastError: string | null;
}

export async function getTelegramBotStatusAction(): Promise<TelegramBotStatus> {
  const session = await auth();
  if (!session) throw new Error('unauthorized');
  const row = await getBotForWorkspace(session.user.workspaceId);
  if (!row) {
    return {
      connected: false,
      botUsername: null,
      locked: false,
      outboundEnabled: false,
      tone: 'chief_of_staff',
      dailyCap: 5,
      minGapMinutes: 90,
      sentToday: 0,
      status: 'disconnected',
      lastError: null,
    };
  }
  return {
    connected: true,
    botUsername: row.botUsername,
    locked: !!row.allowedTelegramUserId,
    outboundEnabled: row.outboundEnabled,
    tone: row.tone,
    dailyCap: row.dailyCap,
    minGapMinutes: row.minGapMinutes,
    sentToday: row.sentToday,
    status: row.status,
    lastError: row.lastError,
  };
}

export async function connectTelegramBotAction(
  rawToken: string,
): Promise<{ ok: boolean; botUsername?: string; error?: string }> {
  const session = await auth();
  if (!session) throw new Error('unauthorized');
  const parsed = TokenSchema.safeParse(rawToken);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid token' };
  }
  const res = await connectTelegramBot(session.user.workspaceId, session.user.id, parsed.data);
  revalidatePath('/settings/integrations/telegram');
  return res;
}

export async function disconnectTelegramBotAction(): Promise<{ ok: true }> {
  const session = await auth();
  if (!session) throw new Error('unauthorized');
  await disconnectTelegramBot(session.user.workspaceId);
  revalidatePath('/settings/integrations/telegram');
  return { ok: true };
}

export async function updateTelegramBotPrefsAction(
  input: z.infer<typeof PrefsSchema>,
): Promise<{ ok: true }> {
  const session = await auth();
  if (!session) throw new Error('unauthorized');
  const parsed = PrefsSchema.safeParse(input);
  if (!parsed.success) throw new Error('invalid_input');
  const row = await getBotForWorkspace(session.user.workspaceId);
  if (!row) throw new Error('not_connected');
  await getDb().update(telegramBot).set(parsed.data).where(eq(telegramBot.id, row.id));
  revalidatePath('/settings/integrations/telegram');
  return { ok: true };
}

'use server';
/**
 * BYO Discord bot — connect / disconnect / status / preferences.
 */
import { auth } from '@metu/auth';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@metu/db';
import { discordBot } from '@metu/db/schema';
import {
  connectDiscordBot,
  disconnectDiscordBot,
  getDiscordBotForWorkspace,
} from '@/lib/discord-bot';

const ConnectSchema = z.object({
  token: z.string().trim().min(40, 'Bot token looks too short'),
  applicationId: z.string().trim().regex(/^\d{15,25}$/, 'Application ID must be numeric'),
  publicKey: z.string().trim().regex(/^[a-f0-9]{64}$/i, 'Public key must be 64 hex chars'),
});

const ToneSchema = z.enum(['chief_of_staff', 'minimal', 'friendly']);
const PrefsSchema = z.object({
  outboundEnabled: z.boolean().optional(),
  tone: ToneSchema.optional(),
  dailyCap: z.number().int().min(0).max(50).optional(),
  minGapMinutes: z.number().int().min(0).max(1440).optional(),
});

export interface DiscordBotStatus {
  connected: boolean;
  botUsername: string | null;
  locked: boolean;
  outboundEnabled: boolean;
  tone: string;
  dailyCap: number;
  minGapMinutes: number;
  status: string;
  lastError: string | null;
}

export async function getDiscordBotStatusAction(): Promise<DiscordBotStatus> {
  const session = await auth();
  if (!session) throw new Error('unauthorized');
  const row = await getDiscordBotForWorkspace(session.user.workspaceId);
  if (!row) {
    return {
      connected: false,
      botUsername: null,
      locked: false,
      outboundEnabled: false,
      tone: 'chief_of_staff',
      dailyCap: 5,
      minGapMinutes: 90,
      status: 'disconnected',
      lastError: null,
    };
  }
  return {
    connected: true,
    botUsername: row.botUsername,
    locked: !!row.allowedDiscordUserId,
    outboundEnabled: row.outboundEnabled,
    tone: row.tone,
    dailyCap: row.dailyCap,
    minGapMinutes: row.minGapMinutes,
    status: row.status,
    lastError: row.lastError,
  };
}

export async function connectDiscordBotAction(input: {
  token: string;
  applicationId: string;
  publicKey: string;
}): Promise<{ ok: boolean; botUsername?: string; error?: string }> {
  const session = await auth();
  if (!session) throw new Error('unauthorized');
  const parsed = ConnectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const res = await connectDiscordBot(
    session.user.workspaceId,
    session.user.id,
    parsed.data.token,
    parsed.data.applicationId,
    parsed.data.publicKey,
  );
  revalidatePath('/settings/integrations/discord');
  return res;
}

export async function disconnectDiscordBotAction(): Promise<{ ok: true }> {
  const session = await auth();
  if (!session) throw new Error('unauthorized');
  await disconnectDiscordBot(session.user.workspaceId);
  revalidatePath('/settings/integrations/discord');
  return { ok: true };
}

export async function updateDiscordBotPrefsAction(
  input: z.infer<typeof PrefsSchema>,
): Promise<{ ok: true }> {
  const session = await auth();
  if (!session) throw new Error('unauthorized');
  const parsed = PrefsSchema.safeParse(input);
  if (!parsed.success) throw new Error('invalid_input');
  const row = await getDiscordBotForWorkspace(session.user.workspaceId);
  if (!row) throw new Error('not_connected');
  await getDb().update(discordBot).set(parsed.data).where(eq(discordBot.id, row.id));
  revalidatePath('/settings/integrations/discord');
  return { ok: true };
}

'use server';
/**
 * Telegram link-code lifecycle.
 *
 * `issueTelegramLinkCodeAction()` mints a 6-digit numeric code that
 * expires in 15 minutes. The user reads it from /settings/integrations/telegram
 * and types `/start <code>` into the bot. The webhook claims the code by
 * calling `claimTelegramLinkCode()` (also exported here for server use).
 *
 * Codes are single-use — the row is deleted on consumption.
 */
import { auth } from '@metu/auth';
import { revalidatePath } from 'next/cache';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@metu/db';
import { telegramChatLink, telegramLinkCode } from '@metu/db/schema';

const TTL_MS = 15 * 60 * 1000;

const PersonaSlugSchema = z.string().min(1);
const ChatIdSchema = z.string().min(1);
const LinkCodeSchema = z.string().min(1);

function gen6(): string {
  // Avoid Math.random for tokens — but a 6-digit code is for typing convenience,
  // not security. Combined with a 15-minute window + workspace scoping it
  // gives ~16k codes/window/workspace which is fine for one-shot binding.
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(arr[0]! % 1_000_000).padStart(6, '0');
}

export async function issueTelegramLinkCodeAction(personaSlug = 'metu'): Promise<{
  ok: true;
  code: string;
  expiresAt: string;
}> {
  const parsed = PersonaSlugSchema.safeParse(personaSlug);
  if (!parsed.success) throw new Error('invalid_input');
  personaSlug = parsed.data;
  const session = await auth();
  if (!session) throw new Error('unauthorized');
  const db = getDb();
  const code = gen6();
  const expiresAt = new Date(Date.now() + TTL_MS);
  await db.insert(telegramLinkCode).values({
    code,
    workspaceId: session.user.workspaceId,
    issuedByUserId: session.user.id,
    personaSlug,
    expiresAt,
  });
  revalidatePath('/settings/integrations/telegram');
  return { ok: true, code, expiresAt: expiresAt.toISOString() };
}

export async function listTelegramLinksAction(): Promise<
  {
    chatId: string;
    personaSlug: string;
    fromUserName: string | null;
    lastInboundAt: string | null;
  }[]
> {
  const session = await auth();
  if (!session) throw new Error('unauthorized');
  const db = getDb();
  const rows = await db
    .select({
      chatId: telegramChatLink.chatId,
      personaSlug: telegramChatLink.personaSlug,
      fromUserName: telegramChatLink.fromUserName,
      lastInboundAt: telegramChatLink.lastInboundAt,
    })
    .from(telegramChatLink)
    .where(eq(telegramChatLink.workspaceId, session.user.workspaceId));
  return rows.map((r) => ({
    chatId: r.chatId,
    personaSlug: r.personaSlug,
    fromUserName: r.fromUserName,
    lastInboundAt: r.lastInboundAt?.toISOString() ?? null,
  }));
}

export async function unlinkTelegramChatAction(chatId: string): Promise<{ ok: true }> {
  const parsed = ChatIdSchema.safeParse(chatId);
  if (!parsed.success) throw new Error('invalid_input');
  chatId = parsed.data;
  const session = await auth();
  if (!session) throw new Error('unauthorized');
  const db = getDb();
  await db
    .delete(telegramChatLink)
    .where(
      and(
        eq(telegramChatLink.chatId, chatId),
        eq(telegramChatLink.workspaceId, session.user.workspaceId),
      ),
    );
  revalidatePath('/settings/integrations/telegram');
  return { ok: true };
}

/**
 * Server-side: consume a code on behalf of the Telegram bot. Returns the
 * resolved workspace + persona, or null if the code is unknown / expired.
 * Atomic via DELETE … RETURNING so a code can only be claimed once.
 */
export async function claimTelegramLinkCode(code: string): Promise<{
  workspaceId: string;
  issuedByUserId: string;
  personaSlug: string;
} | null> {
  const parsed = LinkCodeSchema.safeParse(code);
  if (!parsed.success) return null;
  code = parsed.data;
  const db = getDb();
  // Drop any stale codes opportunistically — keeps the table small.
  await db.delete(telegramLinkCode).where(lt(telegramLinkCode.expiresAt, sql`now()`));
  const claimed = await db
    .delete(telegramLinkCode)
    .where(and(eq(telegramLinkCode.code, code), gt(telegramLinkCode.expiresAt, sql`now()`)))
    .returning();
  const row = claimed[0];
  if (!row) return null;
  return {
    workspaceId: row.workspaceId,
    issuedByUserId: row.issuedByUserId,
    personaSlug: row.personaSlug,
  };
}

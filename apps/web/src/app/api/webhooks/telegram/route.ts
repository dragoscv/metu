/**
 * Telegram bot webhook — minimal triage.
 *
 * Setup:
 *   1. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`.
 *   2. Register the webhook with Telegram:
 *        curl -X POST "https://api.telegram.org/bot$TOKEN/setWebhook" \
 *          -d url=https://app.metu.ro/api/webhooks/telegram \
 *          -d secret_token=$SECRET
 *
 * Behavior per inbound message:
 *   - `/start <code>`  → consume `telegram_link_code`, create
 *     `telegram_chat_link`, reply confirmation.
 *   - `/capture <text>` (or any plain text on a linked chat) →
 *     `indexMemory({ sourceKind: 'capture' })`, reply 👍.
 *   - `/recall <query>` → top-5 hits as a numbered list.
 *   - Unlinked chats get onboarding instructions only.
 *
 * Voice / photo are intentionally deferred — they need the worker.
 */
import { NextResponse } from 'next/server';
import { and, eq, gt, sql } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { telegramChatLink, telegramLinkCode } from '@metu/db/schema';
import { indexMemory, recall } from '@metu/core/memory';
import { telegram } from '@metu/integrations';
import { safeEqual } from '@/lib/safe-equal';
import { log } from '@metu/logger';

interface TelegramMessage {
  message_id: number;
  from?: { id: number; username?: string; first_name?: string };
  chat: { id: number };
  text?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export async function POST(req: Request) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 });
  const got = req.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!safeEqual(got, expected)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const update = (await req.json().catch(() => null)) as TelegramUpdate | null;
  const msg = update?.message;
  if (!msg || !msg.text) return NextResponse.json({ ok: true });

  const chatId = String(msg.chat.id);
  const text = msg.text.trim();
  const db = getDb();

  try {
    if (text.startsWith('/start')) {
      const code = text.slice('/start'.length).trim();
      if (!code) {
        await telegram.sendTextMessage(
          chatId,
          'Open metu → Settings → Integrations → Telegram, generate a code, then send /start <code>.',
        );
        return NextResponse.json({ ok: true });
      }
      const [row] = await db
        .select()
        .from(telegramLinkCode)
        .where(and(eq(telegramLinkCode.code, code), gt(telegramLinkCode.expiresAt, new Date())))
        .limit(1);
      if (!row) {
        await telegram.sendTextMessage(chatId, 'Code expired or invalid. Generate a new one.');
        return NextResponse.json({ ok: true });
      }
      await db
        .insert(telegramChatLink)
        .values({
          chatId,
          workspaceId: row.workspaceId,
          personaSlug: row.personaSlug,
          linkedByUserId: row.issuedByUserId,
          fromUserName: msg.from?.username ?? msg.from?.first_name ?? null,
          lastInboundAt: sql`now()`,
        })
        .onConflictDoUpdate({
          target: telegramChatLink.chatId,
          set: {
            workspaceId: row.workspaceId,
            personaSlug: row.personaSlug,
            lastInboundAt: sql`now()`,
          },
        });
      await db.delete(telegramLinkCode).where(eq(telegramLinkCode.code, code));
      await telegram.sendTextMessage(
        chatId,
        'Linked. Send anything to capture, or /recall <query>.',
      );
      return NextResponse.json({ ok: true });
    }

    const [link] = await db
      .select()
      .from(telegramChatLink)
      .where(eq(telegramChatLink.chatId, chatId))
      .limit(1);
    if (!link) {
      await telegram.sendTextMessage(
        chatId,
        'This chat is not linked yet. Open metu → Settings → Integrations → Telegram and send /start <code>.',
      );
      return NextResponse.json({ ok: true });
    }

    if (text.startsWith('/recall')) {
      const q = text.slice('/recall'.length).trim();
      if (!q) {
        await telegram.sendTextMessage(chatId, 'Usage: /recall <query>');
        return NextResponse.json({ ok: true });
      }
      const result = await recall({ workspaceId: link.workspaceId, query: q, limit: 5 });
      const rows =
        ((result as { rows?: Array<{ content: string }> }).rows as
          | Array<{ content: string }>
          | undefined) ?? [];
      if (rows.length === 0) {
        await telegram.sendTextMessage(chatId, 'No matches.');
      } else {
        const body = rows
          .map((r, i) => `${i + 1}. ${r.content.slice(0, 240).replace(/\s+/g, ' ')}`)
          .join('\n\n');
        await telegram.sendTextMessage(chatId, body);
      }
      await db
        .update(telegramChatLink)
        .set({ lastInboundAt: sql`now()` })
        .where(eq(telegramChatLink.chatId, chatId));
      return NextResponse.json({ ok: true });
    }

    // /capture or implicit capture.
    const body = text.startsWith('/capture') ? text.slice('/capture'.length).trim() : text;
    if (!body) {
      await telegram.sendTextMessage(chatId, 'Usage: /capture <text>');
      return NextResponse.json({ ok: true });
    }
    await indexMemory({
      workspaceId: link.workspaceId,
      sourceKind: 'capture',
      content: body,
      metadata: { source: 'telegram', chatId, fromUserName: msg.from?.username ?? null },
    });
    await db
      .update(telegramChatLink)
      .set({ lastInboundAt: sql`now()` })
      .where(eq(telegramChatLink.chatId, chatId));
    await telegram.sendTextMessage(chatId, '👍 Captured.');
    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error('telegram.webhook.failed', { chatId }, err);
    // Always 200 so Telegram doesn't spam-retry; we logged it.
    return NextResponse.json({ ok: false });
  }
}

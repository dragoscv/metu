/**
 * Per-workspace BYO Telegram bot webhook.
 *
 * Telegram delivers updates to /api/webhooks/telegram/<webhookId>. We resolve
 * the bot by `webhookId`, verify the `X-Telegram-Bot-Api-Secret-Token` header
 * (timing-safe) against the stored secret, then dispatch the update.
 *
 * Always returns 200 quickly so Telegram doesn't retry — failures are logged.
 */
import { NextResponse } from 'next/server';
import { log } from '@metu/logger';
import { safeEqual } from '@/lib/safe-equal';
import { getBotByWebhookId } from '@/lib/telegram-bot';
import { processTelegramUpdate, type TgUpdate } from '@/lib/telegram-commands';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ webhookId: string }> },
): Promise<NextResponse> {
  const { webhookId } = await params;

  const bot = await getBotByWebhookId(webhookId);
  if (!bot) {
    // Unknown webhook id — don't leak existence.
    return NextResponse.json({ ok: true });
  }

  const provided = req.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!safeEqual(provided, bot.secretToken)) {
    log.warn('telegram.webhook.bad_secret', { webhookId });
    return NextResponse.json({ ok: true });
  }

  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  try {
    await processTelegramUpdate(bot, update);
  } catch (err) {
    log.error('telegram.webhook.process_failed', { webhookId }, err);
  }

  return NextResponse.json({ ok: true });
}

import { NextResponse } from 'next/server';
import { safeEqual } from '@/lib/safe-equal';

export const runtime = 'nodejs';

/**
 * Telegram inbound webhook. We use a long secret in the URL itself
 * (configured via setWebhook) — Telegram does not sign payloads.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const expected = process.env.TELEGRAM_BOT_TOKEN?.replace(/[^a-zA-Z0-9]/g, '');
  const provided = url.pathname.split('/').pop();
  if (!expected || !safeEqual(provided, expected)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const update = await req.json();
  // TODO: convert to capture event via @metu/integrations/telegram + actions/capture
  console.info('[telegram webhook]', update?.message?.text?.slice(0, 80));
  return NextResponse.json({ ok: true });
}

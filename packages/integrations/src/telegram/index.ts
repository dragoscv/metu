/**
 * Telegram bot — receives inbound messages → captures.
 * Bot is webhook-mode; the route handler at apps/web/app/api/webhooks/telegram
 * uses this `handleUpdate` to convert into capture events.
 */
import { Telegraf, type Context } from 'telegraf';

let _bot: Telegraf | undefined;

export function bot() {
  if (_bot) return _bot;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set');
  _bot = new Telegraf(token);
  return _bot;
}

export interface TelegramCapturePayload {
  externalChatId: string;
  text?: string;
  voiceFileId?: string;
  photoFileId?: string;
  fromUserName?: string;
}

export function extractCapture(ctx: Context): TelegramCapturePayload | null {
  const msg = ctx.message;
  if (!msg) return null;
  const externalChatId = String(msg.chat.id);
  const fromUserName = msg.from?.username ?? msg.from?.first_name;
  if ('text' in msg) return { externalChatId, text: msg.text, fromUserName };
  if ('voice' in msg && msg.voice)
    return { externalChatId, voiceFileId: msg.voice.file_id, fromUserName };
  if ('photo' in msg && msg.photo?.length) {
    const largest = msg.photo[msg.photo.length - 1]!;
    return { externalChatId, photoFileId: largest.file_id, fromUserName };
  }
  return null;
}

export async function getFileLink(fileId: string) {
  return bot().telegram.getFileLink(fileId);
}

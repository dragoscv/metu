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
  caption?: string;
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
    const caption = 'caption' in msg && typeof msg.caption === 'string' ? msg.caption : undefined;
    return { externalChatId, photoFileId: largest.file_id, caption, fromUserName };
  }
  return null;
}

export async function getFileLink(fileId: string) {
  return bot().telegram.getFileLink(fileId);
}

/**
 * Send a plain-text message to a Telegram chat. Returns the Telegram
 * message id on success — used by the agent tool to support deletion
 * via `bot().telegram.deleteMessage(chatId, messageId)` if we ever
 * choose to make the action undoable.
 *
 * Throws if `TELEGRAM_BOT_TOKEN` is missing or the Telegram API errors
 * out — callers should let the rejection propagate so the tool_call
 * row records the failure.
 */
export async function sendTextMessage(
  chatId: string,
  text: string,
  opts?: { parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML'; disableNotification?: boolean },
): Promise<number> {
  const res = await bot().telegram.sendMessage(chatId, text, {
    parse_mode: opts?.parseMode,
    disable_notification: opts?.disableNotification,
  });
  return res.message_id;
}

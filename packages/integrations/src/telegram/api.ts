/**
 * Raw Telegram Bot API client — token-based, no global state.
 *
 * Unlike `index.ts` (which wraps a single global telegraf bot from the
 * `TELEGRAM_BOT_TOKEN` env), this module talks to the Bot API directly with a
 * per-call token. It powers the BYO (bring-your-own) per-workspace bot: each
 * workspace stores its own sealed BotFather token and we route inbound updates
 * via a per-bot webhook id.
 *
 * Every method returns the parsed `result` payload or throws with the
 * Telegram `description` so callers can surface a useful error.
 */

const API_BASE = 'https://api.telegram.org';

interface TgResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

async function call<T>(token: string, method: string, body?: unknown): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`${API_BASE}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    // Telegram always returns JSON; read text first to avoid opaque parse errors.
    const raw = await res.text();
    let json: TgResponse<T>;
    try {
      json = JSON.parse(raw) as TgResponse<T>;
    } catch {
      throw new Error(`Telegram ${method} returned non-JSON (HTTP ${res.status})`);
    }
    if (!json.ok) {
      throw new Error(json.description ?? `Telegram ${method} failed (HTTP ${res.status})`);
    }
    return json.result as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface TelegramBotInfo {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

/** Validate a bot token + fetch identity. Throws on an invalid token. */
export function getMe(token: string): Promise<TelegramBotInfo> {
  return call<TelegramBotInfo>(token, 'getMe');
}

/** Register a webhook for this bot. `secretToken` is echoed back per update. */
export function setWebhook(token: string, url: string, secretToken: string): Promise<boolean> {
  return call<boolean>(token, 'setWebhook', {
    url,
    secret_token: secretToken,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });
}

/** Remove the webhook (called on disconnect). */
export function deleteWebhook(token: string): Promise<boolean> {
  return call<boolean>(token, 'deleteWebhook', { drop_pending_updates: true });
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface SendMessageOptions {
  parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  disableNotification?: boolean;
  inlineKeyboard?: InlineKeyboardButton[][];
  replyToMessageId?: number;
}

/** Send a text message. Returns the new message id. */
export async function sendMessage(
  token: string,
  chatId: string,
  text: string,
  opts?: SendMessageOptions,
): Promise<number> {
  const res = await call<{ message_id: number }>(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: opts?.parseMode,
    disable_notification: opts?.disableNotification,
    reply_to_message_id: opts?.replyToMessageId,
    reply_markup: opts?.inlineKeyboard ? { inline_keyboard: opts.inlineKeyboard } : undefined,
  });
  return res.message_id;
}

/** Show the typing indicator while we compose a reply. */
export function sendChatAction(
  token: string,
  chatId: string,
  action: 'typing' = 'typing',
): Promise<boolean> {
  return call<boolean>(token, 'sendChatAction', { chat_id: chatId, action });
}

/** Answer a callback query (dismisses the loading spinner on inline buttons). */
export function answerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text?: string,
): Promise<boolean> {
  return call<boolean>(token, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
  });
}

export interface BotCommand {
  command: string;
  description: string;
}

/** Publish the bot's command menu (the "/" button in Telegram). */
export function setMyCommands(token: string, commands: BotCommand[]): Promise<boolean> {
  return call<boolean>(token, 'setMyCommands', { commands });
}

/** Edit an existing message's text (used to reflect approve/reject). */
export function editMessageText(
  token: string,
  chatId: string,
  messageId: number,
  text: string,
  opts?: SendMessageOptions,
): Promise<unknown> {
  return call(token, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: opts?.parseMode,
    reply_markup: opts?.inlineKeyboard ? { inline_keyboard: opts.inlineKeyboard } : undefined,
  });
}

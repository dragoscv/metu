/**
 * Telegram chat ↔ workspace linkage.
 *
 * Each Telegram chat that has authorised the metu bot maps to one
 * workspace + persona. The webhook handler resolves the link to know
 * who is talking and which persona should answer. Without a row, the
 * bot replies with onboarding instructions only.
 *
 * Linking flow (deferred slice): `/start <code>` from the user, where
 * `<code>` is a one-time token issued from /settings/integrations.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { workspace } from './workspace';

/**
 * Per-workspace Telegram bot (BYO BotFather token).
 *
 * The user creates a bot via @BotFather, pastes the token into the connect
 * wizard. We validate it via `getMe`, seal the token (AES-256-GCM), and
 * register a webhook at `/api/webhooks/telegram/<webhookId>` with a random
 * `secretToken` (sent back by Telegram in the `X-Telegram-Bot-Api-Secret-Token`
 * header on every update). `webhookId` is a random opaque id — NOT the bot
 * token — so the public URL never leaks the credential.
 *
 * Outbound proactive messaging is gated by `outboundEnabled` + per-day cap +
 * min spacing + quiet hours (quiet hours live on agentPolicy). `tone` selects
 * the persona voice used by the CodAI message composer.
 */
export const telegramBot = pgTable(
  'telegram_bot',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    /** Opaque random id used in the webhook path. */
    webhookId: text('webhook_id').notNull(),
    /** AES-256-GCM sealed bot token (base64 ciphertext/iv/tag). */
    tokenCiphertext: text('token_ciphertext').notNull(),
    tokenIv: text('token_iv').notNull(),
    tokenTag: text('token_tag').notNull(),
    keyRef: text('key_ref').notNull().default('master'),
    /** Secret token Telegram echoes back on every webhook call. */
    secretToken: text('secret_token').notNull(),
    /** Bot @username + numeric id from getMe (audit/display). */
    botUsername: text('bot_username'),
    botId: text('bot_id'),
    /**
     * The single Telegram user id allowed to talk to this bot. Set on first
     * successful `/start <code>`. All other senders are rejected.
     */
    allowedTelegramUserId: text('allowed_telegram_user_id'),
    /** Who connected the bot (audit). */
    connectedByUserId: uuid('connected_by_user_id').notNull(),
    /** Proactive outbound master switch + guardrails. */
    outboundEnabled: boolean('outbound_enabled').notNull().default(true),
    /** Persona voice for composed messages. */
    tone: text('tone').notNull().default('chief_of_staff'),
    /** Max proactive messages per day. */
    dailyCap: integer('daily_cap').notNull().default(5),
    /** Minimum minutes between proactive messages. */
    minGapMinutes: integer('min_gap_minutes').notNull().default(90),
    /** Rolling counters for cap enforcement (UTC day). */
    sentToday: integer('sent_today').notNull().default(0),
    sentTodayDate: text('sent_today_date'),
    lastProactiveAt: timestamp('last_proactive_at', { withTimezone: true }),
    /** Pause proactive messages until this time (set by /mute). */
    mutedUntil: timestamp('muted_until', { withTimezone: true }),
    /** Free-form config: command toggles, etc. */
    config: jsonb('config')
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: text('status').notNull().default('active'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('telegram_bot_workspace_unique_idx').on(t.workspaceId),
    uniqueIndex('telegram_bot_webhook_id_idx').on(t.webhookId),
  ],
);

export const telegramChatLink = pgTable(
  'telegram_chat_link',
  {
    chatId: text('chat_id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    personaSlug: text('persona_slug').notNull().default('metu'),
    /** Telegram user id of the human that linked the chat. */
    linkedByUserId: uuid('linked_by_user_id').notNull(),
    /** Telegram numeric user id of the human (for the access lock). */
    telegramUserId: text('telegram_user_id'),
    /** Display name we saw at link time — for audit only. */
    fromUserName: text('from_user_name'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
  },
  (t) => [index('telegram_chat_link_workspace_idx').on(t.workspaceId)],
);

/**
 * Short-lived linking codes — issued from /settings/integrations/telegram,
 * consumed by the Telegram bot when the user types `/start <code>`.
 *
 * `code` is a 6-digit numeric string for easy typing on mobile. Single
 * use: row is deleted after consumption. Cron deletes anything older
 * than EXPIRES_AT.
 */
export const telegramLinkCode = pgTable(
  'telegram_link_code',
  {
    code: text('code').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    issuedByUserId: uuid('issued_by_user_id').notNull(),
    personaSlug: text('persona_slug').notNull().default('metu'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index('telegram_link_code_workspace_idx').on(t.workspaceId)],
);

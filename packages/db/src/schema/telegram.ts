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
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspace } from './workspace';

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

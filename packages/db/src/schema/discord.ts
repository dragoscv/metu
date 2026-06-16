/**
 * Discord BYO bot ↔ workspace linkage.
 *
 * Mirrors the Telegram BYO design: the user creates a Discord application +
 * bot, pastes the bot token + application (client) id + public key. We seal
 * the token, register global slash commands, and verify inbound interactions
 * with the app's Ed25519 public key. Outbound proactive messages are DM'd to
 * the linked user, gated by the same outbound prefs.
 *
 * Access lock: bound to a single Discord user id on first `/start <code>`
 * (or first interaction after linking).
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

export const discordBot = pgTable(
  'discord_bot',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    /** Discord application (client) id — used to register slash commands. */
    applicationId: text('application_id').notNull(),
    /** Ed25519 public key (hex) used to verify interaction signatures. */
    publicKey: text('public_key').notNull(),
    /** AES-256-GCM sealed bot token. */
    tokenCiphertext: text('token_ciphertext').notNull(),
    tokenIv: text('token_iv').notNull(),
    tokenTag: text('token_tag').notNull(),
    keyRef: text('key_ref').notNull().default('master'),
    botUsername: text('bot_username'),
    botId: text('bot_id'),
    /** The single Discord user id allowed to use this bot. */
    allowedDiscordUserId: text('allowed_discord_user_id'),
    /** DM channel id to the allowed user (resolved lazily for outbound). */
    dmChannelId: text('dm_channel_id'),
    connectedByUserId: uuid('connected_by_user_id').notNull(),
    outboundEnabled: boolean('outbound_enabled').notNull().default(true),
    tone: text('tone').notNull().default('chief_of_staff'),
    dailyCap: integer('daily_cap').notNull().default(5),
    minGapMinutes: integer('min_gap_minutes').notNull().default(90),
    sentToday: integer('sent_today').notNull().default(0),
    sentTodayDate: text('sent_today_date'),
    lastProactiveAt: timestamp('last_proactive_at', { withTimezone: true }),
    mutedUntil: timestamp('muted_until', { withTimezone: true }),
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
    uniqueIndex('discord_bot_workspace_unique_idx').on(t.workspaceId),
    index('discord_bot_application_idx').on(t.applicationId),
  ],
);

/** Health & energy tracking — manual logs first, wearable later. */
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { workspace } from './workspace';

export const energyLog = pgTable(
  'energy_log',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** 1..5 self-reported energy. */
    energy: integer('energy').notNull(),
    /** 1..5 mood. */
    mood: integer('mood'),
    /** Hours slept last night (decimal). */
    sleepHours: text('sleep_hours'),
    note: text('note'),
    /** Tags: caffeinated, workout, sick, deep-work, ... */
    tags: jsonb('tags')
      .notNull()
      .default(sql`'[]'::jsonb`),
    loggedAt: timestamp('logged_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('energy_log_user_logged_idx').on(t.userId, t.loggedAt),
    index('energy_log_workspace_idx').on(t.workspaceId),
  ],
);

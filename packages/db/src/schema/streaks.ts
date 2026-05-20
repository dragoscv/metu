/**
 * Streaks — daily-cadence behavior tracking. Four kinds:
 *   - abstain    "X days no Y" — chain breaks on `failed = true`
 *   - do_daily   "did Y today" — chain extends per-day entry
 *   - count      "12 pages today / 240 this week" — value accumulates
 *   - boolean    yes/no per day (logically same as do_daily; kept for clarity)
 *
 * One row in streak_entry per (streak, date). Re-logging the same day upserts.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { workspace } from './workspace';

export const streakKind = pgEnum('streak_kind', ['abstain', 'do_daily', 'count', 'boolean']);

export const streak = pgTable(
  'streak',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    body: text('body'),
    kind: streakKind('kind').notNull(),
    /** For 'count': optional weekly/daily target. */
    target: doublePrecision('target'),
    /** Display unit for 'count' (pages, km, glasses, …). */
    unit: text('unit'),
    /** Display color token; falls back to brand. */
    color: text('color'),
    /** Importance weight 1..5 for sort. */
    weight: integer('weight').notNull().default(3),
    /** Optional anchor; used as the chain start for abstain when no entries yet. */
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('streak_workspace_idx').on(t.workspaceId),
    index('streak_workspace_kind_idx').on(t.workspaceId, t.kind),
  ],
);

export const streakEntry = pgTable(
  'streak_entry',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    streakId: uuid('streak_id')
      .notNull()
      .references(() => streak.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    /** Logical day (user's local date) — one row per (streak, day). */
    day: date('day').notNull(),
    /** For 'count': numeric value. For others: 1 by default. */
    value: doublePrecision('value').notNull().default(1),
    /** For 'abstain': true = relapse / chain breaker. Else unused. */
    failed: boolean('failed').notNull().default(false),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('streak_entry_unique_day').on(t.streakId, t.day),
    index('streak_entry_workspace_day_idx').on(t.workspaceId, t.day),
  ],
);

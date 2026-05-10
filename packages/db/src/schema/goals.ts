/**
 * Goals + Targets — qualitative outcomes and numeric KPIs the Conductor
 * watches for drift. See docs/master-plan.md (Slice 13).
 *
 * goal: a qualitative outcome ("ship facturai v1", "exercise consistently").
 * target: a numeric KPI optionally attached to a goal ("RON 10k MRR by Q3").
 * goalCheckin: time-stamped progress snapshots for a goal.
 * targetValue: time-stamped numeric data points for a target.
 * goalLink: evidence — links a goal to tasks/captures/messages/timeline events.
 */
import { sql } from 'drizzle-orm';
import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { project } from './project';
import { workspace } from './workspace';

export const goalStatus = pgEnum('goal_status', ['active', 'paused', 'achieved', 'dropped']);

/** Cadence for the goal's check-in expectation. `once` = no recurring cadence. */
export const goalCadence = pgEnum('goal_cadence', [
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'once',
]);

export const goalProgressMode = pgEnum('goal_progress_mode', [
  'manual', // user-set via check-ins
  'from_tasks', // % of linked tasks completed
  'from_projects', // % of pinned projects in 'archived' (shipped) status
  'from_decisions', // 0.2 per pinned decision, capped at 1.0
  'from_evidence', // Conductor infers from timeline/captures
]);

export const goalDrift = pgEnum('goal_drift', ['on_track', 'slipping', 'stalled']);

export const goal = pgTable(
  'goal',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references(() => project.id, { onDelete: 'set null' }),
    /** Self-referential parent for sub-goals. */
    parentGoalId: uuid('parent_goal_id'),
    title: text('title').notNull(),
    body: text('body'),
    status: goalStatus('status').notNull().default('active'),
    cadence: goalCadence('cadence').notNull().default('weekly'),
    progressMode: goalProgressMode('progress_mode').notNull().default('manual'),
    /** Cached 0..1 progress; recomputed by reviewGoals. */
    progress: doublePrecision('progress').notNull().default(0),
    /** Cached drift class; recomputed by reviewGoals. */
    drift: goalDrift('drift').notNull().default('on_track'),
    /** Importance weight 1..5 used to rank in the Conductor's morning brief. */
    weight: integer('weight').notNull().default(3),
    /** Optional deadline. */
    dueAt: timestamp('due_at', { withTimezone: true }),
    /** When the goal was last reviewed by the Conductor. */
    lastReviewAt: timestamp('last_review_at', { withTimezone: true }),
    /** When progress last advanced (used for stall detection). */
    lastProgressAt: timestamp('last_progress_at', { withTimezone: true }),
    achievedAt: timestamp('achieved_at', { withTimezone: true }),
    tags: jsonb('tags')
      .notNull()
      .default(sql`'[]'::jsonb`),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('goal_workspace_idx').on(t.workspaceId),
    index('goal_status_idx').on(t.status),
    index('goal_project_idx').on(t.projectId),
    index('goal_parent_idx').on(t.parentGoalId),
    index('goal_drift_idx').on(t.drift),
  ],
);

export const goalCheckin = pgTable(
  'goal_checkin',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    goalId: uuid('goal_id')
      .notNull()
      .references(() => goal.id, { onDelete: 'cascade' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    /** 0..1 user-reported (or Conductor-inferred) progress. */
    progress: doublePrecision('progress').notNull(),
    note: text('note'),
    /** 'user' or 'conductor'. */
    createdBy: text('created_by').notNull().default('user'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('goal_checkin_goal_idx').on(t.goalId, t.occurredAt),
    index('goal_checkin_workspace_idx').on(t.workspaceId),
  ],
);

export const targetPeriod = pgEnum('target_period', [
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
  'once',
]);

export const target = pgTable(
  'target',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    /** Optional parent goal — a target can stand alone. */
    goalId: uuid('goal_id').references(() => goal.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    /** 'RON', 'USD', 'hours', 'reps', etc. */
    unit: text('unit').notNull().default(''),
    targetValue: doublePrecision('target_value').notNull(),
    /** Cached current value — sum/avg of targetValue rows for the active period. */
    currentValue: doublePrecision('current_value').notNull().default(0),
    period: targetPeriod('period').notNull().default('monthly'),
    periodStart: timestamp('period_start', { withTimezone: true }),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    status: goalStatus('status').notNull().default('active'),
    /** 'sum' (default), 'avg', 'last', 'max'. Drives currentValue rollup. */
    aggregation: text('aggregation').notNull().default('sum'),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('target_workspace_idx').on(t.workspaceId),
    index('target_goal_idx').on(t.goalId),
    index('target_status_idx').on(t.status),
  ],
);

export const targetValue = pgTable(
  'target_value',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    targetId: uuid('target_id')
      .notNull()
      .references(() => target.id, { onDelete: 'cascade' }),
    value: doublePrecision('value').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    /** 'manual' | 'auto' | 'integration:<kind>' */
    source: text('source').notNull().default('manual'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('target_value_target_idx').on(t.targetId, t.recordedAt),
    index('target_value_workspace_idx').on(t.workspaceId),
  ],
);

/** Evidence: a goal can be linked to tasks/captures/messages/timeline events. */
export const goalLink = pgTable(
  'goal_link',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    goalId: uuid('goal_id')
      .notNull()
      .references(() => goal.id, { onDelete: 'cascade' }),
    /** What kind of entity is being linked. */
    refKind: text('ref_kind').notNull(),
    refId: uuid('ref_id').notNull(),
    note: text('note'),
    addedAt: timestamp('added_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    uniqueIndex('goal_link_unique_idx').on(t.goalId, t.refKind, t.refId),
    index('goal_link_workspace_idx').on(t.workspaceId),
    index('goal_link_ref_idx').on(t.refKind, t.refId),
  ],
);

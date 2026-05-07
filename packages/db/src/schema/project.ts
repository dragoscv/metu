/** Project Intelligence — projects, tasks, decisions, focus state. */
import { relations, sql } from 'drizzle-orm';
import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { workspace } from './workspace';

export const projectStatus = pgEnum('project_status', ['active', 'paused', 'archived', 'killed']);

export const taskStatus = pgEnum('task_status', [
  'inbox',
  'next',
  'doing',
  'blocked',
  'done',
  'dropped',
]);

export const taskKind = pgEnum('task_kind', [
  'deep', // architecture, new code, hard thinking
  'shallow', // admin, review, replies
  'creative',
  'maintenance',
]);

export const project = pgTable(
  'project',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    summary: text('summary'),
    /** Auto-generated daily 3-sentence pulse */
    stateSummary: text('state_summary'),
    status: projectStatus('status').notNull().default('active'),
    /** Decayed momentum score [0,1] */
    momentumScore: doublePrecision('momentum_score').notNull().default(0),
    lastMeaningfulActivityAt: timestamp('last_meaningful_activity_at', {
      withTimezone: true,
    }),
    /** { stack: [...], goals: [...], links: {...}, repos: [...], color, icon } */
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
    index('project_workspace_idx').on(t.workspaceId),
    index('project_status_idx').on(t.status),
    index('project_momentum_idx').on(t.momentumScore),
  ],
);

export const task = pgTable(
  'task',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => project.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    body: text('body'),
    status: taskStatus('status').notNull().default('inbox'),
    kind: taskKind('kind').notNull().default('shallow'),
    /** Estimated leverage: expected_value × shipping_proximity / context_switch_cost */
    leverageScore: doublePrecision('leverage_score'),
    blockedReason: text('blocked_reason'),
    /** AI-suggested vs user-created */
    aiSuggested: integer('ai_suggested').notNull().default(0),
    /** Originating satellite app slug (e.g. 'notai', 'bancai', 'facturai'). NULL = native METU. */
    sourceApp: text('source_app'),
    /** Free-form reference to the entity that produced this intent: { kind, id, ... } */
    sourceEntityRef: jsonb('source_entity_ref'),
    /** Deep link back to the source entity in the satellite app's UI. */
    sourceUrl: text('source_url'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
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
    index('task_workspace_idx').on(t.workspaceId),
    index('task_project_idx').on(t.projectId),
    index('task_status_idx').on(t.status),
    index('task_leverage_idx').on(t.leverageScore),
    index('task_source_app_idx').on(t.sourceApp),
  ],
);

export const decision = pgTable(
  'decision',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => project.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    rationale: text('rationale').notNull(),
    /** Considered alternatives, structured */
    alternatives: jsonb('alternatives')
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Free-form metadata: { tradeoffs, links, references } */
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    decidedAt: timestamp('decided_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('decision_workspace_idx').on(t.workspaceId),
    index('decision_project_idx').on(t.projectId),
  ],
);

/** Per-user current focus snapshot — output of the Focus Engine. */
export const focusState = pgTable(
  'focus_state',
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
    /** The single "now" task id */
    nowTaskId: uuid('now_task_id').references(() => task.id, {
      onDelete: 'set null',
    }),
    /** Up to 3 next task ids */
    nextTaskIds: jsonb('next_task_ids')
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Project ids to explicitly ignore this week */
    ignoredProjectIds: jsonb('ignored_project_ids')
      .notNull()
      .default(sql`'[]'::jsonb`),
    rationale: text('rationale'),
    energyLevel: integer('energy_level'), // 1-5
    computedAt: timestamp('computed_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index('focus_state_workspace_user_idx').on(t.workspaceId, t.userId)],
);

export const projectRelations = relations(project, ({ many, one }) => ({
  workspace: one(workspace, {
    fields: [project.workspaceId],
    references: [workspace.id],
  }),
  tasks: many(task),
  decisions: many(decision),
}));

export const taskRelations = relations(task, ({ one }) => ({
  project: one(project, { fields: [task.projectId], references: [project.id] }),
  workspace: one(workspace, {
    fields: [task.workspaceId],
    references: [workspace.id],
  }),
}));

export const decisionRelations = relations(decision, ({ one }) => ({
  project: one(project, {
    fields: [decision.projectId],
    references: [project.id],
  }),
}));

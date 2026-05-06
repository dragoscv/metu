/** Workspace = tenant root. Every domain row has workspace_id. */
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';

export const workspaceRole = pgEnum('workspace_role', ['owner', 'admin', 'member']);

export const workspace = pgTable('workspace', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  /** Routing policy per intent: { reasoning: 'anthropic', fast: 'gemini', ... } */
  providerPolicy: jsonb('provider_policy')
    .notNull()
    .default(sql`'{}'::jsonb`),
  /** UI preferences: theme, dashboard layout, etc. */
  preferences: jsonb('preferences')
    .notNull()
    .default(sql`'{}'::jsonb`),
  /** Hard monthly USD spend cap on AI; null = unlimited */
  monthlyCostCapUsd: text('monthly_cost_cap_usd'),
  /** When true, ignore cost caps entirely (user opt-in unlimited mode). */
  unlimitedAi: boolean('unlimited_ai').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`)
    .$onUpdate(() => new Date()),
});

export const workspaceMember = pgTable(
  'workspace_member',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: workspaceRole('role').notNull().default('member'),
    joinedAt: timestamp('joined_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index('workspace_member_user_idx').on(t.userId),
  ],
);

export const workspaceRelations = relations(workspace, ({ many }) => ({
  members: many(workspaceMember),
}));

export const workspaceMemberRelations = relations(workspaceMember, ({ one }) => ({
  workspace: one(workspace, {
    fields: [workspaceMember.workspaceId],
    references: [workspace.id],
  }),
  user: one(user, { fields: [workspaceMember.userId], references: [user.id] }),
}));

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

/**
 * Pending email invitation to join a workspace.
 *
 * Tokens are SHA-256-hashed at rest — the plain token is shown to the
 * inviter exactly once (in the success toast) and emailed to the
 * invitee. The claim flow hashes the URL token and looks it up here.
 *
 * One-shot: claiming sets `claimedAt` and `claimedByUserId`; subsequent
 * GETs of the same URL render an "already used" page rather than
 * silently re-attaching the user.
 */
export const workspaceInvite = pgTable(
  'workspace_invite',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: workspaceRole('role').notNull().default('member'),
    /** sha256 of the unguessable url token; never store the plain. */
    tokenHash: text('token_hash').notNull(),
    invitedByUserId: uuid('invited_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    claimedByUserId: uuid('claimed_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('workspace_invite_workspace_idx').on(t.workspaceId),
    index('workspace_invite_token_hash_idx').on(t.tokenHash),
    index('workspace_invite_email_idx').on(t.email),
  ],
);

export const workspaceInviteRelations = relations(workspaceInvite, ({ one }) => ({
  workspace: one(workspace, {
    fields: [workspaceInvite.workspaceId],
    references: [workspace.id],
  }),
  invitedBy: one(user, {
    fields: [workspaceInvite.invitedByUserId],
    references: [user.id],
  }),
}));

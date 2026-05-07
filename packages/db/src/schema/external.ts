/** External resources discovered/cached from integrations + their assignment to projects. */
import { relations, sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { integration } from './integrations';
import { project } from './project';
import { workspace } from './workspace';

/**
 * Cached snapshot of a resource that lives in an external integration
 * (a GitHub repo, a Notion page, a Linear project, a Slack channel, …).
 * One row per (workspace, provider, externalId).
 */
export const integrationResource = pgTable(
  'integration_resource',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    /** Optional: when this resource is owned/discovered through a specific integration account */
    integrationId: uuid('integration_id').references(() => integration.id, {
      onDelete: 'set null',
    }),
    /** github | gitlab | notion | linear | slack | gdrive | generic | … */
    provider: text('provider').notNull(),
    /** repo | page | issue | channel | doc | url | board */
    kind: text('kind').notNull(),
    /** Stable provider-specific id (e.g. 'owner/name' for repo, full URL for generic) */
    externalId: text('external_id').notNull(),
    title: text('title').notNull(),
    url: text('url').notNull(),
    /** Provider-specific metadata snapshot: language, default_branch, stars, isPrivate, etc. */
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('integration_resource_unique_idx').on(t.workspaceId, t.provider, t.externalId),
    index('integration_resource_workspace_idx').on(t.workspaceId),
    index('integration_resource_integration_idx').on(t.integrationId),
    index('integration_resource_provider_idx').on(t.provider, t.kind),
  ],
);

/**
 * Assignment row: a project links to a resource (or to a freeform URL).
 * If `resourceId` is null, this is a generic URL link with title/url stored inline.
 */
export const projectLink = pgTable(
  'project_link',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    /** Optional FK to integration_resource snapshot. NULL for freeform URL links. */
    resourceId: uuid('resource_id').references(() => integrationResource.id, {
      onDelete: 'set null',
    }),
    /** Mirror of resource.provider, kept on the link row so we can filter without joining. */
    provider: text('provider').notNull(),
    /** Mirror of resource.kind ('repo' | 'url' | …). */
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    url: text('url').notNull(),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    addedBy: uuid('added_by').references(() => user.id, { onDelete: 'set null' }),
    addedAt: timestamp('added_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    uniqueIndex('project_link_unique_idx').on(t.projectId, t.url),
    index('project_link_workspace_idx').on(t.workspaceId),
    index('project_link_project_idx').on(t.projectId),
    index('project_link_resource_idx').on(t.resourceId),
    index('project_link_provider_idx').on(t.provider, t.kind),
  ],
);

export const integrationResourceRelations = relations(integrationResource, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [integrationResource.workspaceId],
    references: [workspace.id],
  }),
  integration: one(integration, {
    fields: [integrationResource.integrationId],
    references: [integration.id],
  }),
  links: many(projectLink),
}));

export const projectLinkRelations = relations(projectLink, ({ one }) => ({
  project: one(project, {
    fields: [projectLink.projectId],
    references: [project.id],
  }),
  resource: one(integrationResource, {
    fields: [projectLink.resourceId],
    references: [integrationResource.id],
  }),
  addedByUser: one(user, {
    fields: [projectLink.addedBy],
    references: [user.id],
  }),
}));

/** External resources discovered/cached from integrations + their assignment to projects. */
import { relations, sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
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

/**
 * Per-repo GitHub statistics snapshot. Refreshed every ~2h by a cron job and
 * on demand via `kickGithubStatsSyncAction`. One row per linked repo
 * (uniquely keyed by `resourceId`).
 *
 * The Conductor reads this through the `github_repo_stats` agent tool to
 * ground claims about activity, and the project detail page renders the
 * heatmap + counts directly from this row.
 */
export const githubRepoStats = pgTable(
  'github_repo_stats',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    /** FK → integration_resource (the cached GitHub repo). Unique. */
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => integrationResource.id, { onDelete: 'cascade' }),
    /** Mirror of resource.externalId for ergonomic queries. */
    repoFullName: text('repo_full_name').notNull(),
    defaultBranch: text('default_branch'),
    primaryLanguage: text('primary_language'),
    /** {language: bytes} from /repos/{owner}/{repo}/languages. */
    languageBytes: jsonb('language_bytes')
      .notNull()
      .default(sql`'{}'::jsonb`),
    stargazers: integer('stargazers').notNull().default(0),
    forks: integer('forks').notNull().default(0),
    watchers: integer('watchers').notNull().default(0),
    openIssues: integer('open_issues').notNull().default(0),
    openPullRequests: integer('open_pull_requests').notNull().default(0),
    /** Activity windows attributed to the integration owner (workspace user). */
    commitsLast7d: integer('commits_last_7d').notNull().default(0),
    commitsLast30d: integer('commits_last_30d').notNull().default(0),
    additionsLast30d: integer('additions_last_30d').notNull().default(0),
    deletionsLast30d: integer('deletions_last_30d').notNull().default(0),
    mergedPrsLast30d: integer('merged_prs_last_30d').notNull().default(0),
    closedIssuesLast30d: integer('closed_issues_last_30d').notNull().default(0),
    /** Consecutive days with ≥1 commit by the user, ending today. */
    currentStreakDays: integer('current_streak_days').notNull().default(0),
    /** 52 buckets (newest last) of weekly commit counts from /stats/commit_activity. */
    weeklyCommitHistogram: jsonb('weekly_commit_histogram')
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Top contributors: [{login, contributions, avatarUrl}]. */
    topContributors: jsonb('top_contributors')
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Recent commits cache: [{sha, message, authorLogin, url, authoredAt}]. */
    recentCommits: jsonb('recent_commits')
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Recently merged PRs by user: [{number, title, url, mergedAt}]. */
    recentMergedPrs: jsonb('recent_merged_prs')
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Recently closed issues authored or assigned to user: [{number, title, url, closedAt}]. */
    recentClosedIssues: jsonb('recent_closed_issues')
      .notNull()
      .default(sql`'[]'::jsonb`),
    lastCommitAt: timestamp('last_commit_at', { withTimezone: true }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    lastSyncError: text('last_sync_error'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    uniqueIndex('github_repo_stats_resource_idx').on(t.resourceId),
    index('github_repo_stats_workspace_idx').on(t.workspaceId),
    index('github_repo_stats_full_name_idx').on(t.repoFullName),
  ],
);

export const githubRepoStatsRelations = relations(githubRepoStats, ({ one }) => ({
  workspace: one(workspace, {
    fields: [githubRepoStats.workspaceId],
    references: [workspace.id],
  }),
  resource: one(integrationResource, {
    fields: [githubRepoStats.resourceId],
    references: [integrationResource.id],
  }),
}));

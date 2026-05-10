/**
 * Per-workspace cached recent activity digest.
 *
 * Updated by `recent-digest-cron` every 15 minutes from the latest
 * timeline events. Read by loadPromptContext to fill `{{recentDigest}}`
 * in persona system prompts without paying an embed/recall cost on every
 * companion turn.
 *
 * Single row per workspace; the cron upserts. Trade-off: digest is up
 * to 15 minutes stale, which is fine for "what was the user just up to"
 * persona priming. Anything fresher would require a per-turn recall.
 */
import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspace } from './workspace';

export const workspaceRecentDigest = pgTable('workspace_recent_digest', {
  workspaceId: uuid('workspace_id')
    .primaryKey()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  digest: text('digest').notNull().default(''),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`)
    .$onUpdate(() => new Date()),
});

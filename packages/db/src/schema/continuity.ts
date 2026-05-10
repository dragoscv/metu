/** Context Continuity — persisted "where was I?" briefings per project. */
import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { project } from './project';
import { workspace } from './workspace';

export const continuityBriefing = pgTable(
  'continuity_briefing',
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
    briefing: text('briefing').notNull(),
    modelProvider: text('model_provider'),
    modelId: text('model_id'),
    generatedAt: timestamp('generated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('continuity_briefing_workspace_project_idx').on(t.workspaceId, t.projectId),
    index('continuity_briefing_generated_idx').on(t.generatedAt),
  ],
);

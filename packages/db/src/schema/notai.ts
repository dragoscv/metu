/**
 * @metu/notai — note-taking app, built as a reference SDK consumer.
 *
 * Notes live in metu's own Postgres so notai stays a thin client (no
 * separate DB to operate). Workspace + user scoping is mandatory: the
 * notai web app receives an OIDC access token from metu whose workspace
 * claim is the authoritative tenant key.
 *
 * Sync model: every successful upsert on `notai_note` writes a
 * `capture` row in metu's memory layer (the SDK helper does this in a
 * transaction-adjacent path, not here at schema-time, so this file
 * stays infrastructure only). The `lastSyncedCaptureId` column links
 * the note back to the capture so future edits can update-in-place
 * instead of creating duplicates.
 */
import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from './_shared';
import { workspace } from './workspace';
import { user } from './auth';
import { capture } from './memory';

export const notaiFolder = pgTable(
  'notai_folder',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Optional parent for nested folders. NULL = root. */
    parentId: uuid('parent_id'),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    ...timestamps,
  },
  (t) => ({
    byWorkspaceUserIdx: index('notai_folder_ws_user_idx').on(t.workspaceId, t.userId),
  }),
);

export const notaiNote = pgTable(
  'notai_note',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    folderId: uuid('folder_id').references(() => notaiFolder.id, { onDelete: 'set null' }),
    title: text('title').notNull().default('Untitled'),
    /** Markdown body. Plain text edits round-trip cleanly; rich
     * formatting can be layered on top with a markdown renderer
     * client-side. */
    body: text('body').notNull().default(''),
    /** Soft pin to keep important notes at the top of the sidebar. */
    pinned: boolean('pinned').notNull().default(false),
    /**
     * The capture row this note last synced into metu memory. NULL
     * means "never synced". Whenever a save mirrors the note, we
     * upsert the linked capture instead of creating a new one.
     */
    lastSyncedCaptureId: uuid('last_synced_capture_id').references(() => capture.id, {
      onDelete: 'set null',
    }),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    ...timestamps,
  },
  (t) => ({
    byWorkspaceUserIdx: index('notai_note_ws_user_idx').on(t.workspaceId, t.userId),
    byFolderIdx: index('notai_note_folder_idx').on(t.folderId),
  }),
);

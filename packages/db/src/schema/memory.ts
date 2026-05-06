/** Capture (universal inbox) + memory chunks (vector store) + timeline (event log). */
import { sql } from 'drizzle-orm';
import {
  doublePrecision,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { project } from './project';
import { workspace } from './workspace';

export const captureKind = pgEnum('capture_kind', [
  'text',
  'voice',
  'screenshot',
  'link',
  'code',
  'email',
  'message', // Telegram/WhatsApp
  'file',
]);

export const captureStatus = pgEnum('capture_status', [
  'received',
  'processing',
  'ready',
  'failed',
]);

export const memorySourceKind = pgEnum('memory_source_kind', [
  'capture',
  'task',
  'decision',
  'project_summary',
  'repo_file',
  'commit',
  'email',
  'message',
  'agent_run',
  'manual',
]);

/** Universal inbox row. Heavy content (transcript/embedding) lives downstream. */
export const capture = pgTable(
  'capture',
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
    projectId: uuid('project_id').references(() => project.id, {
      onDelete: 'set null',
    }),
    kind: captureKind('kind').notNull(),
    status: captureStatus('status').notNull().default('received'),
    /** Inline text content (or transcript once available). */
    content: text('content'),
    /** GCS object key for binary content (audio, image, file). */
    storageKey: text('storage_key'),
    /** Original source URL (web clip, link). */
    sourceUrl: text('source_url'),
    /** Source surface: web, mobile, browser-ext, vscode-ext, telegram, gmail, ... */
    source: text('source').notNull().default('web'),
    /** Free-form structured metadata (size, duration, mime, ai-classification). */
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    capturedAt: timestamp('captured_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
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
    index('capture_workspace_idx').on(t.workspaceId),
    index('capture_user_idx').on(t.userId),
    index('capture_project_idx').on(t.projectId),
    index('capture_status_idx').on(t.status),
    index('capture_captured_at_idx').on(t.capturedAt),
  ],
);

/** Embedded chunk with polymorphic source pointer. 1536-dim default. */
export const memoryChunk = pgTable(
  'memory_chunk',
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
    sourceKind: memorySourceKind('source_kind').notNull(),
    sourceId: uuid('source_id'),
    /** Chunk content as plain text (for FTS + display). */
    content: text('content').notNull(),
    /** OpenAI text-embedding-3-small = 1536 dims. */
    embedding: vector('embedding', { dimensions: 1536 }),
    /** Token count, position in source, kind-specific metadata. */
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Used by the focus/recall ranker. */
    weight: doublePrecision('weight').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('memory_chunk_workspace_idx').on(t.workspaceId),
    index('memory_chunk_project_idx').on(t.projectId),
    index('memory_chunk_source_idx').on(t.sourceKind, t.sourceId),
    // HNSW vector index for fast cosine similarity. Created in migration SQL too.
    index('memory_chunk_embedding_idx')
      .using('hnsw', t.embedding.op('vector_cosine_ops'))
      .with({ m: 16, ef_construction: 64 }),
  ],
);

/** Append-only event log — episodic memory + audit trail. */
export const timelineEvent = pgTable(
  'timeline_event',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references(() => project.id, {
      onDelete: 'set null',
    }),
    /** e.g. capture.created, project.created, decision.logged, integration.connected, focus.recomputed */
    kind: text('kind').notNull(),
    /** Human summary, used directly in timeline UI. */
    title: text('title').notNull(),
    body: text('body'),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Importance for ranking 0..1 */
    importance: doublePrecision('importance').notNull().default(0.5),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('timeline_workspace_occurred_idx').on(t.workspaceId, t.occurredAt),
    index('timeline_project_occurred_idx').on(t.projectId, t.occurredAt),
    index('timeline_kind_idx').on(t.kind),
  ],
);

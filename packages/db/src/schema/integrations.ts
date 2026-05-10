/** External integrations + BYOK provider credentials + agent runs. */
import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { workspace } from './workspace';

export const integrationKind = pgEnum('integration_kind', [
  'github',
  'google',
  'gmail',
  'gcal',
  'telegram',
  'whatsapp',
  'stripe',
  'vercel',
  'firebase',
  'spotify',
  'slack',
  'notion',
  'linear',
  'browser',
  'vscode',
  'webhook',
  'external_mcp',
]);

export const integrationStatus = pgEnum('integration_status', [
  'active',
  'paused',
  'error',
  'revoked',
]);

export const integration = pgTable(
  'integration',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    kind: integrationKind('kind').notNull(),
    /** External account identifier — github org/user, gmail address, telegram chat id, etc. */
    externalId: text('external_id').notNull(),
    label: text('label').notNull(),
    status: integrationStatus('status').notNull().default('active'),
    /** Encrypted token blob (envelope-encrypted with workspace DEK). */
    tokenCiphertext: text('token_ciphertext'),
    tokenIv: text('token_iv'),
    /** Encrypted refresh token (where applicable). */
    refreshTokenCiphertext: text('refresh_token_ciphertext'),
    refreshTokenIv: text('refresh_token_iv'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** Per-integration config: scopes, channel filters, repo allowlist, polling cursor, etc. */
    config: jsonb('config')
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Marks "the" account for this (workspace, kind) when multiple are connected. */
    isDefault: boolean('is_default').notNull().default(false),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('integration_unique_idx').on(t.workspaceId, t.kind, t.externalId),
    uniqueIndex('integration_default_unique_idx')
      .on(t.workspaceId, t.kind)
      .where(sql`${t.isDefault}`),
    index('integration_workspace_idx').on(t.workspaceId),
    index('integration_status_idx').on(t.status),
  ],
);

export const aiProviderKind = pgEnum('ai_provider_kind', [
  'anthropic',
  'openai',
  'azure_openai',
  'google',
  'vertex',
  'copilot',
  'ollama',
  'custom',
  // Voice (slice 5b — BYOK voice keys reuses provider_credential).
  'deepgram',
  'cartesia',
  'elevenlabs',
]);

/** BYOK — encrypted per-workspace AI credentials. */
export const providerCredential = pgTable(
  'provider_credential',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    provider: aiProviderKind('provider').notNull(),
    label: text('label').notNull(),
    /** AES-256-GCM ciphertext of the API key, base64. */
    apiKeyCiphertext: text('api_key_ciphertext').notNull(),
    apiKeyIv: text('api_key_iv').notNull(),
    /** AES-256-GCM auth tag, base64. */
    apiKeyTag: text('api_key_tag').notNull(),
    /** Reference to the wrapped DEK in KMS (or 'master' for env-key dev mode). */
    keyRef: text('key_ref').notNull().default('master'),
    /** Optional endpoint (Azure, custom). */
    endpoint: text('endpoint'),
    /** Optional default model override. */
    defaultModel: text('default_model'),
    /** { region, deployment, projectId, organization, ... } */
    config: jsonb('config')
      .notNull()
      .default(sql`'{}'::jsonb`),
    isDefault: integer('is_default').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('provider_credential_unique_idx').on(t.workspaceId, t.provider, t.label),
    index('provider_credential_workspace_idx').on(t.workspaceId),
  ],
);

export const agentRunStatus = pgEnum('agent_run_status', [
  'pending',
  'running',
  'success',
  'failed',
  'cancelled',
]);

/** Auditable record of every AI invocation. */
export const agentRun = pgTable(
  'agent_run',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    /** What kind of run: focus.compute, capture.classify, recall, agent.task, ... */
    kind: text('kind').notNull(),
    intent: text('intent').notNull(), // reasoning | agentic | fast | embed | transcribe | vision
    providerUsed: aiProviderKind('provider_used'),
    modelUsed: text('model_used'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costUsd: doublePrecision('cost_usd'),
    status: agentRunStatus('status').notNull().default('pending'),
    /** Truncated for storage, full payload in object storage if huge. */
    inputPreview: text('input_preview'),
    outputPreview: text('output_preview'),
    error: text('error'),
    /** Tool calls made, parents, traces. */
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('agent_run_workspace_started_idx').on(t.workspaceId, t.startedAt),
    index('agent_run_kind_idx').on(t.kind),
    index('agent_run_status_idx').on(t.status),
  ],
);

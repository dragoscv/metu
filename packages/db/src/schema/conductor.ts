/**
 * Conductor / Conversations / Devices / Apps / Notifications / Autonomy.
 *
 * All new tables for the "central console" layer. See docs/master-plan.md.
 */
import { relations, sql } from 'drizzle-orm';
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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { project } from './project';
import { workspace } from './workspace';
import { agentRun } from './integrations';

// ─── Conversations ────────────────────────────────────────────────────────

export const conversationKind = pgEnum('conversation_kind', [
  'conductor', // the persistent supervisor thread per workspace (one)
  'side', // ad-hoc user-created chat
  'project', // auto-created per project
  'tool', // ephemeral chat for a single tool execution
]);

export const conversationStatus = pgEnum('conversation_status', ['active', 'archived', 'pinned']);

export const conversation = pgTable(
  'conversation',
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
    kind: conversationKind('kind').notNull().default('side'),
    status: conversationStatus('status').notNull().default('active'),
    title: text('title').notNull().default('New conversation'),
    /** LLM-generated 1-line summary, refreshed periodically. */
    summary: text('summary'),
    /** { branchedFromMessageId, parentConversationId, intent, model, ... } */
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => new Date()),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    index('conversation_workspace_idx').on(t.workspaceId),
    index('conversation_kind_idx').on(t.kind),
    index('conversation_project_idx').on(t.projectId),
    index('conversation_last_message_idx').on(t.lastMessageAt),
    // Only one Conductor thread per workspace.
    uniqueIndex('conversation_conductor_singleton_idx')
      .on(t.workspaceId)
      .where(sql`${t.kind} = 'conductor'`),
  ],
);

export const messageRole = pgEnum('message_role', ['system', 'user', 'assistant', 'tool']);

export const message = pgTable(
  'message',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    role: messageRole('role').notNull(),
    /** Plain text rendering — single source for FTS / display. */
    content: text('content').notNull().default(''),
    /** Structured content blocks (text, image, tool_use, tool_result, thinking). */
    blocks: jsonb('blocks')
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Producer device or app id (nullable for server). */
    deviceId: uuid('device_id'),
    appId: uuid('app_id'),
    /** Link to the agent_run that produced this assistant message. */
    agentRunId: uuid('agent_run_id').references(() => agentRun.id, {
      onDelete: 'set null',
    }),
    /** Token + cost telemetry for assistant messages. */
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costUsd: doublePrecision('cost_usd'),
    /** Provider/model used for this message. */
    provider: text('provider'),
    model: text('model'),
    /** Whether the message is still streaming. */
    streaming: boolean('streaming').notNull().default(false),
    error: text('error'),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('message_conversation_idx').on(t.conversationId, t.createdAt),
    index('message_workspace_idx').on(t.workspaceId),
    index('message_role_idx').on(t.role),
  ],
);

export const toolCallStatus = pgEnum('tool_call_status', [
  'pending', // proposed by the agent, not yet acted
  'awaiting_approval',
  'approved',
  'rejected',
  'running',
  'success',
  'failed',
  'undone',
  'cancelled',
]);

/** Every tool the Conductor (or any agent) tries to run, with full audit + undo. */
export const toolCall = pgTable(
  'tool_call',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').references(() => conversation.id, {
      onDelete: 'set null',
    }),
    messageId: uuid('message_id').references(() => message.id, {
      onDelete: 'set null',
    }),
    agentRunId: uuid('agent_run_id').references(() => agentRun.id, {
      onDelete: 'set null',
    }),
    /** Tool name as registered in packages/core/agent/tools.ts */
    tool: text('tool').notNull(),
    /** JSON args validated against the tool's zod schema. */
    args: jsonb('args')
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: toolCallStatus('status').notNull().default('pending'),
    /** Result returned to the model (truncated for storage). */
    result: jsonb('result'),
    /** Payload required to undo this action (null if non-undoable). */
    undoPayload: jsonb('undo_payload'),
    /** ACL level applied at execution time. */
    aclMode: text('acl_mode'), // 'observe' | 'ask' | 'auto_with_undo' | 'autopilot'
    /** Estimated $ cost (LLM + side-effect cost). */
    estimatedCostUsd: doublePrecision('estimated_cost_usd'),
    actualCostUsd: doublePrecision('actual_cost_usd'),
    error: text('error'),
    requestedAt: timestamp('requested_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('tool_call_workspace_idx').on(t.workspaceId),
    index('tool_call_conversation_idx').on(t.conversationId),
    index('tool_call_status_idx').on(t.status),
    index('tool_call_tool_idx').on(t.tool),
  ],
);

// ─── Autonomy ─────────────────────────────────────────────────────────────

export const autonomyMode = pgEnum('autonomy_mode', [
  'observe',
  'ask',
  'auto_with_undo',
  'autopilot',
]);

/** One row per workspace — overall agent governance. */
export const agentPolicy = pgTable('agent_policy', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  workspaceId: uuid('workspace_id')
    .notNull()
    .unique()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  /** Default autonomy when no per-tool override exists. */
  defaultMode: autonomyMode('default_mode').notNull().default('ask'),
  /** Master kill-switch — when false, conductor tick exits without planning. */
  enabled: boolean('enabled').notNull().default(true),
  /** Soft cap, USD. Null = unlimited (still respects workspace.unlimitedAi). */
  dailyCostCapUsd: doublePrecision('daily_cost_cap_usd').default(2),
  /** Max autonomous (non-ask) actions per day. Null = unlimited. */
  dailyActionCap: integer('daily_action_cap').default(50),
  /** Notification slider 0..100 (silent → assertive). */
  notificationLevel: integer('notification_level').notNull().default(40),
  /** Quiet hours in user's TZ, e.g. { start: '22:00', end: '08:00', tz: 'Europe/Bucharest' } */
  quietHours: jsonb('quiet_hours')
    .notNull()
    .default(sql`'{}'::jsonb`),
  /** Conductor tick cadence in seconds when idle (default 5min). */
  tickIntervalSec: integer('tick_interval_sec').notNull().default(300),
  /** Approval timeout in seconds before an "ask" auto-rejects. */
  approvalTimeoutSec: integer('approval_timeout_sec').notNull().default(86400),
  /**
   * Workspace gate for the companion-side Ollama bridge. When false
   * (default) the conductor will not route any LLM call through a
   * connected device's localhost:11434 — even if the user has paired
   * such a device. Flipping this on is an explicit "I trust local
   * inference for this workspace" decision.
   */
  ollamaEnabled: boolean('ollama_enabled').notNull().default(false),
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
});

/**
 * Per-tool ACL override. Tool name matches packages/core/agent/tools.ts registry.
 *
 * Optionally scoped to a single `integration` row (e.g. one external_mcp app
 * gets `autopilot` while every other use of the same tool stays `ask`).
 *  - integrationId IS NULL → workspace-wide override for this tool.
 *  - integrationId IS NOT NULL → applies only when runTool is called with that
 *    integration id (auto-extracted from args for tools like `external_invoke`).
 */
export const toolAcl = pgTable(
  'tool_acl',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    tool: text('tool').notNull(),
    /** When set, this rule only applies for that integration. */
    integrationId: uuid('integration_id'),
    mode: autonomyMode('mode').notNull(),
    /** Optional per-tool budget. */
    dailyCostCapUsd: doublePrecision('daily_cost_cap_usd'),
    notes: text('notes'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Postgres treats NULLs as distinct in unique indexes; split into two partial uniques.
    uniqueIndex('tool_acl_workspace_tool_unique_idx')
      .on(t.workspaceId, t.tool)
      .where(sql`${t.integrationId} IS NULL`),
    uniqueIndex('tool_acl_workspace_tool_integration_unique_idx')
      .on(t.workspaceId, t.tool, t.integrationId)
      .where(sql`${t.integrationId} IS NOT NULL`),
    index('tool_acl_integration_idx').on(t.integrationId),
  ],
);

// ─── Devices ──────────────────────────────────────────────────────────────

export const deviceKind = pgEnum('device_kind', [
  'web',
  'mobile',
  'vscode_ext',
  'browser_ext',
  'companion_desktop',
  'mcp_client',
  'external_app',
  'cli',
]);

export const devicePresence = pgEnum('device_presence', ['online', 'idle', 'offline']);

export const device = pgTable(
  'device',
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
    kind: deviceKind('kind').notNull(),
    /** OS / runtime: 'windows', 'macos', 'linux', 'ios', 'android', 'chrome', ... */
    platform: text('platform').notNull(),
    /** User-friendly name, e.g. "Dragos — MBP 16" or "iPhone 15". */
    name: text('name').notNull(),
    /** Stable client-generated fingerprint. */
    fingerprint: text('fingerprint').notNull(),
    /** App version + capabilities advertised on connect. */
    version: text('version'),
    capabilities: jsonb('capabilities')
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Per-device ACL override (overrides workspace agent_policy for tools targeting this device). */
    acl: jsonb('acl')
      .notNull()
      .default(sql`'{}'::jsonb`),
    presence: devicePresence('presence').notNull().default('offline'),
    /** Push channel + token. */
    pushChannel: text('push_channel'), // 'web_push' | 'expo' | 'tauri'
    pushToken: text('push_token'),
    /** Hashed pairing secret used for re-auth handshake. */
    pairingSecretHash: text('pairing_secret_hash'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    /** Last-known activity, e.g. { window: 'VS Code', file: 'src/foo.ts' }. */
    activity: jsonb('activity')
      .notNull()
      .default(sql`'{}'::jsonb`),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('device_fingerprint_idx').on(t.workspaceId, t.userId, t.fingerprint),
    index('device_workspace_idx').on(t.workspaceId),
    index('device_presence_idx').on(t.presence),
  ],
);

/** Append-only stream of device-emitted events (presence, window, file, capture). */
export const deviceEvent = pgTable(
  'device_event',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => device.id, { onDelete: 'cascade' }),
    /** e.g. presence.online, window.changed, clipboard.added, file.changed, capture.created */
    kind: text('kind').notNull(),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('device_event_workspace_occurred_idx').on(t.workspaceId, t.occurredAt),
    index('device_event_device_occurred_idx').on(t.deviceId, t.occurredAt),
    index('device_event_kind_idx').on(t.kind),
  ],
);

// ─── Apps (METU as OAuth2/OIDC provider) ──────────────────────────────────

export const oauthClientType = pgEnum('oauth_client_type', [
  'first_party',
  'third_party',
  'public', // PKCE public client (no secret)
]);

/** A registered OAuth2 client (notai, mmo, companion app, or third-party). */
export const oauthClient = pgTable(
  'oauth_client',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    clientId: text('client_id').notNull().unique(),
    /** sha256(secret) — secret is shown once on creation. */
    clientSecretHash: text('client_secret_hash'),
    type: oauthClientType('type').notNull().default('first_party'),
    name: text('name').notNull(),
    iconUrl: text('icon_url'),
    /** Allowed redirect URIs (exact match). */
    redirectUris: jsonb('redirect_uris')
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Space-delimited allowed scopes. */
    allowedScopes: text('allowed_scopes')
      .notNull()
      .default('openid profile capture:write recall:read notify:write'),
    /** Webhook URL for server-side event delivery (alternative to WS). */
    webhookUrl: text('webhook_url'),
    /** sha256(secret) used for HMAC verification on inbound webhooks. */
    webhookSecretHash: text('webhook_secret_hash'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => new Date()),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('oauth_client_workspace_idx').on(t.workspaceId)],
);

export const oauthTokenKind = pgEnum('oauth_token_kind', [
  'authorization_code',
  'access_token',
  'refresh_token',
  'device_code',
]);

/** Issued OAuth tokens (hashed). */
export const oauthToken = pgTable(
  'oauth_token',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => oauthClient.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').references(() => device.id, {
      onDelete: 'set null',
    }),
    kind: oauthTokenKind('kind').notNull(),
    /** sha256(token) for fast lookup; raw token never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    /**
     * All tokens descending from a single device-/code-grant share a family id.
     * If a consumed refresh token is replayed we can revoke the entire family.
     */
    tokenFamilyId: uuid('token_family_id'),
    scopes: text('scopes').notNull().default(''),
    /** PKCE code_challenge if applicable. */
    codeChallenge: text('code_challenge'),
    codeChallengeMethod: text('code_challenge_method'),
    /** For device-code flow user-facing code. */
    userCode: text('user_code'),
    redirectUri: text('redirect_uri'),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /**
     * Last time this token was successfully resolved by a bearer-auth
     * lookup. Updated lazily (max once / minute) to surface SDK-only
     * client liveness ("browser-ext last seen 5m ago") without WS
     * connections. Null until the token's first use.
     */
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('oauth_token_client_idx').on(t.clientId),
    index('oauth_token_user_idx').on(t.userId),
    index('oauth_token_kind_idx').on(t.kind),
    index('oauth_token_user_code_idx').on(t.userCode),
  ],
);

// ─── Notifications ────────────────────────────────────────────────────────

export const notificationUrgency = pgEnum('notification_urgency', [
  'low',
  'normal',
  'high',
  'critical',
]);

export const notification = pgTable(
  'notification',
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
    title: text('title').notNull(),
    body: text('body'),
    urgency: notificationUrgency('urgency').notNull().default('normal'),
    /** Source: 'conductor' | 'app:notai' | 'integration:github' | ... */
    source: text('source').notNull().default('conductor'),
    actionUrl: text('action_url'),
    /** Quick actions rendered as buttons: [{ id, label, kind: 'approve'|'reject'|'open' }] */
    actions: jsonb('actions')
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Devices the notification was actually pushed to. */
    deliveredTo: jsonb('delivered_to')
      .notNull()
      .default(sql`'[]'::jsonb`),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    readAt: timestamp('read_at', { withTimezone: true }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('notification_user_created_idx').on(t.userId, t.createdAt),
    index('notification_workspace_idx').on(t.workspaceId),
    index('notification_urgency_idx').on(t.urgency),
  ],
);

/** Per-device push subscription details (VAPID/Expo). Tauri uses WS, no row needed. */
export const notificationSubscription = pgTable(
  'notification_subscription',
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
    deviceId: uuid('device_id').references(() => device.id, {
      onDelete: 'cascade',
    }),
    channel: text('channel').notNull(), // 'web_push' | 'expo'
    /** For web push: { endpoint, keys: { p256dh, auth } }. For expo: { token }. */
    payload: jsonb('payload').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('notification_subscription_user_idx').on(t.userId),
    index('notification_subscription_device_idx').on(t.deviceId),
  ],
);

/**
 * Expo push receipts. After we send via /v2/push/send Expo returns a
 * `ticketId`; the actual delivery status is only available later via
 * /v2/push/getReceipts. We persist tickets here, and an Inngest cron
 * polls them, marking ok/error and disabling subscriptions on
 * permanent failures.
 */
export const pushReceipt = pgTable(
  'push_receipt',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => notificationSubscription.id, { onDelete: 'cascade' }),
    notificationId: uuid('notification_id').references(() => notification.id, {
      onDelete: 'set null',
    }),
    ticketId: text('ticket_id').notNull(),
    /** 'pending' | 'ok' | 'error' */
    status: text('status').notNull().default('pending'),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    checkedAt: timestamp('checked_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('push_receipt_ticket_idx').on(t.ticketId),
    index('push_receipt_pending_idx').on(t.status, t.createdAt),
  ],
);

/**
 * Dead-letter queue for failed `hubBroadcast()` calls. Operator-side
 * read + replay only — see /api/internal/hub/dlq.
 */
export const hubDlqEnvelope = pgTable(
  'hub_dlq_envelope',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    kinds: jsonb('kinds')
      .notNull()
      .default(sql`'[]'::jsonb`),
    deviceIds: jsonb('device_ids')
      .notNull()
      .default(sql`'[]'::jsonb`),
    envelope: jsonb('envelope').notNull(),
    reason: text('reason').notNull(),
    attempts: integer('attempts').notNull().default(1),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    replayedAt: timestamp('replayed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index('hub_dlq_pending_idx').on(t.workspaceId, t.createdAt)],
);

// ─── Relations ────────────────────────────────────────────────────────────

export const conversationRelations = relations(conversation, ({ many, one }) => ({
  workspace: one(workspace, {
    fields: [conversation.workspaceId],
    references: [workspace.id],
  }),
  project: one(project, {
    fields: [conversation.projectId],
    references: [project.id],
  }),
  messages: many(message),
}));

export const messageRelations = relations(message, ({ one }) => ({
  conversation: one(conversation, {
    fields: [message.conversationId],
    references: [conversation.id],
  }),
  agentRun: one(agentRun, {
    fields: [message.agentRunId],
    references: [agentRun.id],
  }),
}));

export const toolCallRelations = relations(toolCall, ({ one }) => ({
  conversation: one(conversation, {
    fields: [toolCall.conversationId],
    references: [conversation.id],
  }),
  message: one(message, {
    fields: [toolCall.messageId],
    references: [message.id],
  }),
}));

export const deviceRelations = relations(device, ({ many, one }) => ({
  workspace: one(workspace, {
    fields: [device.workspaceId],
    references: [workspace.id],
  }),
  user: one(user, { fields: [device.userId], references: [user.id] }),
  events: many(deviceEvent),
}));

export const oauthClientRelations = relations(oauthClient, ({ many }) => ({
  tokens: many(oauthToken),
}));

export const oauthTokenRelations = relations(oauthToken, ({ one }) => ({
  client: one(oauthClient, {
    fields: [oauthToken.clientId],
    references: [oauthClient.id],
  }),
}));

/** Custom OAuth providers — bring-your-own OAuth app + per-user connection. */
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { workspace } from './workspace';
import { integrationKind } from './integrations';

export const oauthApp = pgTable(
  'oauth_app',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    /** Display name e.g. "My GitHub OAuth App". */
    name: text('name').notNull(),
    /** URL-safe identifier used in callback path. */
    slug: text('slug').notNull(),
    /** Optional OIDC issuer or discovery URL we autofilled from. */
    discoveryUrl: text('discovery_url'),
    authorizeUrl: text('authorize_url').notNull(),
    tokenUrl: text('token_url').notNull(),
    userinfoUrl: text('userinfo_url'),
    revokeUrl: text('revoke_url'),
    clientId: text('client_id').notNull(),
    /** AES-256-GCM sealed client secret (base64). */
    clientSecretCiphertext: text('client_secret_ciphertext').notNull(),
    clientSecretIv: text('client_secret_iv').notNull(),
    clientSecretTag: text('client_secret_tag').notNull(),
    /** Space-delimited default scopes. */
    scopes: text('scopes').notNull().default(''),
    pkce: boolean('pkce').notNull().default(true),
    /** Tag this app as the workspace's OAuth client for a given integration kind. */
    kind: integrationKind('kind'),
    /** Extra query params for the authorize step (access_type=offline, duration=permanent, ...). */
    extraAuthParams: jsonb('extra_auth_params')
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** 'client_secret_post' (default) or 'client_secret_basic' for providers that demand HTTP Basic. */
    tokenAuthMethod: text('token_auth_method').notNull().default('client_secret_post'),
    /** Capabilities discovered from /.well-known/openid-configuration. */
    discovered: jsonb('discovered')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('oauth_app_slug_idx').on(t.workspaceId, t.slug),
    uniqueIndex('oauth_app_kind_unique_idx')
      .on(t.workspaceId, t.kind)
      .where(sql`${t.kind} IS NOT NULL`),
    index('oauth_app_workspace_idx').on(t.workspaceId),
  ],
);

export const oauthConnection = pgTable(
  'oauth_connection',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    appId: uuid('app_id')
      .notNull()
      .references(() => oauthApp.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    /** Subject (sub claim) or userinfo identifier. */
    externalId: text('external_id').notNull(),
    label: text('label').notNull(),
    status: text('status').notNull().default('active'),
    accessTokenCiphertext: text('access_token_ciphertext').notNull(),
    accessTokenIv: text('access_token_iv').notNull(),
    accessTokenTag: text('access_token_tag').notNull(),
    refreshTokenCiphertext: text('refresh_token_ciphertext'),
    refreshTokenIv: text('refresh_token_iv'),
    refreshTokenTag: text('refresh_token_tag'),
    tokenType: text('token_type').notNull().default('Bearer'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** Space-delimited scopes the provider returned. */
    grantedScopes: text('granted_scopes').notNull().default(''),
    /** Userinfo claims + any probed endpoint metadata. */
    identity: jsonb('identity')
      .notNull()
      .default(sql`'{}'::jsonb`),
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
    uniqueIndex('oauth_connection_unique_idx').on(t.workspaceId, t.appId, t.externalId),
    index('oauth_connection_workspace_idx').on(t.workspaceId),
  ],
);

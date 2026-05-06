/** OAuth app + connection queries. */
import { and, asc, desc, eq } from 'drizzle-orm';
import { getDb } from '../client';
import { oauthApp, oauthConnection } from '../schema';

export interface OauthAppRow {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  discoveryUrl: string | null;
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl: string | null;
  revokeUrl: string | null;
  clientId: string;
  clientSecretCiphertext: string;
  clientSecretIv: string;
  clientSecretTag: string;
  scopes: string;
  pkce: boolean;
  discovered: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export async function listOauthApps(workspaceId: string): Promise<OauthAppRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(oauthApp)
    .where(eq(oauthApp.workspaceId, workspaceId))
    .orderBy(asc(oauthApp.name));
  return rows as OauthAppRow[];
}

export async function getOauthApp(workspaceId: string, id: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(oauthApp)
    .where(and(eq(oauthApp.workspaceId, workspaceId), eq(oauthApp.id, id)))
    .limit(1);
  return (rows[0] ?? null) as OauthAppRow | null;
}

/** Lookup without workspace check — used by callback before we know the user. */
export async function getOauthAppById(id: string) {
  const db = getDb();
  const rows = await db.select().from(oauthApp).where(eq(oauthApp.id, id)).limit(1);
  return (rows[0] ?? null) as OauthAppRow | null;
}

export interface CreateOauthAppInput {
  workspaceId: string;
  name: string;
  slug: string;
  discoveryUrl?: string | null;
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl?: string | null;
  revokeUrl?: string | null;
  clientId: string;
  clientSecretCiphertext: string;
  clientSecretIv: string;
  clientSecretTag: string;
  scopes: string;
  pkce: boolean;
  discovered?: Record<string, unknown>;
}

export async function createOauthApp(input: CreateOauthAppInput): Promise<string> {
  const db = getDb();
  const inserted = await db
    .insert(oauthApp)
    .values({
      workspaceId: input.workspaceId,
      name: input.name,
      slug: input.slug,
      discoveryUrl: input.discoveryUrl ?? null,
      authorizeUrl: input.authorizeUrl,
      tokenUrl: input.tokenUrl,
      userinfoUrl: input.userinfoUrl ?? null,
      revokeUrl: input.revokeUrl ?? null,
      clientId: input.clientId,
      clientSecretCiphertext: input.clientSecretCiphertext,
      clientSecretIv: input.clientSecretIv,
      clientSecretTag: input.clientSecretTag,
      scopes: input.scopes,
      pkce: input.pkce,
      discovered: input.discovered ?? {},
    })
    .returning();
  return inserted[0]!.id;
}

export async function deleteOauthApp(workspaceId: string, id: string) {
  const db = getDb();
  await db.delete(oauthApp).where(and(eq(oauthApp.workspaceId, workspaceId), eq(oauthApp.id, id)));
}

export interface OauthConnectionRow {
  id: string;
  workspaceId: string;
  appId: string;
  userId: string | null;
  externalId: string;
  label: string;
  status: string;
  expiresAt: Date | null;
  grantedScopes: string;
  identity: Record<string, unknown>;
  lastSyncAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function listOauthConnections(workspaceId: string): Promise<OauthConnectionRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: oauthConnection.id,
      workspaceId: oauthConnection.workspaceId,
      appId: oauthConnection.appId,
      userId: oauthConnection.userId,
      externalId: oauthConnection.externalId,
      label: oauthConnection.label,
      status: oauthConnection.status,
      expiresAt: oauthConnection.expiresAt,
      grantedScopes: oauthConnection.grantedScopes,
      identity: oauthConnection.identity,
      lastSyncAt: oauthConnection.lastSyncAt,
      lastError: oauthConnection.lastError,
      createdAt: oauthConnection.createdAt,
      updatedAt: oauthConnection.updatedAt,
    })
    .from(oauthConnection)
    .where(eq(oauthConnection.workspaceId, workspaceId))
    .orderBy(desc(oauthConnection.createdAt));
  return rows as OauthConnectionRow[];
}

export interface UpsertOauthConnectionInput {
  workspaceId: string;
  appId: string;
  userId: string;
  externalId: string;
  label: string;
  accessTokenCiphertext: string;
  accessTokenIv: string;
  accessTokenTag: string;
  refreshTokenCiphertext?: string | null;
  refreshTokenIv?: string | null;
  refreshTokenTag?: string | null;
  tokenType?: string;
  expiresAt?: Date | null;
  grantedScopes: string;
  identity: Record<string, unknown>;
}

export async function upsertOauthConnection(input: UpsertOauthConnectionInput) {
  const db = getDb();
  const existing = await db
    .select({ id: oauthConnection.id })
    .from(oauthConnection)
    .where(
      and(
        eq(oauthConnection.workspaceId, input.workspaceId),
        eq(oauthConnection.appId, input.appId),
        eq(oauthConnection.externalId, input.externalId),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(oauthConnection)
      .set({
        userId: input.userId,
        label: input.label,
        status: 'active',
        accessTokenCiphertext: input.accessTokenCiphertext,
        accessTokenIv: input.accessTokenIv,
        accessTokenTag: input.accessTokenTag,
        refreshTokenCiphertext: input.refreshTokenCiphertext ?? null,
        refreshTokenIv: input.refreshTokenIv ?? null,
        refreshTokenTag: input.refreshTokenTag ?? null,
        tokenType: input.tokenType ?? 'Bearer',
        expiresAt: input.expiresAt ?? null,
        grantedScopes: input.grantedScopes,
        identity: input.identity,
        lastError: null,
        lastSyncAt: new Date(),
      })
      .where(eq(oauthConnection.id, existing[0].id));
    return existing[0].id;
  }
  const inserted = await db
    .insert(oauthConnection)
    .values({
      workspaceId: input.workspaceId,
      appId: input.appId,
      userId: input.userId,
      externalId: input.externalId,
      label: input.label,
      status: 'active',
      accessTokenCiphertext: input.accessTokenCiphertext,
      accessTokenIv: input.accessTokenIv,
      accessTokenTag: input.accessTokenTag,
      refreshTokenCiphertext: input.refreshTokenCiphertext ?? null,
      refreshTokenIv: input.refreshTokenIv ?? null,
      refreshTokenTag: input.refreshTokenTag ?? null,
      tokenType: input.tokenType ?? 'Bearer',
      expiresAt: input.expiresAt ?? null,
      grantedScopes: input.grantedScopes,
      identity: input.identity,
      lastSyncAt: new Date(),
    })
    .returning();
  return inserted[0]!.id;
}

export async function deleteOauthConnection(workspaceId: string, id: string) {
  const db = getDb();
  await db
    .delete(oauthConnection)
    .where(and(eq(oauthConnection.workspaceId, workspaceId), eq(oauthConnection.id, id)));
}

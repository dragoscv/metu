/**
 * OAuth2 server-side helpers shared across all /api/oauth/* routes.
 * Token storage strategy:
 *   - We persist sha256(token) as `oauth_token.token_hash`.
 *   - Bearer prefix `metu_at_` for access tokens, `metu_rt_` for refresh, `metu_dc_` for device.
 *   - Lookup is by hash; raw tokens never round-trip back to the DB.
 */
import { and, eq, gt, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getDb } from '@metu/db';
import { oauthClient, oauthToken, type oauthTokenKind } from '@metu/db/schema';
import { TTL, expiresIn, hashToken, parseScopes, randomToken } from '@metu/auth/oauth';

export type TokenKind = (typeof oauthTokenKind.enumValues)[number];

const PREFIX: Record<TokenKind, string> = {
  authorization_code: 'metu_ac_',
  access_token: 'metu_at_',
  refresh_token: 'metu_rt_',
  device_code: 'metu_dc_',
};

export interface IssueTokenInput {
  workspaceId: string;
  clientUuid: string;
  userId?: string | null;
  deviceId?: string | null;
  kind: TokenKind;
  scopes: readonly string[];
  ttlSeconds: number;
  codeChallenge?: string | null;
  codeChallengeMethod?: string | null;
  redirectUri?: string | null;
  userCode?: string | null;
  metadata?: Record<string, unknown>;
  /**
   * Token-family id for refresh chain detection. If null, a new family is
   * created (one per fresh user grant). Pass-through on rotation so the entire
   * lineage can be revoked if a stale token is replayed.
   */
  familyId?: string | null;
}

export interface IssuedToken {
  /** The raw token to send to the client. Never persisted. */
  token: string;
  /** DB row id. */
  id: string;
  expiresAt: Date;
  /** Token-family id (shared across the rotation chain). */
  familyId: string;
}

export async function issueToken(input: IssueTokenInput): Promise<IssuedToken> {
  const raw = PREFIX[input.kind] + randomToken(32);
  const tokenHash = hashToken(raw);
  const expires = expiresIn(input.ttlSeconds);
  const familyId = input.familyId ?? randomUUID();

  const db = getDb();
  const [row] = await db
    .insert(oauthToken)
    .values({
      workspaceId: input.workspaceId,
      clientId: input.clientUuid,
      userId: input.userId ?? null,
      deviceId: input.deviceId ?? null,
      kind: input.kind,
      tokenHash,
      tokenFamilyId: familyId,
      scopes: input.scopes.join(' '),
      codeChallenge: input.codeChallenge ?? null,
      codeChallengeMethod: input.codeChallengeMethod ?? null,
      redirectUri: input.redirectUri ?? null,
      userCode: input.userCode ?? null,
      metadata: input.metadata ?? {},
      expiresAt: expires,
    })
    .returning();
  return { token: raw, id: row!.id, expiresAt: expires, familyId };
}

export async function findActiveTokenByHash(token: string, kind: TokenKind) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(oauthToken)
    .where(
      and(
        eq(oauthToken.tokenHash, hashToken(token)),
        eq(oauthToken.kind, kind),
        isNull(oauthToken.consumedAt),
        isNull(oauthToken.revokedAt),
        gt(oauthToken.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function consumeToken(id: string) {
  const db = getDb();
  await db.update(oauthToken).set({ consumedAt: new Date() }).where(eq(oauthToken.id, id));
}

/**
 * Look up a token by hash regardless of consumed/revoked state. Used to
 * detect replay of an already-rotated refresh token.
 */
export async function findTokenByHashAnyState(token: string, kind: TokenKind) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(oauthToken)
    .where(and(eq(oauthToken.tokenHash, hashToken(token)), eq(oauthToken.kind, kind)))
    .limit(1);
  return row ?? null;
}

/** Revoke every token in a refresh-token family (replay attack response). */
export async function revokeTokenFamily(familyId: string) {
  const db = getDb();
  await db
    .update(oauthToken)
    .set({ revokedAt: new Date() })
    .where(and(eq(oauthToken.tokenFamilyId, familyId), isNull(oauthToken.revokedAt)));
}

export async function revokeTokensForClient(clientUuid: string, userId: string) {
  const db = getDb();
  await db
    .update(oauthToken)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(oauthToken.clientId, clientUuid),
        eq(oauthToken.userId, userId),
        isNull(oauthToken.revokedAt),
      ),
    );
}

export async function findActiveClientByClientId(clientId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(oauthClient)
    .where(and(eq(oauthClient.clientId, clientId), isNull(oauthClient.revokedAt)))
    .limit(1);
  return row ?? null;
}

/** RFC 6749 §5.2 error response. */
export function oauthError(
  error:
    | 'invalid_request'
    | 'invalid_client'
    | 'invalid_grant'
    | 'unauthorized_client'
    | 'unsupported_grant_type'
    | 'invalid_scope'
    | 'access_denied'
    | 'server_error'
    | 'authorization_pending'
    | 'slow_down'
    | 'expired_token',
  description?: string,
  status: 400 | 401 | 403 | 500 = 400,
) {
  return new Response(JSON.stringify({ error, error_description: description }), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      pragma: 'no-cache',
    },
  });
}

/** Look up requested scopes against allowed list; downgrade silently to allowed subset. */
export function intersectScopes(requested: string, allowed: string): string[] {
  const req = parseScopes(requested);
  const allow = new Set(parseScopes(allowed));
  return req.filter((s) => allow.has(s));
}

export { TTL };

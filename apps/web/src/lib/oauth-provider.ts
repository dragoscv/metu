/**
 * OAuth2 server-side helpers shared across all /api/oauth/* routes.
 * Token storage strategy:
 *   - We persist sha256(token) as `oauth_token.token_hash`.
 *   - Bearer prefix `metu_at_` for access tokens, `metu_rt_` for refresh, `metu_dc_` for device.
 *   - Lookup is by hash; raw tokens never round-trip back to the DB.
 */
import { and, eq, gt, isNull, or, lt, sql } from 'drizzle-orm';
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
  if (row) {
    // Throttled liveness ping (max once / 60s) so /apps can show
    // "last seen 5m ago" for SDK-only clients without hammering the
    // DB on every recall/notify call. Fire-and-forget — we never
    // block auth resolution on the write.
    const sixtySecondsAgo = new Date(Date.now() - 60_000);
    void db
      .update(oauthToken)
      .set({ lastUsedAt: sql`now()` })
      .where(
        and(
          eq(oauthToken.id, row.id),
          or(isNull(oauthToken.lastUsedAt), lt(oauthToken.lastUsedAt, sixtySecondsAgo)),
        ),
      )
      .catch(() => {});
  }
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

/**
 * Client IDs whose authorization requests we auto-approve (skip the consent
 * screen) once the user is authenticated. Reserved for trusted first-party
 * desktop/mobile shells that ship with metu. Third-party apps always see the
 * consent screen. The companion uses a loopback-redirect + PKCE flow, so the
 * auth code can only be intercepted by the local process that initiated it.
 */
export const AUTO_APPROVE_CLIENT_IDS = new Set(['metu_app_companion']);

export function shouldAutoApprove(client: { type: string; clientId: string }): boolean {
  return client.type === 'first_party' || AUTO_APPROVE_CLIENT_IDS.has(client.clientId);
}

const isLoopbackHost = (h: string) =>
  h === '127.0.0.1' || h === '::1' || h === '[::1]' || h === 'localhost';

/**
 * Validate a candidate redirect_uri against a client's registered list.
 *
 * Exact match always wins. Additionally — per RFC 8252 §7.3 — native apps may
 * use a loopback interface (`http://127.0.0.1`, `http://[::1]`, `localhost`)
 * with an ephemeral port chosen at runtime. For those we ignore the port and
 * match on scheme + loopback host-class + path, provided the client has at
 * least one registered loopback redirect with the same path.
 */
export function isRedirectUriAllowed(registered: readonly string[], candidate: string): boolean {
  if (registered.includes(candidate)) return true;
  let cand: URL;
  try {
    cand = new URL(candidate);
  } catch {
    return false;
  }
  if (cand.protocol !== 'http:' || !isLoopbackHost(cand.hostname)) return false;
  return registered.some((r) => {
    let ru: URL;
    try {
      ru = new URL(r);
    } catch {
      return false;
    }
    return ru.protocol === 'http:' && isLoopbackHost(ru.hostname) && ru.pathname === cand.pathname;
  });
}

/**
 * Issue an `authorization_code` for the given grant and return the full
 * redirect URL (with `?code=…&state=…`) the browser should be sent to.
 * Shared by the consent `/decide` route and the auto-approve path in the
 * authorize page so both persist PKCE + redirect_uri identically.
 */
export async function issueAuthCodeRedirect(args: {
  workspaceId: string;
  clientUuid: string;
  userId: string;
  grantedScopes: string[];
  redirectUri: string;
  state?: string | null;
  codeChallenge?: string | null;
  codeChallengeMethod?: string | null;
}): Promise<string> {
  const issued = await issueToken({
    workspaceId: args.workspaceId,
    clientUuid: args.clientUuid,
    userId: args.userId,
    kind: 'authorization_code',
    scopes: args.grantedScopes,
    ttlSeconds: TTL.authorizationCode,
    codeChallenge: args.codeChallenge ?? null,
    codeChallengeMethod: args.codeChallengeMethod ?? null,
    redirectUri: args.redirectUri,
  });
  const url = new URL(args.redirectUri);
  url.searchParams.set('code', issued.token);
  if (args.state) url.searchParams.set('state', args.state);
  return url.toString();
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

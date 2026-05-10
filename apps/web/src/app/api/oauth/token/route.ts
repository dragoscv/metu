/**
 * Token endpoint (RFC 6749 §3.2 + §6, RFC 8628).
 *
 * Supported grant types:
 *   - authorization_code       (with PKCE)
 *   - refresh_token
 *   - urn:ietf:params:oauth:grant-type:device_code
 */
import { compareSecret, TTL, parseScopes, verifyPkce, type PkceMethod } from '@metu/auth/oauth';
import {
  consumeToken,
  findActiveClientByClientId,
  findActiveTokenByHash,
  findTokenByHashAnyState,
  issueToken,
  oauthError,
  revokeTokenFamily,
} from '@/lib/oauth-provider';
import { clientKey, rateLimit } from '@/lib/ratelimit';

export async function POST(req: Request) {
  const limited = await rateLimit('oauth-token', clientKey(req));
  if (limited) return limited;

  const ctype = req.headers.get('content-type') ?? '';
  if (!ctype.includes('application/x-www-form-urlencoded')) {
    return oauthError('invalid_request', 'Expected x-www-form-urlencoded body.');
  }
  const form = await req.formData();
  const grantType = String(form.get('grant_type') ?? '');

  // ─── Client auth (client_id + secret in body or Basic) ──────────────────
  const auth = parseClientAuth(req, form);
  if (!auth.clientId) {
    return oauthError('invalid_client', 'Missing client_id.', 401);
  }
  const client = await findActiveClientByClientId(auth.clientId);
  if (!client) return oauthError('invalid_client', 'Unknown client.', 401);

  if (client.type !== 'public') {
    if (!auth.clientSecret || !client.clientSecretHash) {
      return oauthError('invalid_client', 'Client secret required.', 401);
    }
    if (!compareSecret(auth.clientSecret, client.clientSecretHash)) {
      return oauthError('invalid_client', 'Bad client secret.', 401);
    }
  }

  switch (grantType) {
    case 'authorization_code':
      return handleAuthCode(form, client);
    case 'refresh_token':
      return handleRefresh(form, client);
    case 'urn:ietf:params:oauth:grant-type:device_code':
      return handleDeviceCode(form, client);
    default:
      return oauthError('unsupported_grant_type', `Grant type "${grantType}" is not supported.`);
  }
}

// ─── authorization_code ────────────────────────────────────────────────────

async function handleAuthCode(
  form: FormData,
  client: NonNullable<Awaited<ReturnType<typeof findActiveClientByClientId>>>,
) {
  const code = String(form.get('code') ?? '');
  const redirectUri = String(form.get('redirect_uri') ?? '');
  const verifier = String(form.get('code_verifier') ?? '');

  if (!code) return oauthError('invalid_request', 'Missing code.');
  const codeRow = await findActiveTokenByHash(code, 'authorization_code');
  if (!codeRow) return oauthError('invalid_grant', 'Code expired or already used.');
  if (codeRow.clientId !== client.id) {
    return oauthError('invalid_grant', 'Code was issued to a different client.');
  }
  if ((codeRow.redirectUri ?? '') !== redirectUri) {
    return oauthError('invalid_grant', 'redirect_uri does not match.');
  }
  if (codeRow.codeChallenge) {
    if (!verifier) return oauthError('invalid_request', 'Missing code_verifier.');
    const method = (codeRow.codeChallengeMethod as PkceMethod) ?? 'S256';
    if (method !== 'S256') {
      return oauthError('invalid_grant', 'Only S256 PKCE is supported.');
    }
    const ok = verifyPkce(verifier, codeRow.codeChallenge, method);
    if (!ok) return oauthError('invalid_grant', 'PKCE verification failed.');
  } else if (client.type === 'public') {
    return oauthError('invalid_grant', 'PKCE required.');
  }

  await consumeToken(codeRow.id);
  const scopes = parseScopes(codeRow.scopes);

  const access = await issueToken({
    workspaceId: codeRow.workspaceId,
    clientUuid: client.id,
    userId: codeRow.userId,
    kind: 'access_token',
    scopes,
    ttlSeconds: TTL.accessToken,
    familyId: codeRow.tokenFamilyId,
  });
  const includeRefresh = scopes.includes('offline_access');
  const refresh = includeRefresh
    ? await issueToken({
        workspaceId: codeRow.workspaceId,
        clientUuid: client.id,
        userId: codeRow.userId,
        kind: 'refresh_token',
        scopes,
        ttlSeconds: TTL.refreshToken,
        familyId: codeRow.tokenFamilyId,
      })
    : null;

  return tokenResponse({
    access_token: access.token,
    expires_in: TTL.accessToken,
    scope: scopes.join(' '),
    refresh_token: refresh?.token,
  });
}

// ─── refresh_token ─────────────────────────────────────────────────────────

async function handleRefresh(
  form: FormData,
  client: NonNullable<Awaited<ReturnType<typeof findActiveClientByClientId>>>,
) {
  const raw = String(form.get('refresh_token') ?? '');
  if (!raw) return oauthError('invalid_request', 'Missing refresh_token.');
  const row = await findActiveTokenByHash(raw, 'refresh_token');
  if (!row || row.clientId !== client.id) {
    // Replay detection: if the token exists but is consumed/revoked, treat
    // it as an attack and burn the entire family.
    const stale = await findTokenByHashAnyState(raw, 'refresh_token');
    if (stale && stale.tokenFamilyId) {
      await revokeTokenFamily(stale.tokenFamilyId);
    }
    return oauthError('invalid_grant', 'Refresh token invalid.');
  }
  const requested = parseScopes(String(form.get('scope') ?? row.scopes));
  const allowed = new Set(parseScopes(row.scopes));
  const scopes = requested.filter((s) => allowed.has(s));
  if (scopes.length === 0) return oauthError('invalid_scope');

  // Rotate the refresh token — propagate familyId so the lineage stays linked.
  await consumeToken(row.id);
  const next = await issueToken({
    workspaceId: row.workspaceId,
    clientUuid: client.id,
    userId: row.userId,
    kind: 'refresh_token',
    scopes,
    ttlSeconds: TTL.refreshToken,
    familyId: row.tokenFamilyId,
  });
  const access = await issueToken({
    workspaceId: row.workspaceId,
    clientUuid: client.id,
    userId: row.userId,
    kind: 'access_token',
    scopes,
    ttlSeconds: TTL.accessToken,
    familyId: row.tokenFamilyId,
  });
  return tokenResponse({
    access_token: access.token,
    expires_in: TTL.accessToken,
    scope: scopes.join(' '),
    refresh_token: next.token,
  });
}

// ─── device_code ───────────────────────────────────────────────────────────

async function handleDeviceCode(
  form: FormData,
  client: NonNullable<Awaited<ReturnType<typeof findActiveClientByClientId>>>,
) {
  const deviceCode = String(form.get('device_code') ?? '');
  if (!deviceCode) return oauthError('invalid_request');
  const row = await findActiveTokenByHash(deviceCode, 'device_code');
  if (!row || row.clientId !== client.id) {
    return oauthError('invalid_grant', 'Unknown device code.');
  }
  // The device-code row's userId is null until a user verifies it.
  if (!row.userId) {
    return oauthError('authorization_pending');
  }

  await consumeToken(row.id);
  const scopes = parseScopes(row.scopes);
  const access = await issueToken({
    workspaceId: row.workspaceId,
    clientUuid: client.id,
    userId: row.userId,
    kind: 'access_token',
    scopes,
    ttlSeconds: TTL.accessToken,
    familyId: row.tokenFamilyId,
  });
  const includeRefresh = scopes.includes('offline_access');
  const refresh = includeRefresh
    ? await issueToken({
        workspaceId: row.workspaceId,
        clientUuid: client.id,
        userId: row.userId,
        kind: 'refresh_token',
        scopes,
        ttlSeconds: TTL.refreshToken,
        familyId: row.tokenFamilyId,
      })
    : null;
  return tokenResponse({
    access_token: access.token,
    expires_in: TTL.accessToken,
    scope: scopes.join(' '),
    refresh_token: refresh?.token,
  });
}

// ─── helpers ───────────────────────────────────────────────────────────────

function parseClientAuth(req: Request, form: FormData) {
  const authz = req.headers.get('authorization');
  if (authz?.startsWith('Basic ')) {
    try {
      const decoded = atob(authz.slice(6));
      const idx = decoded.indexOf(':');
      if (idx > 0) {
        return {
          clientId: decoded.slice(0, idx),
          clientSecret: decoded.slice(idx + 1),
        };
      }
    } catch {
      // fall through
    }
  }
  return {
    clientId: String(form.get('client_id') ?? ''),
    clientSecret: form.has('client_secret') ? String(form.get('client_secret')) : null,
  };
}

interface TokenBody {
  access_token: string;
  expires_in: number;
  scope: string;
  refresh_token?: string;
}

function tokenResponse(body: TokenBody) {
  return new Response(
    JSON.stringify({
      ...body,
      token_type: 'Bearer',
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        pragma: 'no-cache',
      },
    },
  );
}

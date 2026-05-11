/**
 * Bearer-token auth for non-browser clients (mobile, browser-ext, VS Code ext,
 * external OAuth apps via @metu/sdk).
 *
 * Three accepted credentials, in priority order:
 *   1. Auth.js session cookie (browser).
 *   2. OAuth2 access token issued via /api/oauth/token (external apps).
 *   3. Dev env-bound bearer (METU_DEV_API_TOKEN) — local development only.
 *
 * Endpoints that should be scope-checked must inspect `session.scopes`.
 * For session-cookie auth the scope set is `['*']` (full workspace access).
 */
import { auth } from '@metu/auth';
import { parseScopes } from '@metu/auth/oauth';
import { findActiveTokenByHash } from './oauth-provider';
import { safeEqual } from './safe-equal';

// Module-load assertion: in any non-test environment, if the dev token is
// configured at all it MUST be at least 32 chars. Stops a 4-char placeholder
// like `dev` from accidentally granting full workspace access in CI / preview.
const DEV_TOKEN_MIN_LEN = 32;
if (
  process.env.NODE_ENV !== 'test' &&
  process.env.METU_DEV_API_TOKEN &&
  process.env.METU_DEV_API_TOKEN.length < DEV_TOKEN_MIN_LEN
) {
  throw new Error(
    `METU_DEV_API_TOKEN must be ≥ ${DEV_TOKEN_MIN_LEN} chars; got ${process.env.METU_DEV_API_TOKEN.length}.`,
  );
}

export interface ResolvedSession {
  workspaceId: string;
  userId: string;
  /** OAuth scopes granted to this credential. `['*']` for cookie/dev. */
  scopes: string[];
  /** OAuth client id when authenticated via access token, else null. */
  clientId: string | null;
}

export async function resolveSession(req: Request): Promise<ResolvedSession | null> {
  // 1) Auth.js session cookie.
  const s = await auth();
  if (s?.user) {
    return {
      workspaceId: s.user.workspaceId,
      userId: s.user.id!,
      scopes: ['*'],
      clientId: null,
    };
  }

  const h = req.headers.get('authorization');
  if (!h?.startsWith('Bearer ')) return null;
  const tok = h.slice(7);

  // 2) OAuth2 access token.
  if (tok.startsWith('metu_at_')) {
    const row = await findActiveTokenByHash(tok, 'access_token');
    if (row && row.userId) {
      return {
        workspaceId: row.workspaceId,
        userId: row.userId,
        scopes: parseScopes(row.scopes),
        clientId: row.clientId,
      };
    }
    return null;
  }

  // 3) Dev token. Only honored outside production.
  if (process.env.NODE_ENV !== 'production') {
    const devTok = process.env.METU_DEV_API_TOKEN;
    const wsId = process.env.METU_DEV_WORKSPACE_ID;
    const userId = process.env.METU_DEV_USER_ID;
    if (devTok && safeEqual(tok, devTok) && wsId && userId) {
      return {
        workspaceId: wsId,
        userId,
        scopes: ['*'],
        clientId: null,
      };
    }
  }
  return null;
}

/** True if the session has any of the requested scopes (or `*`). */
export function hasScope(session: ResolvedSession, ...required: string[]): boolean {
  if (session.scopes.includes('*')) return true;
  return required.some((s) => session.scopes.includes(s));
}

export function unauthorized(reason = 'unauthorized') {
  return new Response(JSON.stringify({ ok: false, error: reason }), {
    status: 401,
    headers: {
      'content-type': 'application/json',
      'www-authenticate': 'Bearer realm="metu"',
    },
  });
}

export function forbidden(reason = 'insufficient_scope') {
  return new Response(JSON.stringify({ ok: false, error: reason }), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  });
}

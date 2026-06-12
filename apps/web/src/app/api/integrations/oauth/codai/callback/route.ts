/**
 * GET /api/integrations/oauth/codai/callback
 *
 * Completes the "Connect with Codai" flow:
 *   1. Validate state + exchange the authorization code (PKCE) at
 *      auth.codai.ro/token for an access token.
 *   2. Exchange the access token at auth.codai.ro/connect/key for a scoped
 *      codai inference key (minted once, bound to the OAuth grant).
 *   3. Store the key as the workspace's codai provider credential (reusing
 *      connectCodai's seal/store path).
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { auth } from '@metu/auth';
import { safeEqual } from '@/lib/safe-equal';
import { log } from '@/lib/logger';
import { connectCodai } from '@/app/actions/codai';

const CODAI_AUTH_BASE = (process.env.CODAI_AUTH_URL ?? 'https://auth.codai.ro').replace(/\/+$/, '');
const CODAI_CLIENT_ID = process.env.CODAI_OAUTH_CLIENT_ID ?? 'metu';

function appBase(): string {
  return (
    process.env.AUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    'http://localhost:24890'
  ).replace(/\/+$/, '');
}

function settingsRedirect(req: Request, query: string): NextResponse {
  return NextResponse.redirect(new URL(`/settings?${query}`, req.url));
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session) return NextResponse.redirect(new URL('/sign-in', req.url));

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  const cookieStore = await cookies();
  const stateCookie = cookieStore.get('codai_oauth_state')?.value;
  const verifier = cookieStore.get('codai_oauth_verifier')?.value;
  cookieStore.delete('codai_oauth_state');
  cookieStore.delete('codai_oauth_verifier');

  if (oauthError) {
    return settingsRedirect(req, `codai_error=${encodeURIComponent(oauthError)}`);
  }
  if (!code || !state || !stateCookie || !safeEqual(state, stateCookie) || !verifier) {
    return settingsRedirect(req, 'codai_error=state_mismatch');
  }

  // 1. Exchange the authorization code for tokens (public PKCE client).
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: `${appBase()}/api/integrations/oauth/codai/callback`,
    client_id: CODAI_CLIENT_ID,
    code_verifier: verifier,
  });
  const tokenRes = await fetch(`${CODAI_AUTH_BASE}/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: tokenBody.toString(),
  });
  if (!tokenRes.ok) {
    const detail = await tokenRes.text().catch(() => '');
    log.error('codai.oauth.token_exchange_failed', {
      status: tokenRes.status,
      detail: detail.slice(0, 500),
    });
    return settingsRedirect(req, `codai_error=token_${tokenRes.status}`);
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  const accessToken = tokenJson.access_token;
  if (!accessToken) {
    return settingsRedirect(req, 'codai_error=no_access_token');
  }

  // 2. Exchange the access token for a scoped codai inference key.
  const keyRes = await fetch(`${CODAI_AUTH_BASE}/connect/key`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  });
  if (!keyRes.ok) {
    const detail = await keyRes.text().catch(() => '');
    log.error('codai.oauth.key_exchange_failed', {
      status: keyRes.status,
      detail: detail.slice(0, 500),
    });
    return settingsRedirect(req, `codai_error=key_${keyRes.status}`);
  }
  const keyJson = (await keyRes.json()) as { api_key?: string | null; already_issued?: boolean };
  if (!keyJson.api_key) {
    // already_issued with no plaintext → the grant already minted a key that
    // we never stored. The user must disconnect on codai's side to re-issue.
    return settingsRedirect(req, 'codai_error=key_already_issued');
  }

  // 3. Store it as the workspace codai provider credential.
  const stored = await connectCodai({ apiKey: keyJson.api_key });
  if (!stored.ok) {
    return settingsRedirect(
      req,
      `codai_error=${encodeURIComponent(stored.error ?? 'store_failed')}`,
    );
  }

  return settingsRedirect(req, 'codai_connected=1');
}

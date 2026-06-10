/**
 * GET /api/integrations/oauth/codai/start
 *
 * Begins the "Connect with Codai" OAuth 2.1 + PKCE flow. Redirects the user to
 * auth.codai.ro/auth. The codai flow is bespoke (not part of the generic
 * `[kind]` integration framework) because on completion we mint + store a
 * scoped codai inference key as a provider credential, not a generic
 * integration token.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { auth } from '@metu/auth';
import { newPkce, randomUrlSafe } from '@/lib/oauth/pkce';

const COOKIE_TTL_S = 600;

export const runtime = 'nodejs';

const CODAI_AUTH_BASE = process.env.CODAI_AUTH_URL ?? 'https://auth.codai.ro';
const CODAI_CLIENT_ID = process.env.CODAI_OAUTH_CLIENT_ID ?? 'metu';
const CODAI_SCOPES = 'openid profile email inference keys:manage usage:read subscriptions:read';

function appBase(): string {
  return (
    process.env.AUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    'http://localhost:24890'
  ).replace(/\/+$/, '');
}

function callbackUrl(): string {
  return `${appBase()}/api/integrations/oauth/codai/callback`;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session) return NextResponse.redirect(new URL('/sign-in', req.url));

  const state = randomUrlSafe(24);
  const nonce = randomUrlSafe(24);
  const pkce = newPkce();

  const url = new URL(`${CODAI_AUTH_BASE.replace(/\/+$/, '')}/auth`);
  url.searchParams.set('client_id', CODAI_CLIENT_ID);
  url.searchParams.set('redirect_uri', callbackUrl());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', CODAI_SCOPES);
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', pkce.challenge);
  url.searchParams.set('code_challenge_method', 'S256');

  const cookieStore = await cookies();
  const opts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: COOKIE_TTL_S,
  };
  cookieStore.set('codai_oauth_state', state, opts);
  cookieStore.set('codai_oauth_verifier', pkce.verifier, opts);

  return NextResponse.redirect(url.toString());
}

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { auth } from '@metu/auth';
import { integrationKindSchema } from '@metu/types';
import { resolveOauthConfig } from '@/lib/integrations/effective-oauth-config';
import { newPkce, randomUrlSafe } from '@/lib/oauth/pkce';

const COOKIE_TTL_S = 600;

function callbackUrlFor(kind: string): string {
  const base = process.env.AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:24890';
  return `${base.replace(/\/+$/, '')}/api/integrations/oauth/${kind}/callback`;
}

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.redirect(new URL('/sign-in', req.url));

  const { kind: rawKind } = await params;
  const kindParse = integrationKindSchema.safeParse(rawKind);
  if (!kindParse.success) {
    return NextResponse.redirect(new URL('/integrations?oauth_error=invalid_kind', req.url));
  }
  const kind = kindParse.data;
  const resolved = await resolveOauthConfig(session.user.workspaceId, kind);
  if (!resolved) {
    return NextResponse.redirect(
      new URL(
        `/integrations?oauth_error=${encodeURIComponent(`${kind}_oauth_not_configured`)}`,
        req.url,
      ),
    );
  }
  const { clientId, ...cfg } = resolved;
  const state = randomUrlSafe(24);
  const pkce = cfg.pkce ? newPkce() : null;
  const redirectUri = callbackUrlFor(kind);

  const url = new URL(cfg.authorizeUrl);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  if (cfg.scope) url.searchParams.set('scope', cfg.scope);
  url.searchParams.set('state', state);
  if (pkce) {
    url.searchParams.set('code_challenge', pkce.challenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  for (const [k, v] of Object.entries(cfg.extraAuthParams)) {
    url.searchParams.set(k, v);
  }

  const cookieStore = await cookies();
  const opts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: COOKIE_TTL_S,
  };
  cookieStore.set(`int_oauth_state_${kind}`, state, opts);
  if (pkce) cookieStore.set(`int_oauth_verifier_${kind}`, pkce.verifier, opts);

  return NextResponse.redirect(url.toString());
}

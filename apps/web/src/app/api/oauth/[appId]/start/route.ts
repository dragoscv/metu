import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { auth } from '@metu/auth';
import { getOauthApp } from '@metu/db/queries';
import { callbackUrl, newPkce, randomUrlSafe } from '@/lib/oauth/pkce';

const COOKIE_TTL_S = 600; // 10 min

export async function GET(_req: Request, { params }: { params: Promise<{ appId: string }> }) {
  const session = await auth();
  if (!session) {
    return NextResponse.redirect(new URL('/sign-in', _req.url));
  }
  const { appId } = await params;
  const app = await getOauthApp(session.user.workspaceId, appId);
  if (!app) {
    return NextResponse.json({ error: 'oauth_app_not_found' }, { status: 404 });
  }

  const state = randomUrlSafe(24);
  const pkce = app.pkce ? newPkce() : null;
  const redirectUri = callbackUrl(app.id);

  const url = new URL(app.authorizeUrl);
  url.searchParams.set('client_id', app.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  if (app.scopes) url.searchParams.set('scope', app.scopes);
  url.searchParams.set('state', state);
  if (pkce) {
    url.searchParams.set('code_challenge', pkce.challenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }

  const cookieStore = await cookies();
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: COOKIE_TTL_S,
  };
  cookieStore.set(`oauth_state_${appId}`, state, cookieOpts);
  if (pkce) cookieStore.set(`oauth_verifier_${appId}`, pkce.verifier, cookieOpts);

  return NextResponse.redirect(url.toString());
}

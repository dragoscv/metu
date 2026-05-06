import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { auth } from '@metu/auth';
import { getOauthApp, upsertOauthConnection } from '@metu/db/queries';
import { open, seal } from '@metu/ai/crypto';
import { callbackUrl } from '@/lib/oauth/pkce';
import { probeUserinfo } from '@/lib/oauth/discover';

export async function GET(req: Request, { params }: { params: Promise<{ appId: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.redirect(new URL('/sign-in', req.url));

  const { appId } = await params;
  const app = await getOauthApp(session.user.workspaceId, appId);
  if (!app) {
    return NextResponse.redirect(new URL('/integrations?oauth_error=app_not_found', req.url));
  }

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  const cookieStore = await cookies();
  const stateCookie = cookieStore.get(`oauth_state_${appId}`)?.value;
  const verifier = cookieStore.get(`oauth_verifier_${appId}`)?.value;
  cookieStore.delete(`oauth_state_${appId}`);
  cookieStore.delete(`oauth_verifier_${appId}`);

  if (oauthError) {
    return NextResponse.redirect(
      new URL(`/integrations?oauth_error=${encodeURIComponent(oauthError)}`, req.url),
    );
  }
  if (!code || !state || !stateCookie || state !== stateCookie) {
    return NextResponse.redirect(new URL('/integrations?oauth_error=state_mismatch', req.url));
  }

  // Decrypt client secret
  let clientSecret: string;
  try {
    clientSecret = open({
      ciphertext: app.clientSecretCiphertext,
      iv: app.clientSecretIv,
      tag: app.clientSecretTag,
    });
  } catch {
    return NextResponse.redirect(
      new URL('/integrations?oauth_error=secret_unsealed_failed', req.url),
    );
  }

  // Exchange code for token
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: callbackUrl(app.id),
    client_id: app.clientId,
    client_secret: clientSecret,
  });
  if (verifier) body.set('code_verifier', verifier);

  const tokenRes = await fetch(app.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text().catch(() => '');
    console.error('[oauth] token exchange failed', tokenRes.status, text.slice(0, 500));
    return NextResponse.redirect(
      new URL(`/integrations?oauth_error=token_${tokenRes.status}`, req.url),
    );
  }

  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    token_type?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!tokenJson.access_token) {
    return NextResponse.redirect(new URL('/integrations?oauth_error=no_access_token', req.url));
  }

  // Probe identity
  let probe: Awaited<ReturnType<typeof probeUserinfo>>;
  try {
    probe = await probeUserinfo(tokenJson.access_token, app.userinfoUrl);
  } catch (err) {
    probe = {
      externalId: `${Date.now()}`,
      label: app.name,
      identity: {
        userinfo_error: err instanceof Error ? err.message : String(err),
      },
    };
  }

  // Seal tokens
  const accessSealed = seal(tokenJson.access_token);
  const refreshSealed = tokenJson.refresh_token ? seal(tokenJson.refresh_token) : null;

  await upsertOauthConnection({
    workspaceId: session.user.workspaceId,
    appId: app.id,
    userId: session.user.id,
    externalId: probe.externalId,
    label: probe.label,
    accessTokenCiphertext: accessSealed.ciphertext,
    accessTokenIv: accessSealed.iv,
    accessTokenTag: accessSealed.tag,
    refreshTokenCiphertext: refreshSealed?.ciphertext ?? null,
    refreshTokenIv: refreshSealed?.iv ?? null,
    refreshTokenTag: refreshSealed?.tag ?? null,
    tokenType: tokenJson.token_type ?? 'Bearer',
    expiresAt: tokenJson.expires_in ? new Date(Date.now() + tokenJson.expires_in * 1000) : null,
    grantedScopes: tokenJson.scope ?? app.scopes,
    identity: probe.identity,
  });

  return NextResponse.redirect(
    new URL(`/integrations?oauth_connected=${encodeURIComponent(app.slug)}`, req.url),
  );
}

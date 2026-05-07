import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { auth } from '@metu/auth';
import { integrationKindSchema } from '@metu/types';
import { upsertIntegration } from '@metu/db/queries';
import { seal } from '@metu/ai/crypto';
import { webOauthConfig } from '@/lib/integrations/web-oauth-config';
import { verifyIntegrationToken } from '@/lib/integrations/verifiers';

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
  const resolved = webOauthConfig(kind);
  if (!resolved) {
    return NextResponse.redirect(
      new URL('/integrations?oauth_error=oauth_not_configured', req.url),
    );
  }
  const { clientId, clientSecret, cfg } = resolved;

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  const cookieStore = await cookies();
  const stateCookie = cookieStore.get(`int_oauth_state_${kind}`)?.value;
  const verifier = cookieStore.get(`int_oauth_verifier_${kind}`)?.value;
  cookieStore.delete(`int_oauth_state_${kind}`);
  cookieStore.delete(`int_oauth_verifier_${kind}`);

  if (oauthError) {
    return NextResponse.redirect(
      new URL(`/integrations?oauth_error=${encodeURIComponent(oauthError)}`, req.url),
    );
  }
  if (!code || !state || !stateCookie || state !== stateCookie) {
    return NextResponse.redirect(new URL('/integrations?oauth_error=state_mismatch', req.url));
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: callbackUrlFor(kind),
    client_id: clientId,
    client_secret: clientSecret,
  });
  if (verifier) body.set('code_verifier', verifier);

  const tokenRes = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text().catch(() => '');
    console.error(
      '[integrations.oauth] token exchange failed',
      kind,
      tokenRes.status,
      text.slice(0, 500),
    );
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
    // Slack returns nested authed_user
    authed_user?: { access_token?: string };
  };
  const accessToken = tokenJson.access_token ?? tokenJson.authed_user?.access_token;
  if (!accessToken) {
    return NextResponse.redirect(new URL('/integrations?oauth_error=no_access_token', req.url));
  }

  // Reuse the existing verifier for identity
  const verify = await verifyIntegrationToken(kind, accessToken);
  if (!verify.ok) {
    return NextResponse.redirect(
      new URL(
        `/integrations?oauth_error=${encodeURIComponent(`verify_failed:${verify.error}`)}`,
        req.url,
      ),
    );
  }

  const sealed = seal(accessToken);
  await upsertIntegration({
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
    kind,
    externalId: verify.externalId,
    label: verify.label,
    tokenCiphertext: sealed.ciphertext,
    tokenIv: sealed.iv,
    tokenTag: sealed.tag,
    config: {
      ...(verify.metadata ?? {}),
      connectedVia: 'web-oauth',
      grantedScopes: tokenJson.scope ?? cfg.scope,
      tokenType: tokenJson.token_type ?? 'Bearer',
      expiresAt: tokenJson.expires_in
        ? new Date(Date.now() + tokenJson.expires_in * 1000).toISOString()
        : null,
    },
  });

  return NextResponse.redirect(new URL(`/integrations?oauth_connected=${kind}`, req.url));
}

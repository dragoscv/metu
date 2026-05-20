import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { auth } from '@metu/auth';
import { integrationKindSchema } from '@metu/types';
import { upsertIntegration } from '@metu/db/queries';
import { seal } from '@metu/ai/crypto';
import { safeEqual } from '@/lib/safe-equal';
import { resolveOauthConfig } from '@/lib/integrations/effective-oauth-config';
import { verifyIntegrationToken, isTokenIntegration } from '@/lib/integrations/verifiers';
import { inngest } from '@/inngest/client';
import { log } from '@/lib/logger';

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
      new URL('/integrations?oauth_error=oauth_not_configured', req.url),
    );
  }
  const { clientId, clientSecret, ...cfg } = resolved;

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
  if (!code || !state || !stateCookie || !safeEqual(state, stateCookie)) {
    return NextResponse.redirect(new URL('/integrations?oauth_error=state_mismatch', req.url));
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: callbackUrlFor(kind),
  });
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  if (cfg.tokenAuthMethod === 'client_secret_basic') {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  } else {
    body.set('client_id', clientId);
    body.set('client_secret', clientSecret);
  }
  if (verifier) body.set('code_verifier', verifier);

  const tokenRes = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers,
    body: body.toString(),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text().catch(() => '');
    log.error('integrations.oauth.token_exchange_failed', {
      kind,
      status: tokenRes.status,
      detail: text.slice(0, 500),
    });
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

  // Reuse the existing verifier for identity. For platforms without a
  // dedicated verifier, accept the OAuth provider's verdict and synthesize
  // a placeholder identity — the per-platform sync function will fill in
  // real account metadata on first run.
  let externalId: string;
  let label: string;
  let metadata: Record<string, unknown> = {};
  if (isTokenIntegration(kind)) {
    const verify = await verifyIntegrationToken(kind, accessToken);
    if (!verify.ok) {
      return NextResponse.redirect(
        new URL(
          `/integrations?oauth_error=${encodeURIComponent(`verify_failed:${verify.error}`)}`,
          req.url,
        ),
      );
    }
    externalId = verify.externalId;
    label = verify.label;
    metadata = verify.metadata ?? {};
  } else {
    externalId = `${kind}:${session.user.workspaceId.slice(0, 8)}`;
    label = `${kind} (pending sync)`;
  }

  const sealed = seal(accessToken);
  const integrationId = await upsertIntegration({
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
    kind,
    externalId,
    label,
    tokenCiphertext: sealed.ciphertext,
    tokenIv: sealed.iv,
    tokenTag: sealed.tag,
    config: {
      ...metadata,
      connectedVia: 'web-oauth',
      configSource: cfg.source,
      grantedScopes: tokenJson.scope ?? cfg.scope,
      tokenType: tokenJson.token_type ?? 'Bearer',
      expiresAt: tokenJson.expires_in
        ? new Date(Date.now() + tokenJson.expires_in * 1000).toISOString()
        : null,
    },
  });

  // Kick off an immediate backfill for kinds that have a sync function.
  const SYNCABLE = [
    'slack',
    'gcal',
    'linear',
    'reddit',
    'twitter',
    'youtube',
    'spotify',
    'instagram',
    'notion',
    'stripe',
    'vercel',
  ] as const;
  if ((SYNCABLE as readonly string[]).includes(kind)) {
    try {
      await inngest.send({
        name: `${kind}/sync.requested` as `${(typeof SYNCABLE)[number]}/sync.requested`,
        data: { workspaceId: session.user.workspaceId, integrationId, reason: 'connect' },
      });
    } catch (err) {
      log.warn('integration.sync.kickoff_failed', { kind, err: String(err) });
    }
  }

  return NextResponse.redirect(new URL(`/integrations?oauth_connected=${kind}`, req.url));
}

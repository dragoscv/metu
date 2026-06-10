/**
 * Authorization endpoint (RFC 6749 §3.1).
 *
 * GET  → validates client + redirect_uri + scope, then renders the consent UI
 *        (server-rendered Tailwind page below). User must already be signed in.
 * POST → submitted by the consent form. Issues an `authorization_code` token,
 *        302-redirects to redirect_uri with ?code=…&state=…
 */
import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import {
  findActiveClientByClientId,
  intersectScopes,
  isRedirectUriAllowed,
  issueAuthCodeRedirect,
  shouldAutoApprove,
} from '@/lib/oauth-provider';
import { ConsentForm } from './consent-form';

interface AuthorizeParams {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  prompt?: string;
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<AuthorizeParams>;
}) {
  const params = await searchParams;
  const session = await auth();
  if (!session) {
    const callback = `/api/oauth/authorize?${new URLSearchParams(
      Object.entries(params).filter(([, v]) => v != null) as [string, string][],
    ).toString()}`;
    redirect(`/sign-in?callbackUrl=${encodeURIComponent(callback)}`);
  }

  // ─── Validate ────────────────────────────────────────────────────────────
  if (params.response_type !== 'code') {
    return errorPage('unsupported_response_type', 'Only response_type=code is supported.');
  }
  if (!params.client_id) return errorPage('invalid_request', 'Missing client_id.');
  if (!params.redirect_uri) return errorPage('invalid_request', 'Missing redirect_uri.');

  const client = await findActiveClientByClientId(params.client_id);
  if (!client) return errorPage('invalid_client', 'Unknown client.');

  // Workspace scoping: the user must be signed into the workspace that owns the client.
  if (client.workspaceId !== session.user.workspaceId) {
    return errorPage(
      'access_denied',
      'This app belongs to a different workspace. Switch workspaces and try again.',
    );
  }

  // Redirect URI must exactly match one of the registered values.
  const allowedRedirects = (client.redirectUris as string[]) ?? [];
  if (!isRedirectUriAllowed(allowedRedirects, params.redirect_uri)) {
    return errorPage('invalid_request', 'redirect_uri is not registered for this client.');
  }

  // PKCE required for public clients; recommended for everyone.
  if (client.type === 'public' && !params.code_challenge) {
    return errorPage('invalid_request', 'PKCE (code_challenge) is required for public clients.');
  }
  // Only S256 is accepted. `plain` is a downgrade-attack vector.
  if (params.code_challenge && (params.code_challenge_method ?? 'S256') !== 'S256') {
    return errorPage('invalid_request', 'Only S256 PKCE is supported.');
  }

  const grantedScopes = intersectScopes(params.scope ?? '', client.allowedScopes);
  if (grantedScopes.length === 0) {
    return errorPage('invalid_scope', 'No requested scopes are allowed for this client.');
  }

  // ─── Auto-approve (trusted first-party shells) ─────────────────────────────
  // The companion uses loopback-redirect + PKCE, so the auth code can only be
  // intercepted by the local process that started the flow. Skip the consent
  // screen and redirect straight back with a code — the user only had to sign
  // in. Third-party apps still see the consent screen below.
  if (shouldAutoApprove(client)) {
    const codeChallengeMethod =
      params.code_challenge_method ?? (params.code_challenge ? 'S256' : null);
    const target = await issueAuthCodeRedirect({
      workspaceId: client.workspaceId,
      clientUuid: client.id,
      userId: session.user.id,
      grantedScopes,
      redirectUri: params.redirect_uri,
      state: params.state ?? null,
      codeChallenge: params.code_challenge ?? null,
      codeChallengeMethod,
    });
    redirect(target);
  }

  return (
    <ConsentForm
      app={{
        name: client.name,
        iconUrl: client.iconUrl,
        type: client.type,
      }}
      grantedScopes={grantedScopes}
      params={params as Record<string, string>}
    />
  );
}

function errorPage(code: string, msg: string) {
  return (
    <main className="mx-auto max-w-md p-10">
      <h1 className="text-2xl font-semibold">Authorization failed</h1>
      <p className="mt-2 text-sm text-[var(--color-fg-muted)]">{code}</p>
      <p className="mt-2 text-sm">{msg}</p>
    </main>
  );
}

/**
 * Form-target for /api/oauth/authorize consent. Issues the auth code and
 * redirects back to the client's redirect_uri.
 */
import { auth } from '@metu/auth';
import { findActiveClientByClientId, intersectScopes, issueToken } from '@/lib/oauth-provider';
import { TTL } from '@metu/auth/oauth';
import { clientKey, rateLimit } from '@/lib/ratelimit';

export async function POST(req: Request) {
  const limited = await rateLimit('oauth-authorize', clientKey(req));
  if (limited) return limited;

  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });

  const form = await req.formData();
  const decision = form.get('decision');
  const params = JSON.parse(String(form.get('params') ?? '{}')) as Record<string, string>;
  const submittedScopes = String(form.get('granted_scopes') ?? '')
    .split(/\s+/)
    .filter(Boolean);

  const client = await findActiveClientByClientId(params.client_id ?? '');
  if (!client) return new Response('invalid_client', { status: 400 });
  if (client.workspaceId !== session.user.workspaceId) {
    return new Response('workspace mismatch', { status: 403 });
  }
  const allowedRedirects = (client.redirectUris as string[]) ?? [];
  if (!allowedRedirects.includes(params.redirect_uri ?? '')) {
    return new Response('invalid redirect_uri', { status: 400 });
  }

  if (decision !== 'allow') {
    const url = new URL(params.redirect_uri!);
    url.searchParams.set('error', 'access_denied');
    if (params.state) url.searchParams.set('state', params.state);
    return Response.redirect(url.toString(), 302);
  }

  // Re-intersect against client.allowedScopes AND against the request's
  // `scope` param. The hidden form field is user-controllable, so we never
  // trust it as the authority. This collapses any tampered-scope payload
  // back to what the client is actually allowed to ask for.
  const requestAllowed = new Set(intersectScopes(params.scope ?? '', client.allowedScopes));
  const grantedScopes = submittedScopes.filter((s) => requestAllowed.has(s));
  if (grantedScopes.length === 0) {
    return new Response('invalid_scope', { status: 400 });
  }

  // PKCE: require S256. `plain` is a downgrade; reject explicit `plain`.
  const codeChallengeMethod =
    params.code_challenge_method ?? (params.code_challenge ? 'S256' : null);
  if (params.code_challenge && codeChallengeMethod !== 'S256') {
    return new Response('invalid_request: only S256 PKCE is supported', { status: 400 });
  }

  const issued = await issueToken({
    workspaceId: client.workspaceId,
    clientUuid: client.id,
    userId: session.user.id,
    kind: 'authorization_code',
    scopes: grantedScopes,
    ttlSeconds: TTL.authorizationCode,
    codeChallenge: params.code_challenge ?? null,
    codeChallengeMethod,
    redirectUri: params.redirect_uri ?? null,
  });

  const redirectUrl = new URL(params.redirect_uri!);
  redirectUrl.searchParams.set('code', issued.token);
  if (params.state) redirectUrl.searchParams.set('state', params.state);
  return Response.redirect(redirectUrl.toString(), 302);
}

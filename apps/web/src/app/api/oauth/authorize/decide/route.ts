/**
 * Form-target for /api/oauth/authorize consent. Issues the auth code and
 * redirects back to the client's redirect_uri.
 */
import { auth } from '@metu/auth';
import { findActiveClientByClientId, issueToken } from '@/lib/oauth-provider';
import { TTL } from '@metu/auth/oauth';

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });

  const form = await req.formData();
  const decision = form.get('decision');
  const params = JSON.parse(String(form.get('params') ?? '{}')) as Record<string, string>;
  const grantedScopes = String(form.get('granted_scopes') ?? '')
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

  const issued = await issueToken({
    workspaceId: client.workspaceId,
    clientUuid: client.id,
    userId: session.user.id,
    kind: 'authorization_code',
    scopes: grantedScopes,
    ttlSeconds: TTL.authorizationCode,
    codeChallenge: params.code_challenge ?? null,
    codeChallengeMethod: params.code_challenge_method ?? null,
    redirectUri: params.redirect_uri ?? null,
  });

  const redirectUrl = new URL(params.redirect_uri!);
  redirectUrl.searchParams.set('code', issued.token);
  if (params.state) redirectUrl.searchParams.set('state', params.state);
  return Response.redirect(redirectUrl.toString(), 302);
}

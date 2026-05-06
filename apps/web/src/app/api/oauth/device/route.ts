/**
 * Device authorization endpoint (RFC 8628 §3.1).
 *
 * The device polls /api/oauth/token with grant_type=device_code; the user
 * separately visits the verification_uri (rendered at /devices/verify) and
 * approves with a short user_code.
 */
import {
  findActiveClientByClientId,
  intersectScopes,
  issueToken,
  oauthError,
} from '@/lib/oauth-provider';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import { TTL, generateUserCode } from '@metu/auth/oauth';

export async function POST(req: Request) {
  const limited = await rateLimit('oauth-device', clientKey(req));
  if (limited) return limited;

  const form = await req.formData();
  const clientId = String(form.get('client_id') ?? '');
  if (!clientId) return oauthError('invalid_request', 'Missing client_id.');
  const client = await findActiveClientByClientId(clientId);
  if (!client) return oauthError('invalid_client', undefined, 401);

  const requestedScope = String(form.get('scope') ?? '');
  const grantedScopes = intersectScopes(requestedScope, client.allowedScopes);
  if (grantedScopes.length === 0)
    return oauthError('invalid_scope', 'No scopes are allowed for this client.');

  const userCode = generateUserCode();
  const issued = await issueToken({
    workspaceId: client.workspaceId,
    clientUuid: client.id,
    userId: null,
    kind: 'device_code',
    scopes: grantedScopes,
    ttlSeconds: TTL.deviceCode,
    userCode,
  });

  const url = new URL(req.url);
  const issuer = `${url.protocol}//${url.host}`;
  return Response.json(
    {
      device_code: issued.token,
      user_code: userCode,
      verification_uri: `${issuer}/devices/verify`,
      verification_uri_complete: `${issuer}/devices/verify?code=${encodeURIComponent(userCode)}`,
      expires_in: TTL.deviceCode,
      interval: 5,
    },
    {
      headers: {
        'cache-control': 'no-store',
      },
    },
  );
}

/**
 * OpenID Connect discovery document (subset).
 * Spec: https://openid.net/specs/openid-connect-discovery-1_0.html
 */
import { NextResponse } from 'next/server';

export function GET(req: Request) {
  const url = new URL(req.url);
  const issuer = `${url.protocol}//${url.host}`;
  return NextResponse.json(
    {
      issuer,
      authorization_endpoint: `${issuer}/api/oauth/authorize`,
      token_endpoint: `${issuer}/api/oauth/token`,
      userinfo_endpoint: `${issuer}/api/oauth/userinfo`,
      revocation_endpoint: `${issuer}/api/oauth/revoke`,
      device_authorization_endpoint: `${issuer}/api/oauth/device`,
      scopes_supported: [
        'openid',
        'profile',
        'email',
        'offline_access',
        'capture:write',
        'capture:read',
        'recall:read',
        'notify:write',
        'event:write',
        'event:read',
        'tools:invoke',
        'intent:write',
        'creds:borrow',
      ],
      response_types_supported: ['code'],
      grant_types_supported: [
        'authorization_code',
        'refresh_token',
        'urn:ietf:params:oauth:grant-type:device_code',
      ],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'none'],
      code_challenge_methods_supported: ['S256', 'plain'],
      subject_types_supported: ['public'],
      // No id_token signing for v1 — userinfo serves as the canonical identity surface.
      id_token_signing_alg_values_supported: [],
      service_documentation: `${issuer}/docs/oauth`,
    },
    {
      headers: { 'cache-control': 'public, max-age=300' },
    },
  );
}

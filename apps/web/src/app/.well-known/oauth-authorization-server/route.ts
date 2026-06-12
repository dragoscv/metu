/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414) at the root
 * well-known path — required by MCP clients doing RFC 9728 discovery
 * (the protected resource points at this issuer). Mirrors the OIDC
 * discovery doc under /api/oauth/.well-known/openid-configuration.
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
      revocation_endpoint: `${issuer}/api/oauth/revoke`,
      device_authorization_endpoint: `${issuer}/api/oauth/device`,
      registration_endpoint: undefined,
      scopes_supported: [
        'capture:write',
        'capture:read',
        'recall:read',
        'notify:write',
        'event:write',
        'event:read',
        'tools:invoke',
        'intent:write',
        'creds:borrow',
        'presence:talk',
        'audit:read',
        'offline_access',
      ],
      response_types_supported: ['code'],
      grant_types_supported: [
        'authorization_code',
        'refresh_token',
        'urn:ietf:params:oauth:grant-type:device_code',
      ],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'none'],
      code_challenge_methods_supported: ['S256'],
      service_documentation: `${issuer}/docs/oauth`,
    },
    { headers: { 'cache-control': 'public, max-age=300' } },
  );
}

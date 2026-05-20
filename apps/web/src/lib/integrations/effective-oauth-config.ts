/**
 * Resolve the OAuth client config to use for a given integration kind in
 * a specific workspace. DB-stored OAuth apps (managed via /integrations/oauth-apps)
 * win over the static `WEB_OAUTH` env-var config — that lets each workspace
 * BYO OAuth app for any provider without redeploying.
 *
 * Returns a normalized shape both /api/integrations/oauth/[kind]/start and
 * /callback can rely on, plus a `source` tag for telemetry / debugging.
 */
import 'server-only';
import { open } from '@metu/ai/crypto';
import { getOauthAppByKind } from '@metu/db/queries';
import type { IntegrationKind } from '@metu/types';
import { WEB_OAUTH } from './web-oauth-config';

export interface EffectiveOauthConfig {
  source: 'db' | 'env';
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  pkce: boolean;
  extraAuthParams: Record<string, string>;
  tokenAuthMethod: 'client_secret_post' | 'client_secret_basic';
}

export async function resolveOauthConfig(
  workspaceId: string,
  kind: IntegrationKind,
): Promise<EffectiveOauthConfig | null> {
  const dbApp = await getOauthAppByKind(workspaceId, kind);
  if (dbApp) {
    let clientSecret: string;
    try {
      clientSecret = open({
        ciphertext: dbApp.clientSecretCiphertext,
        iv: dbApp.clientSecretIv,
        tag: dbApp.clientSecretTag,
      });
    } catch {
      return null;
    }
    return {
      source: 'db',
      clientId: dbApp.clientId,
      clientSecret,
      authorizeUrl: dbApp.authorizeUrl,
      tokenUrl: dbApp.tokenUrl,
      scope: dbApp.scopes,
      pkce: dbApp.pkce,
      extraAuthParams: dbApp.extraAuthParams ?? {},
      tokenAuthMethod:
        dbApp.tokenAuthMethod === 'client_secret_basic'
          ? 'client_secret_basic'
          : 'client_secret_post',
    };
  }

  const env = WEB_OAUTH[kind];
  if (!env) return null;
  const clientId = process.env[env.clientIdEnv];
  const clientSecret = process.env[env.clientSecretEnv];
  if (!clientId || !clientSecret) return null;
  return {
    source: 'env',
    clientId,
    clientSecret,
    authorizeUrl: env.authorizeUrl,
    tokenUrl: env.tokenUrl,
    scope: env.scope,
    pkce: env.pkce,
    extraAuthParams: env.extraAuthParams ?? {},
    tokenAuthMethod: 'client_secret_post',
  };
}

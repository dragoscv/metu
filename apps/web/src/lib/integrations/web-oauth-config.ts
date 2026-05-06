/**
 * Per-kind OAuth 2 endpoints + scopes for built-in integrations.
 *
 * Activate by setting `<KIND>_OAUTH_CLIENT_ID` + `<KIND>_OAUTH_CLIENT_SECRET`
 * (e.g. `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`). The
 * /integrations card flips from "paste token" to "Sign in with <Provider>"
 * automatically.
 */
import type { IntegrationKind } from '@metu/types';

export interface WebOauthConfig {
  clientIdEnv: string;
  clientSecretEnv: string;
  authorizeUrl: string;
  tokenUrl: string;
  /** Default scopes (space-delimited). */
  scope: string;
  /** Use PKCE (S256). Some providers require it; some (GitHub) ignore it. */
  pkce: boolean;
  /** Extra query params for the authorize step (e.g. access_type=offline). */
  extraAuthParams?: Record<string, string>;
}

export const WEB_OAUTH: Partial<Record<IntegrationKind, WebOauthConfig>> = {
  github: {
    clientIdEnv: 'GITHUB_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GITHUB_OAUTH_CLIENT_SECRET',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'repo read:user read:org',
    pkce: false,
  },
  google: {
    clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    pkce: true,
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  },
  gmail: {
    clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope:
      'openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send',
    pkce: true,
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  },
  gcal: {
    clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope:
      'openid email profile https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly',
    pkce: true,
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  },
  vercel: {
    clientIdEnv: 'VERCEL_OAUTH_CLIENT_ID',
    clientSecretEnv: 'VERCEL_OAUTH_CLIENT_SECRET',
    authorizeUrl: 'https://vercel.com/integrations/oauth/authorize',
    tokenUrl: 'https://api.vercel.com/v2/oauth/access_token',
    scope: '',
    pkce: false,
  },
  slack: {
    clientIdEnv: 'SLACK_OAUTH_CLIENT_ID',
    clientSecretEnv: 'SLACK_OAUTH_CLIENT_SECRET',
    authorizeUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    scope: 'channels:history channels:read chat:write users:read',
    pkce: false,
  },
  notion: {
    clientIdEnv: 'NOTION_OAUTH_CLIENT_ID',
    clientSecretEnv: 'NOTION_OAUTH_CLIENT_SECRET',
    authorizeUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    scope: '',
    pkce: false,
    extraAuthParams: { owner: 'user' },
  },
  linear: {
    clientIdEnv: 'LINEAR_OAUTH_CLIENT_ID',
    clientSecretEnv: 'LINEAR_OAUTH_CLIENT_SECRET',
    authorizeUrl: 'https://linear.app/oauth/authorize',
    tokenUrl: 'https://api.linear.app/oauth/token',
    scope: 'read write',
    pkce: false,
  },
  spotify: {
    clientIdEnv: 'SPOTIFY_OAUTH_CLIENT_ID',
    clientSecretEnv: 'SPOTIFY_OAUTH_CLIENT_SECRET',
    authorizeUrl: 'https://accounts.spotify.com/authorize',
    tokenUrl: 'https://accounts.spotify.com/api/token',
    scope: 'user-read-recently-played user-read-currently-playing user-read-email',
    pkce: true,
  },
  stripe: {
    clientIdEnv: 'STRIPE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'STRIPE_SECRET_KEY',
    authorizeUrl: 'https://connect.stripe.com/oauth/authorize',
    tokenUrl: 'https://connect.stripe.com/oauth/token',
    scope: 'read_write',
    pkce: false,
  },
};

export function webOauthConfig(
  kind: IntegrationKind,
): { clientId: string; clientSecret: string; cfg: WebOauthConfig } | null {
  const cfg = WEB_OAUTH[kind];
  if (!cfg) return null;
  const clientId = process.env[cfg.clientIdEnv];
  const clientSecret = process.env[cfg.clientSecretEnv];
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, cfg };
}

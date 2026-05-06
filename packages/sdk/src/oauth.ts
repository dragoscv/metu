/**
 * OAuth helpers for the SDK.
 *
 * Two flows are exposed:
 *   - `buildAuthorizationUrl` + `exchangeCode` for the standard auth-code+PKCE flow
 *     (browsers / desktop apps with redirect handling).
 *   - `requestDeviceCode` + `pollDeviceToken` for the device-authorization flow
 *     (CLIs, headless companion processes, anything without a browser redirect).
 */
import { createHash, randomBytes } from 'node:crypto';

export interface OAuthEndpoints {
  /** Base URL of the METU instance, e.g. https://app.metu.ro. */
  baseUrl: string;
}

export interface PkceChallenge {
  verifier: string;
  challenge: string;
  method: 'S256';
}

/** RFC 7636 §4.1: 43–128 char URL-safe random string. */
export function createPkceChallenge(): PkceChallenge {
  const verifier = base64url(randomBytes(64)).slice(0, 96);
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge, method: 'S256' };
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

export interface BuildAuthorizationUrlInput {
  baseUrl: string;
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  state: string;
  pkce?: PkceChallenge;
}

export function buildAuthorizationUrl(input: BuildAuthorizationUrlInput): string {
  const url = new URL('/api/oauth/authorize', input.baseUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', input.scopes.join(' '));
  url.searchParams.set('state', input.state);
  if (input.pkce) {
    url.searchParams.set('code_challenge', input.pkce.challenge);
    url.searchParams.set('code_challenge_method', input.pkce.method);
  }
  return url.toString();
}

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scope: string;
  refresh_token?: string;
}

export interface ExchangeCodeInput {
  baseUrl: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  code: string;
  codeVerifier?: string;
  fetch?: typeof fetch;
}

export async function exchangeCode(input: ExchangeCodeInput): Promise<TokenResponse> {
  const f = input.fetch ?? fetch;
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
  });
  if (input.codeVerifier) body.set('code_verifier', input.codeVerifier);
  if (input.clientSecret) body.set('client_secret', input.clientSecret);

  const res = await f(`${input.baseUrl}/api/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw await oauthErr(res);
  return (await res.json()) as TokenResponse;
}

export interface RefreshTokenInput {
  baseUrl: string;
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
  scopes?: readonly string[];
  fetch?: typeof fetch;
}

export async function refreshToken(input: RefreshTokenInput): Promise<TokenResponse> {
  const f = input.fetch ?? fetch;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
    client_id: input.clientId,
  });
  if (input.clientSecret) body.set('client_secret', input.clientSecret);
  if (input.scopes && input.scopes.length > 0) body.set('scope', input.scopes.join(' '));
  const res = await f(`${input.baseUrl}/api/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw await oauthErr(res);
  return (await res.json()) as TokenResponse;
}

// ─── Device authorization (RFC 8628) ───────────────────────────────────────

export interface DeviceAuthorizationResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export async function requestDeviceCode(input: {
  baseUrl: string;
  clientId: string;
  scopes: readonly string[];
  fetch?: typeof fetch;
}): Promise<DeviceAuthorizationResponse> {
  const f = input.fetch ?? fetch;
  const body = new URLSearchParams({
    client_id: input.clientId,
    scope: input.scopes.join(' '),
  });
  const res = await f(`${input.baseUrl}/api/oauth/device`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw await oauthErr(res);
  return (await res.json()) as DeviceAuthorizationResponse;
}

export interface PollDeviceTokenInput {
  baseUrl: string;
  clientId: string;
  clientSecret?: string;
  deviceCode: string;
  interval: number;
  expiresIn: number;
  fetch?: typeof fetch;
  /** Called when the user-code is still pending; default no-op. */
  onWaiting?: () => void;
  signal?: AbortSignal;
}

/** Polls the token endpoint until the user approves, expires, or denies. */
export async function pollDeviceToken(input: PollDeviceTokenInput): Promise<TokenResponse> {
  const f = input.fetch ?? fetch;
  const deadline = Date.now() + input.expiresIn * 1000;
  let interval = input.interval;
  while (Date.now() < deadline) {
    if (input.signal?.aborted) throw new Error('Cancelled.');
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: input.deviceCode,
      client_id: input.clientId,
    });
    if (input.clientSecret) body.set('client_secret', input.clientSecret);
    const res = await f(`${input.baseUrl}/api/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (res.ok) return (await res.json()) as TokenResponse;
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    if (err.error === 'authorization_pending') {
      input.onWaiting?.();
    } else if (err.error === 'slow_down') {
      interval += 5;
    } else {
      throw new OAuthError(err.error ?? 'unknown_error', res.status);
    }
    await sleep(interval * 1000);
  }
  throw new OAuthError('expired_token', 408);
}

// ─── Errors ────────────────────────────────────────────────────────────────

export class OAuthError extends Error {
  constructor(
    public code: string,
    public status: number,
    public detail?: unknown,
  ) {
    super(`OAuth error: ${code}`);
    this.name = 'OAuthError';
  }
}

async function oauthErr(res: Response): Promise<OAuthError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* */
  }
  const code =
    (body && typeof body === 'object' && 'error' in body
      ? String((body as { error: unknown }).error)
      : null) ?? `http_${res.status}`;
  return new OAuthError(code, res.status, body);
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

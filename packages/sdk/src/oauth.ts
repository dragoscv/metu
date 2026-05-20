// TypeScript: declare window for isomorphic guards
declare const window: any;
/**
 * OAuth helpers for the SDK.
 *
 * Two flows are exposed:
 *   - `buildAuthorizationUrl` + `exchangeCode` for the standard auth-code+PKCE flow
 *     (browsers / desktop apps with redirect handling).
 *   - `requestDeviceCode` + `pollDeviceToken` for the device-authorization flow
 *     (CLIs, headless companion processes, anything without a browser redirect).
 */

// Isomorphic randomBytes and sha256
function getRandomBytes(length: number): Uint8Array {
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    const arr = new Uint8Array(length);
    window.crypto.getRandomValues(arr);
    return arr;
  } else {
    // Node.js
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('node:crypto').randomBytes(length);
  }
}

async function sha256(input: Uint8Array): Promise<Uint8Array> {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    // Always copy to a plain Uint8Array backed by ArrayBuffer
    let len = 0;
    if (typeof input.length === 'number' && !isNaN(input.length)) {
      len = input.length;
    } else if (typeof input.byteLength === 'number' && !isNaN(input.byteLength)) {
      len = input.byteLength;
    }
    const arr = new Uint8Array(len);
    for (let i = 0; i < arr.length; ++i) arr[i] = Number(input[i] ?? 0);
    const hash = await window.crypto.subtle.digest('SHA-256', arr);
    return new Uint8Array(hash);
  } else {
    // Node.js
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('node:crypto').createHash('sha256').update(input).digest();
  }
}

// Polyfill TextEncoder for Node.js
let _TextEncoder: typeof TextEncoder;
if (typeof TextEncoder !== 'undefined') {
  _TextEncoder = TextEncoder;
} else {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  _TextEncoder = require('util').TextEncoder;
}

function base64url(buf: Uint8Array): string {
  // Browser and Node: base64 encode, then replace URL-unsafe chars
  let str = '';
  if (typeof Buffer !== 'undefined') {
    // Node.js
    str = Buffer.from(buf).toString('base64');
  } else if (typeof btoa !== 'undefined') {
    // Browser
    str = btoa(String.fromCharCode(...buf));
  } else {
    // Fallback (should not happen)
    throw new Error('No base64 encoder available');
  }
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

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
export async function createPkceChallenge(): Promise<PkceChallenge> {
  const verifierBytes = getRandomBytes(64);
  const verifier = base64url(verifierBytes).slice(0, 96);
  const challengeBytes = await sha256(new _TextEncoder().encode(verifier));
  const challenge = base64url(challengeBytes);
  return { verifier, challenge, method: 'S256' };
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

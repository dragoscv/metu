/**
 * OAuth2/OIDC primitives — pure functions, no I/O.
 * Used by the METU OAuth provider routes and by the SDK.
 *
 * Spec compliance:
 *   - RFC 6749 (OAuth 2.0)
 *   - RFC 7636 (PKCE) — required for `public` clients
 *   - RFC 7009 (Token revocation)
 *   - RFC 8628 (Device authorization grant)
 *   - OpenID Connect Core 1.0 (id_token issuance)
 */
import { createHash, randomBytes } from 'node:crypto';

/** Default scopes shipped with first-party apps. */
export const DEFAULT_SCOPES = [
  'openid',
  'profile',
  'capture:write',
  'recall:read',
  'notify:write',
] as const;

/** All scopes METU recognizes — superset for catalog UI. */
export const KNOWN_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access', // requests refresh token
  'capture:write',
  'capture:read',
  'recall:read',
  'notify:write',
  'notify:read',
  'event:write',
  'event:read',
  'tools:invoke',
  'intent:write',
  'creds:borrow',
  'admin:write',
] as const;

export type Scope = (typeof KNOWN_SCOPES)[number] | (string & {});

export function parseScopes(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function formatScopes(scopes: readonly string[]): string {
  return [...new Set(scopes)].join(' ');
}

/** Pure subset check: every requested scope must be present in `allowed`. */
export function scopesAllowed(
  requested: readonly string[],
  allowed: readonly string[],
): { ok: true } | { ok: false; missing: string[] } {
  const set = new Set(allowed);
  const missing = requested.filter((s) => !set.has(s));
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

// ─── Token / code generation ───────────────────────────────────────────────

const URL_SAFE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Cryptographically random URL-safe string of N bytes (base64url). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Short user-friendly code for device flow. e.g. WPSP-7QXJ */
export function generateUserCode(): string {
  const a = randomDigits(4);
  const b = randomDigits(4);
  return `${a}-${b}`;
}

function randomDigits(len: number): string {
  const buf = randomBytes(len);
  let out = '';
  // 36 chars in alphabet keeps us out of look-alike 0/O/1/I confusion later;
  // keep simple and uppercase letters+digits.
  const set = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < len; i++) out += set[buf[i]! % set.length];
  return out;
}

/** sha256(token) → base64url. Matches what we store in `oauth_token.token_hash`. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

/** Constant-time compare using the hash; safe against timing attacks. */
export function compareSecret(presented: string, hash: string): boolean {
  const candidate = hashToken(presented);
  if (candidate.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) {
    diff |= candidate.charCodeAt(i) ^ hash.charCodeAt(i);
  }
  return diff === 0;
}

// ─── PKCE (RFC 7636) ───────────────────────────────────────────────────────

export type PkceMethod = 'S256' | 'plain';

export function verifyPkce(
  verifier: string,
  challenge: string,
  method: PkceMethod = 'S256',
): boolean {
  if (!verifier || verifier.length < 43 || verifier.length > 128) return false;
  if (!/^[A-Za-z0-9._~-]+$/.test(verifier)) return false;
  if (method === 'plain') return verifier === challenge;
  const computed = createHash('sha256').update(verifier).digest('base64url');
  return computed === challenge;
}

void URL_SAFE_ALPHABET;

// ─── Token TTLs ────────────────────────────────────────────────────────────

export const TTL = {
  authorizationCode: 60, // 1 minute
  accessToken: 60 * 60, // 1 hour
  refreshToken: 60 * 60 * 24 * 30, // 30 days
  deviceCode: 60 * 15, // 15 minutes
  consentLifetime: 60 * 60 * 24 * 365, // 1 year of remembered consent
} as const;

/** Add `seconds` to now, return Date. */
export function expiresIn(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}

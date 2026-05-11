/**
 * @metu/auth/oauth — pure helper tests.
 *
 * No DB / network: these guard the contract of `parseScopes`,
 * `scopesAllowed`, `hashToken`/`compareSecret`, `verifyPkce`, and the
 * token-shape helpers. A regression here would break every bearer SDK
 * caller and the OAuth provider routes.
 */
import { describe, expect, it } from 'vitest';
import {
  compareSecret,
  expiresIn,
  formatScopes,
  generateUserCode,
  hashToken,
  parseScopes,
  randomToken,
  scopesAllowed,
  TTL,
  verifyPkce,
} from '../oauth';
import { createHash } from 'node:crypto';

describe('parseScopes / formatScopes', () => {
  it('parses an empty / null input as []', () => {
    expect(parseScopes(null)).toEqual([]);
    expect(parseScopes(undefined)).toEqual([]);
    expect(parseScopes('')).toEqual([]);
  });

  it('splits on whitespace + dedupes via formatScopes', () => {
    expect(parseScopes('openid  profile\tcapture:write')).toEqual([
      'openid',
      'profile',
      'capture:write',
    ]);
    expect(formatScopes(['a', 'b', 'a', 'c', 'b'])).toBe('a b c');
  });
});

describe('scopesAllowed', () => {
  it('returns ok=true when every requested scope is permitted', () => {
    expect(
      scopesAllowed(['openid', 'capture:write'], ['openid', 'capture:write', 'extra']),
    ).toEqual({
      ok: true,
    });
  });

  it('returns the missing scopes when a requested one is absent', () => {
    expect(scopesAllowed(['admin:write'], ['openid'])).toEqual({
      ok: false,
      missing: ['admin:write'],
    });
  });

  it('returns ok when nothing is requested', () => {
    expect(scopesAllowed([], ['openid'])).toEqual({ ok: true });
  });
});

describe('hashToken / compareSecret', () => {
  it('hashToken matches sha256 base64url', () => {
    const t = 'metu_at_example';
    const expected = createHash('sha256').update(t).digest('base64url');
    expect(hashToken(t)).toBe(expected);
  });

  it('compareSecret returns true for the correct plaintext', () => {
    const plain = 'super-secret';
    const hash = hashToken(plain);
    expect(compareSecret(plain, hash)).toBe(true);
  });

  it('compareSecret rejects tampered plaintext', () => {
    const hash = hashToken('super-secret');
    expect(compareSecret('super-secrEt', hash)).toBe(false);
    expect(compareSecret('', hash)).toBe(false);
  });
});

describe('randomToken / generateUserCode', () => {
  it('randomToken returns base64url chars only', () => {
    const t = randomToken(32);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t.length).toBeGreaterThan(30);
  });

  it('generateUserCode returns NNNN-NNNN with restricted alphabet', () => {
    const c = generateUserCode();
    expect(c).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    // No look-alike characters (0/O/1/I/L) per the implementation set.
    expect(c).not.toMatch(/[OIL01]/);
  });
});

describe('verifyPkce', () => {
  it('accepts a valid S256 verifier/challenge pair', () => {
    const verifier = 'a'.repeat(64);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    expect(verifyPkce(verifier, challenge)).toBe(true);
  });

  it('rejects a wrong verifier', () => {
    const challenge = createHash('sha256').update('a'.repeat(64)).digest('base64url');
    expect(verifyPkce('b'.repeat(64), challenge)).toBe(false);
  });

  it('rejects too-short verifiers', () => {
    expect(verifyPkce('short', 'whatever')).toBe(false);
  });

  it('rejects verifiers with disallowed chars', () => {
    expect(verifyPkce('a'.repeat(43) + '!', 'x')).toBe(false);
  });

  it('supports plain method', () => {
    const v = 'a'.repeat(64);
    expect(verifyPkce(v, v, 'plain')).toBe(true);
    expect(verifyPkce(v, 'b'.repeat(64), 'plain')).toBe(false);
  });
});

describe('TTL constants + expiresIn', () => {
  it('exposes expected TTLs in seconds', () => {
    expect(TTL.authorizationCode).toBe(60);
    expect(TTL.accessToken).toBe(60 * 60);
    expect(TTL.refreshToken).toBe(60 * 60 * 24 * 30);
  });

  it('expiresIn returns a Date roughly N seconds in the future', () => {
    const before = Date.now();
    const d = expiresIn(60);
    expect(d.getTime() - before).toBeGreaterThanOrEqual(59_000);
    expect(d.getTime() - before).toBeLessThanOrEqual(61_000);
  });
});

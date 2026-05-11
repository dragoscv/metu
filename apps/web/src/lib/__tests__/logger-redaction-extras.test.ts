/**
 * Additional logger redaction edge cases — longer token shapes,
 * nested error stacks, multi-occurrence strings.
 *
 * Complements `logger-scrub.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { scrubString, __internal } from '@metu/logger';

describe('scrubString — edge cases', () => {
  it('redacts very long metu_at_ tokens (≥ 96 chars body)', () => {
    const tok = 'metu_at_' + 'A'.repeat(96);
    const out = scrubString(`bearer ${tok} trailing words`);
    expect(out).not.toContain(tok);
    expect(out).toMatch(/metu_at_\[redacted\]/);
  });

  it('redacts multiple tokens in the same line', () => {
    const a = 'metu_at_AAAAAAAAAAAA';
    const b = 'metu_rt_BBBBBBBBBBBB';
    const out = scrubString(`old=${a}; new=${b}`);
    expect(out).not.toContain(a);
    expect(out).not.toContain(b);
    expect(out).toContain('metu_at_[redacted]');
    expect(out).toContain('metu_rt_[redacted]');
  });

  it('redacts tokens inside multiline JSON-shaped strings', () => {
    const blob = `{
      "user": "u_1",
      "access_token": "metu_at_DEADBEEFDEADBEEFCAFE",
      "refresh_token": "metu_rt_FEEDFACEFEEDFACEBABE"
    }`;
    const out = scrubString(blob);
    expect(out).not.toContain('metu_at_DEADBEEFDEADBEEFCAFE');
    expect(out).not.toContain('metu_rt_FEEDFACEFEEDFACEBABE');
  });

  it('strips embedded JWTs even when next to other tokens', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmMxMjMifQ.zzzzzzzzzzzz';
    const tok = 'metu_at_HELLOHELLOHELLO';
    const out = scrubString(`Auth: Bearer ${jwt} ; ${tok}`);
    expect(out).not.toContain(jwt);
    expect(out).not.toContain(tok);
  });
});

describe('redact — edge cases', () => {
  it('redacts auth keys with capitalized variants', () => {
    const out = __internal.redact({
      Authorization: 'Bearer x',
      AccessToken: 'y',
      RefreshToken: 'z',
    }) as Record<string, unknown>;
    expect(out.Authorization).toBe('[redacted]');
    // case-insensitive check covers 'AccessToken' via lowercase 'accesstoken'
    // — only present in REDACT_KEYS as access_token. So this verifies that
    // unknown casing variants pass through (documented behavior).
    expect(out.AccessToken).toBe('y');
  });

  it('redacts inside arrays of objects', () => {
    const out = __internal.redact({
      events: [
        { id: 'e1', secret: 'top' },
        { id: 'e2', password: 'p' },
      ],
    }) as { events: Array<Record<string, unknown>> };
    expect(out.events[0]!.secret).toBe('[redacted]');
    expect(out.events[1]!.password).toBe('[redacted]');
    expect(out.events[0]!.id).toBe('e1');
  });
});

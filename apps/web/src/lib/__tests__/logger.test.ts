/**
 * Logger redaction tests — guarantees that secret-shaped keys are scrubbed
 * before any log line leaves the process. Keep in sync with REDACT_KEYS in
 * `../logger.ts`.
 */
import { describe, expect, it } from 'vitest';
import { __internal } from '../logger';

describe('logger.redact', () => {
  it('scrubs known secret keys at the top level', () => {
    const out = __internal.redact({
      userId: 'u_1',
      password: 'hunter2',
      access_token: 'metu_at_xxx',
      refresh_token: 'metu_rt_yyy',
      client_secret: 'metu_cs_zzz',
      webhook_secret: 'metu_wh_aaa',
      authorization: 'Bearer metu_at_xxx',
    }) as Record<string, unknown>;
    expect(out.userId).toBe('u_1');
    for (const key of [
      'password',
      'access_token',
      'refresh_token',
      'client_secret',
      'webhook_secret',
      'authorization',
    ]) {
      expect(out[key]).toBe('[redacted]');
    }
  });

  it('scrubs nested fields', () => {
    const out = __internal.redact({
      headers: { Authorization: 'Bearer xxx', cookie: 'sid=abc' },
      body: { nested: { secret: 'top' } },
    }) as { headers: Record<string, unknown>; body: { nested: Record<string, unknown> } };
    expect(out.headers.Authorization).toBe('[redacted]');
    expect(out.headers.cookie).toBe('[redacted]');
    expect(out.body.nested.secret).toBe('[redacted]');
  });

  it('truncates very long strings', () => {
    const long = 'x'.repeat(5000);
    const out = __internal.redact({ payload: long }) as { payload: string };
    expect(out.payload.length).toBeLessThanOrEqual(4097);
    expect(out.payload.endsWith('…')).toBe(true);
  });

  it('caps recursion depth gracefully', () => {
    type Nested = { next?: Nested };
    const root: Nested = {};
    let cur: Nested = root;
    for (let i = 0; i < 20; i++) {
      cur.next = {};
      cur = cur.next;
    }
    const out = __internal.redact(root);
    // Should not throw or hang; deeply nested branches collapse to a marker.
    expect(JSON.stringify(out)).toContain('depth_limit');
  });

  it('caps array length', () => {
    const arr = Array.from({ length: 250 }, (_, i) => i);
    const out = __internal.redact({ arr }) as { arr: number[] };
    expect(out.arr).toHaveLength(100);
  });

  it('preserves null and primitives', () => {
    expect(__internal.redact(null)).toBeNull();
    expect(__internal.redact(42)).toBe(42);
    expect(__internal.redact(true)).toBe(true);
    expect(__internal.redact('hi')).toBe('hi');
  });
});

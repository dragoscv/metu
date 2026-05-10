import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { scrubString, installConsoleRedactor, __testOnlyResetConsoleRedactor } from '@metu/logger';

describe('scrubString', () => {
  it('redacts Authorization Bearer tokens', () => {
    const out = scrubString('Authorization: Bearer abc123def456ghi');
    expect(out).not.toContain('abc123def456ghi');
    expect(out.toLowerCase()).toContain('redacted');
  });

  it('redacts metu_at_ tokens', () => {
    const out = scrubString('user has metu_at_ABCDEFGHIJKLMNOP_xyz');
    expect(out).not.toContain('ABCDEFGHIJKLMNOP_xyz');
    expect(out).toContain('metu_at_[redacted]');
  });

  it('redacts metu_rt_ tokens', () => {
    const out = scrubString('refresh metu_rt_LONGREFRESHTOKEN_zz');
    expect(out).toContain('metu_rt_[redacted]');
  });

  it('redacts JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturepart12';
    const out = scrubString(`token=${jwt}`);
    expect(out).not.toContain(jwt);
    expect(out).toContain('[redacted-jwt]');
  });

  it('redacts key=value style secrets', () => {
    expect(scrubString('client_secret=abcdef123456')).toContain('[redacted]');
    expect(scrubString('"api_key": "abcdef123456"')).toContain('[redacted]');
    expect(scrubString('encryption_key = "AAAAAAAAAAAA"')).toContain('[redacted]');
  });

  it('passes through innocuous text', () => {
    expect(scrubString('hello world')).toBe('hello world');
    expect(scrubString('user clicked button')).toBe('user clicked button');
  });

  it('skips redaction on very large strings (16KB+)', () => {
    const huge = 'token=abcdef123456'.repeat(2000);
    // Should pass through unchanged because length > 16384
    expect(scrubString(huge)).toBe(huge);
  });
});

describe('installConsoleRedactor', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __testOnlyResetConsoleRedactor();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    __testOnlyResetConsoleRedactor();
  });

  it('returns true on first install, false on subsequent', () => {
    expect(installConsoleRedactor()).toBe(true);
    expect(installConsoleRedactor()).toBe(false);
  });

  it('scrubs string args passed to console.log', () => {
    installConsoleRedactor();
    // eslint-disable-next-line no-console -- exercising the global console patch on purpose
    console.log('user token=abcdef123456 logged in');
    expect(logSpy).toHaveBeenCalledTimes(1);
    const arg = logSpy.mock.calls[0]?.[0] as string;
    expect(arg).toContain('[redacted]');
    expect(arg).not.toContain('abcdef123456');
  });

  it('scrubs object args via JSON round-trip', () => {
    installConsoleRedactor();
    console.error('failed', { authorization: 'Bearer secret123456' });
    const obj = errSpy.mock.calls[0]?.[1];
    expect(JSON.stringify(obj)).toContain('redacted');
    expect(JSON.stringify(obj)).not.toContain('secret123456');
  });
});

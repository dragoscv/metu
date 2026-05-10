/**
 * Tests for assertSafeOutboundUrl. The function is sync and pure — these
 * cover the SSRF blocklist that Slice 12 wired into oauth-apps,
 * oauth/[appId]/callback, and transcribe.ts.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { assertSafeOutboundUrl, safeEqual } from '../safe-equal';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function setEnv(value: string | undefined): void {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

beforeEach(() => {
  setEnv('test');
});

afterAll(() => {
  setEnv(ORIGINAL_NODE_ENV);
});

describe('assertSafeOutboundUrl', () => {
  it('rejects malformed URLs', () => {
    expect(() => assertSafeOutboundUrl('not-a-url')).toThrow(/invalid url/);
  });

  it('rejects non-http(s) protocols', () => {
    expect(() => assertSafeOutboundUrl('ftp://example.com')).toThrow(/unsupported protocol/);
    expect(() => assertSafeOutboundUrl('file:///etc/passwd')).toThrow(/unsupported protocol/);
    expect(() => assertSafeOutboundUrl('javascript:alert(1)')).toThrow(/unsupported protocol/);
  });

  it('rejects RFC1918 private ranges', () => {
    for (const host of ['10.0.0.1', '172.16.5.5', '192.168.1.1']) {
      expect(() => assertSafeOutboundUrl(`https://${host}/x`)).toThrow(/private or reserved/);
    }
  });

  it('rejects link-local incl. cloud metadata 169.254.169.254', () => {
    expect(() => assertSafeOutboundUrl('http://169.254.169.254/latest/meta-data/')).toThrow(
      /private or reserved/,
    );
  });

  it('rejects IPv6 loopback / link-local / ULA', () => {
    expect(() => assertSafeOutboundUrl('http://[::1]/')).toThrow();
    expect(() => assertSafeOutboundUrl('http://[fe80::1]/')).toThrow(/private or reserved IPv6/);
    expect(() => assertSafeOutboundUrl('http://[fc00::1]/')).toThrow(/private or reserved IPv6/);
    expect(() => assertSafeOutboundUrl('http://[fd12:3456:789a::1]/')).toThrow(
      /private or reserved IPv6/,
    );
  });

  it('rejects loopback hostnames', () => {
    setEnv('production');
    for (const host of ['localhost', 'foo.localhost', '127.0.0.1', '0.0.0.0']) {
      expect(() => assertSafeOutboundUrl(`https://${host}/x`)).toThrow();
    }
  });

  it('allows loopback in non-production for local dev', () => {
    setEnv('development');
    expect(() => assertSafeOutboundUrl('http://localhost:24890/api')).not.toThrow();
    expect(() => assertSafeOutboundUrl('http://127.0.0.1:24891/ws')).not.toThrow();
  });

  it('forbids http:// in production', () => {
    setEnv('production');
    expect(() => assertSafeOutboundUrl('http://example.com')).toThrow(/only https/);
  });

  it('allows ordinary public https URLs', () => {
    const url = assertSafeOutboundUrl('https://example.com/oauth/token');
    expect(url.hostname).toBe('example.com');
    expect(url.pathname).toBe('/oauth/token');
  });

  it('returns a parsed URL on success', () => {
    const url = assertSafeOutboundUrl('https://api.openai.com/v1/audio/transcriptions');
    expect(url).toBeInstanceOf(URL);
  });
});

describe('safeEqual', () => {
  it('returns true for identical strings', () => {
    expect(safeEqual('secret', 'secret')).toBe(true);
  });

  it('returns false for different strings of equal length', () => {
    expect(safeEqual('abcdef', 'abcxyz')).toBe(false);
  });

  it('returns false for different lengths without leaking', () => {
    expect(safeEqual('short', 'much-longer-secret')).toBe(false);
  });

  it('returns false for non-string inputs', () => {
    expect(safeEqual(null, 'x')).toBe(false);
    expect(safeEqual('x', undefined)).toBe(false);
    expect(safeEqual(null, null)).toBe(false);
  });
});

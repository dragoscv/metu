/**
 * Crypto envelope tests.
 *
 * Goals:
 *   - Round-trip seal → open under the env-base64 dev path.
 *   - Async resolver path (production with Secret Manager / KMS) yields
 *     the same key as a 32-byte buffer return.
 *   - Resolver errors propagate from initCrypto and don't poison cache.
 *   - Validation rejects: missing key, non-base64, wrong length.
 *   - The auth-tag is enforced (tampered ciphertext fails open).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetCryptoForTest, initCrypto, open, seal, setMasterKeyResolver } from '../crypto';

const KEY32_B64 = Buffer.alloc(32, 7).toString('base64');

beforeEach(() => {
  _resetCryptoForTest();
  process.env.ENCRYPTION_KEY = KEY32_B64;
});
afterEach(() => {
  delete process.env.ENCRYPTION_KEY;
  _resetCryptoForTest();
});

describe('seal / open round-trip', () => {
  it('encrypts and decrypts a UTF-8 string', () => {
    const sealed = seal('hello metu \u{1F30D}');
    expect(sealed.ciphertext).toBeTruthy();
    expect(sealed.iv).toBeTruthy();
    expect(sealed.tag).toBeTruthy();
    expect(open(sealed)).toBe('hello metu \u{1F30D}');
  });

  it('produces a different ciphertext each call (fresh IV)', () => {
    const a = seal('same input');
    const b = seal('same input');
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });

  it('refuses to open a tampered ciphertext (auth tag check)', () => {
    const sealed = seal('do not modify');
    const ctBytes = Buffer.from(sealed.ciphertext, 'base64');
    ctBytes[0] = ctBytes[0]! ^ 0xff;
    const tampered = { ...sealed, ciphertext: ctBytes.toString('base64') };
    expect(() => open(tampered)).toThrow();
  });
});

describe('env-key validation (dev path)', () => {
  it('rejects a missing ENCRYPTION_KEY', () => {
    delete process.env.ENCRYPTION_KEY;
    _resetCryptoForTest();
    expect(() => seal('x')).toThrow(/ENCRYPTION_KEY is not set/);
  });

  it('rejects a non-base64 ENCRYPTION_KEY', () => {
    process.env.ENCRYPTION_KEY = 'not!base64!';
    _resetCryptoForTest();
    expect(() => seal('x')).toThrow(/must be base64/);
  });

  it('rejects a short ENCRYPTION_KEY (<32 bytes)', () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64');
    _resetCryptoForTest();
    expect(() => seal('x')).toThrow(/32 bytes/);
  });
});

describe('initCrypto (production resolver hook)', () => {
  it('uses the injected resolver to fetch the key', async () => {
    const fakeKey = Buffer.alloc(32, 99);
    let called = 0;
    process.env.ENCRYPTION_KEY = 'gcp-secret://projects/p/secrets/s/versions/latest';
    setMasterKeyResolver(async (ref) => {
      called++;
      expect(ref).toMatch(/^gcp-secret:\/\//);
      return fakeKey;
    });
    const buf = await initCrypto();
    expect(buf.equals(fakeKey)).toBe(true);
    expect(called).toBe(1);

    // Subsequent seal() uses the cached resolver-provided key.
    const sealed = seal('payload');
    // Decrypt with the same key out-of-band to prove it was used.
    expect(open(sealed)).toBe('payload');
  });

  it('propagates resolver errors without caching the failure', async () => {
    process.env.ENCRYPTION_KEY = 'gcp-secret://broken';
    setMasterKeyResolver(async () => {
      throw new Error('secret_unreachable');
    });
    await expect(initCrypto()).rejects.toThrow('secret_unreachable');

    // Recovering from the error: install a working resolver and try again.
    setMasterKeyResolver(async () => Buffer.alloc(32, 1));
    const buf = await initCrypto();
    expect(buf.length).toBe(32);
  });

  it('rejects a resolver that returns the wrong shape', async () => {
    setMasterKeyResolver(async () => Buffer.alloc(16, 0));
    await expect(initCrypto()).rejects.toThrow(/expected 32-byte Buffer/);
  });

  it('is idempotent (multiple awaits return the cached key)', async () => {
    let calls = 0;
    setMasterKeyResolver(async () => {
      calls++;
      return Buffer.alloc(32, 4);
    });
    const a = await initCrypto();
    const b = await initCrypto();
    const c = await initCrypto();
    expect(calls).toBe(1);
    expect(a.equals(b)).toBe(true);
    expect(b.equals(c)).toBe(true);
  });
});

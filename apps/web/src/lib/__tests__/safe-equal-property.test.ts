/**
 * Adversarial / pseudo-property tests for safeEqual.
 *
 * These are not true property-based tests (no fast-check dep) but iterate over
 * many seeded random pairs to catch:
 *  - false positives (different inputs returning true)
 *  - throws on weird inputs (binary, multibyte, very large)
 *  - asymmetry (a==b vs b==a)
 */
import { describe, expect, it } from 'vitest';
import { safeEqual } from '../safe-equal';

// xorshift32 — deterministic across runs.
function makePrng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return s >>> 0;
  };
}

function randomString(rng: () => number, length: number): string {
  const chars: string[] = [];
  for (let i = 0; i < length; i += 1) {
    chars.push(String.fromCharCode(32 + (rng() % 95)));
  }
  return chars.join('');
}

describe('safeEqual — adversarial pairs', () => {
  it('returns true for identical strings of varying lengths', () => {
    const rng = makePrng(0xdead_beef);
    for (let i = 0; i < 200; i += 1) {
      const len = (rng() % 256) + 1;
      const s = randomString(rng, len);
      expect(safeEqual(s, s)).toBe(true);
    }
  });

  it('returns false for random different equal-length strings', () => {
    const rng = makePrng(0xfeed_face);
    for (let i = 0; i < 500; i += 1) {
      const len = (rng() % 64) + 4;
      const a = randomString(rng, len);
      let b = randomString(rng, len);
      if (a === b) b = `${b.slice(0, -1)}~`;
      expect(safeEqual(a, b)).toBe(false);
      expect(safeEqual(b, a)).toBe(false);
    }
  });

  it('returns false for length-mismatched pairs without throwing', () => {
    const rng = makePrng(0x1234_5678);
    for (let i = 0; i < 200; i += 1) {
      const a = randomString(rng, (rng() % 32) + 1);
      const b = randomString(rng, (rng() % 64) + 33);
      expect(safeEqual(a, b)).toBe(false);
      expect(safeEqual(b, a)).toBe(false);
    }
  });

  it('handles single-bit-different strings', () => {
    const base = 'this-is-a-fairly-long-secret-token-1234567890';
    for (let i = 0; i < base.length; i += 1) {
      const flipped = `${base.slice(0, i)}${String.fromCharCode(base.charCodeAt(i) ^ 1)}${base.slice(i + 1)}`;
      expect(safeEqual(base, flipped)).toBe(false);
    }
  });

  it('handles multibyte / unicode inputs without throwing', () => {
    expect(safeEqual('héllo', 'héllo')).toBe(true);
    expect(safeEqual('héllo', 'hello')).toBe(false);
    expect(safeEqual('🔒secret', '🔒secret')).toBe(true);
    expect(safeEqual('🔒secret', '🔓secret')).toBe(false);
  });

  it('handles empty + nullish inputs symmetrically', () => {
    expect(safeEqual('', '')).toBe(true);
    expect(safeEqual('a', '')).toBe(false);
    expect(safeEqual('', 'a')).toBe(false);
    expect(safeEqual(null, '')).toBe(false);
    expect(safeEqual('', null)).toBe(false);
    expect(safeEqual(undefined, undefined)).toBe(false);
    expect(safeEqual(null, null)).toBe(false);
  });

  it('handles very large inputs (4KB)', () => {
    const big = 'a'.repeat(4096);
    expect(safeEqual(big, big)).toBe(true);
    expect(safeEqual(big, `${big.slice(0, -1)}b`)).toBe(false);
  });
});

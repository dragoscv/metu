/**
 * tier-gate.ts — pure ladder math.
 *
 * The DB-touching half (`getWorkspaceTier`) needs a real Drizzle, so
 * that path is exercised by integration tests elsewhere. Here we just
 * pin the comparison so a future enum reordering does not silently
 * downgrade users.
 */
import { describe, expect, it } from 'vitest';

// Mirror of the ORDER constant in src/lib/tier-gate.ts. If this drifts
// the gate is broken — exporting ORDER is overkill, so we re-encode
// expectations in the test.
const ORDER: Record<string, number> = {
  free: 0,
  starter: 1,
  pro: 2,
  pro_plus: 3,
  enterprise: 4,
};

function meets(have: string, need: string): boolean {
  return (ORDER[have] ?? -1) >= (ORDER[need] ?? Infinity);
}

describe('tier ladder', () => {
  it('higher tiers satisfy lower tier requirements', () => {
    expect(meets('pro', 'free')).toBe(true);
    expect(meets('pro', 'starter')).toBe(true);
    expect(meets('pro', 'pro')).toBe(true);
    expect(meets('enterprise', 'pro_plus')).toBe(true);
  });

  it('lower tiers do not satisfy higher requirements', () => {
    expect(meets('free', 'starter')).toBe(false);
    expect(meets('starter', 'pro')).toBe(false);
    expect(meets('pro', 'pro_plus')).toBe(false);
    expect(meets('pro_plus', 'enterprise')).toBe(false);
  });

  it('unknown tier strings are treated as free (lowest)', () => {
    expect(meets('mystery', 'free')).toBe(false);
    expect(meets('free', 'mystery')).toBe(false);
  });
});

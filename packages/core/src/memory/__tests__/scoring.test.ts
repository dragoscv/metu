import { describe, expect, it } from 'vitest';
import { compositeScore, recencyDecay, typeBoost, RECENCY_FLOOR } from '../scoring';

describe('recencyDecay', () => {
  it('is 1.0 for fresh chunks', () => {
    expect(recencyDecay(0)).toBeCloseTo(1.0, 5);
  });

  it('decays to ~0.37 at the 30-day half-life constant', () => {
    expect(recencyDecay(30)).toBeCloseTo(Math.exp(-1), 5);
  });

  it('never drops below the floor', () => {
    expect(recencyDecay(365)).toBe(RECENCY_FLOOR);
    expect(recencyDecay(10_000)).toBe(RECENCY_FLOOR);
  });

  it('treats invalid/negative age as no decay', () => {
    expect(recencyDecay(-5)).toBe(1);
    expect(recencyDecay(Number.NaN)).toBe(1);
  });
});

describe('typeBoost', () => {
  it('boosts consolidation-distilled insights highest', () => {
    expect(typeBoost('decision', 'consolidation')).toBe(1.5);
    expect(typeBoost('capture', 'consolidation')).toBe(1.5);
  });

  it('boosts decisions and project summaries', () => {
    expect(typeBoost('decision')).toBe(1.3);
    expect(typeBoost('project_summary')).toBe(1.3);
  });

  it('dampens raw companion activity', () => {
    expect(typeBoost('capture', 'companion-activity')).toBe(0.7);
  });

  it('is neutral for everything else', () => {
    expect(typeBoost('capture')).toBe(1.0);
    expect(typeBoost('task', null)).toBe(1.0);
  });
});

describe('compositeScore ordering', () => {
  it('ranks a fresh consolidation insight above a slightly-more-similar old raw capture', () => {
    const insight = compositeScore({
      similarity: 0.75,
      ageDays: 1,
      sourceKind: 'decision',
      origin: 'consolidation',
    });
    const rawOld = compositeScore({
      similarity: 0.85,
      ageDays: 60,
      sourceKind: 'capture',
      origin: 'companion-activity',
    });
    expect(insight).toBeGreaterThan(rawOld);
  });

  it('similarity still dominates between same-type fresh chunks', () => {
    const a = compositeScore({ similarity: 0.9, ageDays: 0, sourceKind: 'capture' });
    const b = compositeScore({ similarity: 0.7, ageDays: 0, sourceKind: 'capture' });
    expect(a).toBeGreaterThan(b);
  });

  it('old durable insights stay competitive thanks to the floor', () => {
    const oldInsight = compositeScore({
      similarity: 0.8,
      ageDays: 400,
      sourceKind: 'decision',
      origin: 'consolidation',
    });
    // floor 0.2 × boost 1.5 = 0.3 multiplier — still beats a weak fresh match
    const weakFresh = compositeScore({ similarity: 0.2, ageDays: 0, sourceKind: 'capture' });
    expect(oldInsight).toBeGreaterThan(weakFresh);
  });
});

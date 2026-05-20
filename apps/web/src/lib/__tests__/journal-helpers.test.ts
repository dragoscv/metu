import { describe, expect, test } from 'vitest';
import {
  parseJournalRange,
  labelForKind,
  JOURNAL_RANGES,
  JOURNAL_KIND_LABELS,
} from '../journal-helpers';

describe('parseJournalRange', () => {
  test('accepts 7d/30d/90d as-is', () => {
    expect(parseJournalRange('7d')).toBe('7d');
    expect(parseJournalRange('30d')).toBe('30d');
    expect(parseJournalRange('90d')).toBe('90d');
  });

  test('defaults to 7d for anything else', () => {
    expect(parseJournalRange(undefined)).toBe('7d');
    expect(parseJournalRange('')).toBe('7d');
    expect(parseJournalRange('1y')).toBe('7d');
    expect(parseJournalRange('999d')).toBe('7d');
  });
});

describe('labelForKind', () => {
  test('returns table entry verbatim for known kinds', () => {
    for (const [kind, value] of Object.entries(JOURNAL_KIND_LABELS)) {
      expect(labelForKind(kind)).toEqual(value);
    }
  });

  test('falls back to first dot-segment + neutral tone for unknown kinds', () => {
    expect(labelForKind('weird.unknown.kind')).toEqual({ label: 'weird', tone: 'neutral' });
    expect(labelForKind('singleword')).toEqual({ label: 'singleword', tone: 'neutral' });
  });

  test('empty string falls back gracefully', () => {
    // kind.split('.')[0] returns '' for empty string; helper guards with `?? kind`.
    const result = labelForKind('');
    expect(result.tone).toBe('neutral');
    expect(result.label).toBe('');
  });
});

describe('JOURNAL_RANGES', () => {
  test('keys match expected set', () => {
    expect(JOURNAL_RANGES.map((r) => r.key)).toEqual(['7d', '30d', '90d']);
  });

  test('days values are monotonically increasing', () => {
    const days = JOURNAL_RANGES.map((r) => r.days);
    for (let i = 1; i < days.length; i++) {
      expect(days[i]).toBeGreaterThan(days[i - 1]!);
    }
  });
});

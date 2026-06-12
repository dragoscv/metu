import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isQuietHoursActive } from '../quiet-hours';

/** Freeze "now" at a given UTC instant for each assertion. */
function at(iso: string) {
  vi.setSystemTime(new Date(iso));
}

describe('isQuietHoursActive', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns false for null/undefined/empty config', () => {
    expect(isQuietHoursActive(null)).toBe(false);
    expect(isQuietHoursActive(undefined)).toBe(false);
    expect(isQuietHoursActive({})).toBe(false);
  });

  it('returns false when disabled even inside the window', () => {
    at('2026-06-12T23:30:00Z');
    expect(isQuietHoursActive({ enabled: false, start: '22:00', end: '07:00', tz: 'UTC' })).toBe(
      false,
    );
  });

  it('returns false when start or end is missing', () => {
    at('2026-06-12T23:30:00Z');
    expect(isQuietHoursActive({ enabled: true, start: '22:00' })).toBe(false);
    expect(isQuietHoursActive({ enabled: true, end: '07:00' })).toBe(false);
  });

  it('same-day window: active inside, inactive outside', () => {
    const qh = { enabled: true, start: '09:00', end: '17:00', tz: 'UTC' };
    at('2026-06-12T12:00:00Z');
    expect(isQuietHoursActive(qh)).toBe(true);
    at('2026-06-12T08:59:00Z');
    expect(isQuietHoursActive(qh)).toBe(false);
    at('2026-06-12T17:00:00Z'); // end is exclusive
    expect(isQuietHoursActive(qh)).toBe(false);
  });

  it('overnight window wraps across midnight', () => {
    const qh = { enabled: true, start: '22:00', end: '07:00', tz: 'UTC' };
    at('2026-06-12T23:30:00Z');
    expect(isQuietHoursActive(qh)).toBe(true);
    at('2026-06-13T03:00:00Z');
    expect(isQuietHoursActive(qh)).toBe(true);
    at('2026-06-13T06:59:00Z');
    expect(isQuietHoursActive(qh)).toBe(true);
    at('2026-06-13T07:00:00Z');
    expect(isQuietHoursActive(qh)).toBe(false);
    at('2026-06-12T12:00:00Z');
    expect(isQuietHoursActive(qh)).toBe(false);
  });

  it('boundary minutes: start inclusive, end exclusive', () => {
    const qh = { enabled: true, start: '22:00', end: '07:00', tz: 'UTC' };
    at('2026-06-12T22:00:00Z');
    expect(isQuietHoursActive(qh)).toBe(true);
  });

  it('zero-length window (start === end) is never active', () => {
    at('2026-06-12T22:00:00Z');
    expect(isQuietHoursActive({ enabled: true, start: '22:00', end: '22:00', tz: 'UTC' })).toBe(
      false,
    );
  });

  it('respects the configured timezone', () => {
    // 23:00 in Bucharest (UTC+3 in June / DST) is 20:00 UTC.
    const qh = { enabled: true, start: '22:00', end: '07:00', tz: 'Europe/Bucharest' };
    at('2026-06-12T20:00:00Z'); // 23:00 local — inside window
    expect(isQuietHoursActive(qh)).toBe(true);
    at('2026-06-12T12:00:00Z'); // 15:00 local — outside
    expect(isQuietHoursActive(qh)).toBe(false);
  });

  it('invalid timezone fails closed (not quiet)', () => {
    at('2026-06-12T23:30:00Z');
    expect(
      isQuietHoursActive({ enabled: true, start: '22:00', end: '07:00', tz: 'Not/AZone' }),
    ).toBe(false);
  });

  it('tolerates malformed time strings without throwing', () => {
    at('2026-06-12T00:30:00Z');
    // 'garbage' parses to NaN minutes -> treated as 0:00; must not throw.
    expect(() =>
      isQuietHoursActive({ enabled: true, start: 'garbage', end: '07:00', tz: 'UTC' }),
    ).not.toThrow();
  });
});

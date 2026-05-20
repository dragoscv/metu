/**
 * Dashboard observatory — pure helpers for valence + recency styling.
 *
 * The brand mechanic: every tracked stream has a `valence` that determines
 * how it visually ages.
 *   - streak: longer = better (jade, rises, halo grows)
 *   - pulse:  recent activity (magenta, brightest now, dims gracefully)
 *   - drift:  gentle nudge (amber, warms over time, never red)
 */
import type { StreamItem, Valence } from './types';

const HOUR = 1000 * 60 * 60;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * Human-readable "time since" — past-tense only, never "in X days".
 * "just now" → "3m" → "2h" → "5d" → "3w" → "8mo" → "2y".
 */
export function humanTimeSince(anchorAt: string | Date | null): string {
  if (!anchorAt) return '—';
  const ts = typeof anchorAt === 'string' ? new Date(anchorAt).getTime() : anchorAt.getTime();
  if (!Number.isFinite(ts)) return '—';
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 60_000) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / 60_000)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < WEEK) return `${Math.floor(diff / DAY)}d`;
  if (diff < MONTH) return `${Math.floor(diff / WEEK)}w`;
  if (diff < YEAR) return `${Math.floor(diff / MONTH)}mo`;
  return `${Math.floor(diff / YEAR)}y`;
}

/**
 * Verbose form for tooltips and aria-labels: "3 hours since · 2026-05-13 09:17".
 */
export function verboseTimeSince(anchorAt: string | Date | null): string {
  if (!anchorAt) return 'no activity yet';
  const d = typeof anchorAt === 'string' ? new Date(anchorAt) : anchorAt;
  if (!Number.isFinite(d.getTime())) return 'no activity yet';
  const diff = Math.max(0, Date.now() - d.getTime());
  let phrase: string;
  if (diff < 60_000) phrase = 'just now';
  else if (diff < HOUR) phrase = `${Math.floor(diff / 60_000)} min ago`;
  else if (diff < DAY) phrase = `${Math.floor(diff / HOUR)} h ago`;
  else if (diff < WEEK) phrase = `${Math.floor(diff / DAY)} d ago`;
  else if (diff < MONTH) phrase = `${Math.floor(diff / WEEK)} wk ago`;
  else if (diff < YEAR) phrase = `${Math.floor(diff / MONTH)} mo ago`;
  else phrase = `${Math.floor(diff / YEAR)} yr ago`;
  return `${phrase} · ${d.toISOString().slice(0, 16).replace('T', ' ')}`;
}

/**
 * Recency score 0..1.
 *   1.0 = touched now (bright)
 *   0.0 = older than `staleAfterDays`
 * Logarithmic curve so the freshness halo doesn't fall off a cliff.
 */
export function recencyScore(anchorAt: string | Date | null, staleAfterDays = 60): number {
  if (!anchorAt) return 0;
  const ts = typeof anchorAt === 'string' ? new Date(anchorAt).getTime() : anchorAt.getTime();
  if (!Number.isFinite(ts)) return 0;
  const ageMs = Math.max(1, Date.now() - ts);
  const horizonMs = Math.max(DAY, staleAfterDays * DAY);
  const r = 1 - Math.log10(1 + (9 * ageMs) / horizonMs);
  return Math.max(0, Math.min(1, r));
}

/**
 * For STREAK valence the polarity is inverted: longer = brighter.
 * 0d = baseline 0.4 ember; 30d = 1.0; capped at 1.0.
 */
export function streakIntensity(anchorAt: string | Date | null): number {
  if (!anchorAt) return 0.4;
  const ts = typeof anchorAt === 'string' ? new Date(anchorAt).getTime() : anchorAt.getTime();
  if (!Number.isFinite(ts)) return 0.4;
  const days = Math.max(0, (Date.now() - ts) / DAY);
  // 0d → 0.4, 30d → 1.0, asymptotic above
  return Math.max(0.4, Math.min(1, 0.4 + days / 50));
}

export interface ValenceStyle {
  /** CSS variable name for the base hue. */
  colorVar: string;
  /** CSS variable name for the glow shadow. */
  shadowVar: string;
  /** SVG shape kind — color is never the only signal. */
  shape: 'circle' | 'leaf' | 'flame';
  /** Aria word for the valence. */
  aria: string;
}

export const VALENCE_STYLE: Record<Valence, ValenceStyle> = {
  streak: {
    colorVar: '--color-streak-jade',
    shadowVar: '--shadow-glow-streak',
    shape: 'leaf',
    aria: 'streak',
  },
  pulse: {
    colorVar: '--color-pulse',
    shadowVar: '--shadow-glow-pulse',
    shape: 'circle',
    aria: 'pulse',
  },
  drift: {
    colorVar: '--color-drift-amber',
    shadowVar: '--shadow-glow-drift',
    shape: 'flame',
    aria: 'drift',
  },
};

/**
 * Compute final visual intensity (0..1) for an item, factoring valence polarity.
 */
export function intensityFor(item: StreamItem, staleAfterDays = 60): number {
  if (item.valence === 'streak') return streakIntensity(item.anchorAt);
  return recencyScore(item.anchorAt, staleAfterDays);
}

/**
 * True if the item should be hidden entirely (older than user's stale horizon).
 * Streaks are never auto-hidden — they're trophies.
 */
export function isStale(item: StreamItem, staleAfterDays: number): boolean {
  if (staleAfterDays <= 0) return false;
  if (item.valence === 'streak') return false;
  const ts = new Date(item.anchorAt).getTime();
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts > staleAfterDays * DAY;
}

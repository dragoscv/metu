/**
 * Mood engine (Jarvis v5) — persistent emotional continuity.
 *
 * Two scalars drift with interactions and decay toward baseline:
 *   energy 0..1 — high after wins/celebrations, low late at night
 *   warmth 0..1 — grows with daily interaction streaks, drops after
 *                 long absences (it "misses you", then warms back up)
 *
 * Consumers:
 *   - greetings pick tone by mood ("3 days in a row! 🔥" vs "...oh, hi.")
 *   - idle-variety frequency scales with energy
 *   - emotion overlays bias (high warmth → more 'happy' beats)
 *
 * Persisted in localStorage; pure TS, no server round-trips.
 */

export interface Mood {
  energy: number; // 0..1
  warmth: number; // 0..1
  /** Consecutive calendar days with at least one interaction. */
  streakDays: number;
  lastInteractionTs: number;
  lastStreakDate: string; // YYYY-MM-DD
}

const KEY = 'metu.mood.v1';
const DEFAULTS: Mood = {
  energy: 0.6,
  warmth: 0.5,
  streakDays: 0,
  lastInteractionTs: 0,
  lastStreakDate: '',
};

function load(): Mood {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const m = JSON.parse(raw) as Mood;
    return {
      energy: clamp01(m.energy),
      warmth: clamp01(m.warmth),
      streakDays: Math.max(0, m.streakDays | 0),
      lastInteractionTs: m.lastInteractionTs || 0,
      lastStreakDate: m.lastStreakDate || '',
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(m: Mood): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5;
}

/** Time-of-day energy baseline: calm late night, perky mid-morning. */
function todBaseline(): number {
  const h = new Date().getHours();
  if (h >= 23 || h < 6) return 0.3;
  if (h >= 9 && h < 12) return 0.7;
  if (h >= 14 && h < 17) return 0.6;
  return 0.5;
}

/** Read the current mood (with passive decay applied). */
export function getMood(): Mood {
  const m = load();
  const hoursSince = (Date.now() - m.lastInteractionTs) / 3_600_000;
  // Energy decays toward the time-of-day baseline (half-life ~4h).
  const base = todBaseline();
  const decay = Math.min(1, hoursSince / 8);
  m.energy = clamp01(m.energy + (base - m.energy) * decay);
  // Warmth cools slowly over days of absence (half-life ~3 days).
  if (hoursSince > 24) m.warmth = clamp01(m.warmth - 0.1 * Math.min(3, hoursSince / 24));
  return m;
}

/** Events that move the mood. Call from interaction sites. */
export function recordMoodEvent(
  kind: 'interaction' | 'win' | 'error' | 'celebrate' | 'long-session',
): Mood {
  const m = getMood();
  const today = new Date().toISOString().slice(0, 10);
  if (kind === 'interaction' || kind === 'win' || kind === 'celebrate') {
    if (m.lastStreakDate !== today) {
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      m.streakDays = m.lastStreakDate === yesterday ? m.streakDays + 1 : 1;
      m.lastStreakDate = today;
    }
    m.lastInteractionTs = Date.now();
    m.warmth = clamp01(m.warmth + 0.02);
  }
  switch (kind) {
    case 'win':
      m.energy = clamp01(m.energy + 0.15);
      m.warmth = clamp01(m.warmth + 0.05);
      break;
    case 'celebrate':
      m.energy = clamp01(m.energy + 0.25);
      break;
    case 'error':
      m.energy = clamp01(m.energy - 0.08);
      break;
    case 'long-session':
      m.energy = clamp01(m.energy - 0.1); // tired together
      break;
  }
  save(m);
  return m;
}

/** Greeting flavor based on the persistent mood — used by Assistant. */
export function moodGreetingSuffix(): string | null {
  const m = getMood();
  if (m.streakDays >= 3) return ` ${m.streakDays} days in a row! 🔥`;
  const hoursSince = m.lastInteractionTs ? (Date.now() - m.lastInteractionTs) / 3_600_000 : 0;
  if (hoursSince > 72) return ' Missed you!';
  if (m.energy > 0.75) return ' Feeling sharp today.';
  if (m.energy < 0.35 && new Date().getHours() >= 22) return ' (quiet hours — keeping it low-key)';
  return null;
}

/** Idle-variety interval multiplier: high energy → more frequent antics. */
export function moodIdleMultiplier(): number {
  const e = getMood().energy;
  return e > 0.7 ? 0.7 : e < 0.35 ? 1.6 : 1;
}

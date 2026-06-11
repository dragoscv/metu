/**
 * Agent v2 Slice D — local learning loops.
 *
 * 1. Preference/correction capture: when the user's message states a
 *    durable preference ("always …", "never …", "call me …", "stop
 *    doing …") or corrects the assistant ("no, I meant …"), persist the
 *    statement to workspace memory via POST /companion/memory. The
 *    existing `recall` tool then surfaces it in every future turn —
 *    no new read path needed. Detection is a cheap local heuristic
 *    (zero latency, zero tokens); false negatives are fine, false
 *    positives are mostly harmless (it's the user's own words).
 *
 * 2. Suggestion outcome feedback: every proactive suggestion records
 *    whether the user ENGAGED (tapped a quick reply) or DISMISSED it.
 *    Per-category accept rates adapt the suggestion cooldown — a
 *    category you keep dismissing gets quieter (up to 4× the base
 *    cooldown), one you engage with stays prompt. Stored locally.
 */
import { ensureFreshAuth, type AuthState } from '../state/auth';

// ── 1. Preference / correction capture ─────────────────────────────────────

const PREFERENCE_RES: RegExp[] = [
  /\b(?:always|never)\s+\w+/i,
  /\bfrom now on\b/i,
  /\b(?:call me|address me as|my name is)\b/i,
  /\bI (?:prefer|like|want|hate|don't (?:like|want)|do not (?:like|want))\b/i,
  /\bstop (?:doing|suggesting|showing|asking)\b/i,
  /\b(?:respond|answer|reply|talk|speak)\s+(?:in|with)\s+\w+/i,
  /\bremember (?:that|this|to)\b/i,
];

const CORRECTION_RES: RegExp[] = [
  /^(?:no|nope|wrong|incorrect)\b[,.]?\s/i,
  /\bthat'?s (?:not|wrong|incorrect)\b/i,
  /\bI (?:meant|said|asked for)\b/i,
  /\bactually[,]?\s/i,
];

export type LearnKind = 'preference' | 'correction';

/** Classify a user utterance; null = nothing durable to remember. */
export function classifyLearnable(text: string): LearnKind | null {
  const t = text.trim();
  if (t.length < 8 || t.length > 600) return null;
  if (PREFERENCE_RES.some((re) => re.test(t))) return 'preference';
  if (CORRECTION_RES.some((re) => re.test(t))) return 'correction';
  return null;
}

// Session dedupe — don't re-store the same statement twice.
const stored = new Set<string>();

/**
 * Fire-and-forget: if the utterance is a learnable statement, persist it.
 * Never throws, never blocks the chat turn.
 */
export function maybeLearnFromUtterance(auth: AuthState, text: string): void {
  const kind = classifyLearnable(text);
  if (!kind) return;
  const key = text.trim().toLowerCase().slice(0, 120);
  if (stored.has(key)) return;
  stored.add(key);
  void (async () => {
    const fresh = await ensureFreshAuth(auth);
    if (!fresh) return;
    await fetch(`${fresh.apiBase}/api/sdk/v1/companion/memory`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${fresh.accessToken}`,
      },
      body: JSON.stringify({ kind, statement: text.trim(), surface: 'companion' }),
    });
  })().catch(() => {
    stored.delete(key); // retry-able next time
  });
}

// ── 2. Suggestion outcome feedback ──────────────────────────────────────────

export type SuggestionCategory = 'error' | 'return' | 'thrash' | 'other';

interface CategoryStats {
  shown: number;
  engaged: number;
}

const STATS_KEY = 'metu.learning.suggestionStats';

function loadStats(): Record<string, CategoryStats> {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (raw) return JSON.parse(raw) as Record<string, CategoryStats>;
  } catch {
    /* ignore */
  }
  return {};
}

function saveStats(stats: Record<string, CategoryStats>): void {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    /* ignore */
  }
}

/** Map a suggestion id (e.g. "err_171...") to its category. */
export function suggestionCategory(id: string): SuggestionCategory {
  if (id.startsWith('err_')) return 'error';
  if (id.startsWith('back_')) return 'return';
  if (id.startsWith('thrash_')) return 'thrash';
  return 'other';
}

export function recordSuggestionShown(category: SuggestionCategory): void {
  const stats = loadStats();
  const s = stats[category] ?? { shown: 0, engaged: 0 };
  s.shown++;
  stats[category] = s;
  saveStats(stats);
}

export function recordSuggestionEngaged(category: SuggestionCategory): void {
  const stats = loadStats();
  const s = stats[category] ?? { shown: 0, engaged: 0 };
  s.engaged++;
  stats[category] = s;
  saveStats(stats);
}

/**
 * Cooldown multiplier for a category: 1× while we have little data or the
 * user engages; up to 4× for categories that get consistently dismissed.
 * (≥5 shown with <20% engagement → 4×; <40% → 2×.)
 */
export function cooldownMultiplier(category: SuggestionCategory): number {
  const s = loadStats()[category];
  if (!s || s.shown < 5) return 1;
  const rate = s.engaged / s.shown;
  if (rate < 0.2) return 4;
  if (rate < 0.4) return 2;
  return 1;
}

// ── 3. Weekly self-reflection ───────────────────────────────────────────────

const REFLECT_KEY = 'metu.learning.lastReflection';

/**
 * Once a week, distill the suggestion outcome stats into a short natural-
 * language insight and persist it as a preference memory — so the server-
 * side agent ALSO learns what kinds of interruptions this user values
 * (the local cooldown multiplier only throttles; this makes the knowledge
 * portable across surfaces, including mobile later).
 */
export function maybeWeeklyReflection(auth: AuthState): void {
  const now = Date.now();
  try {
    const last = Number(localStorage.getItem(REFLECT_KEY) ?? 0);
    if (now - last < 7 * 24 * 60 * 60_000) return;
    localStorage.setItem(REFLECT_KEY, String(now));
  } catch {
    return;
  }
  const stats = loadStats();
  const parts: string[] = [];
  for (const [cat, s] of Object.entries(stats)) {
    if (s.shown < 3) continue;
    const rate = Math.round((s.engaged / s.shown) * 100);
    const label =
      cat === 'error'
        ? 'error-help offers'
        : cat === 'return'
          ? 'welcome-back catch-ups'
          : cat === 'thrash'
            ? 'context-switching help'
            : 'misc suggestions';
    parts.push(`${label}: engages ${rate}% of the time (${s.engaged}/${s.shown})`);
  }
  if (parts.length === 0) return;
  void (async () => {
    const fresh = await ensureFreshAuth(auth);
    if (!fresh) return;
    await fetch(`${fresh.apiBase}/api/sdk/v1/companion/memory`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${fresh.accessToken}`,
      },
      body: JSON.stringify({
        kind: 'preference',
        statement: `Proactive-suggestion engagement this week — ${parts.join('; ')}. Calibrate proactivity accordingly.`,
        surface: 'companion',
      }),
    });
  })().catch(() => {});
}

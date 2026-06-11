/**
 * Smart contextual chips (Jarvis v4.1) — replaces the static
 * QUICK_REPLIES bank for ambient/greeting bubbles.
 *
 * Two layers:
 *   1. INSTANT (this module, pure local): chips derived from live
 *      activity — app class, time of day, how long the current context
 *      has held, idle return. Zero latency, always relevant-ish.
 *   2. UPGRADE (caller): the `anticipate`/skill responses carry
 *      LLM-grounded chips via the CHIPS trailer, which override these
 *      when present.
 *
 * Rotation: pick 3 from the weighted candidate pool, seeded by the
 * hour so the same session doesn't flicker but days vary.
 */
import { getActivityState } from './activityModel';

interface Candidate {
  text: string;
  weight: number;
}

export function getSmartChips(): string[] {
  const act = getActivityState();
  const hour = new Date().getHours();
  const heldMin = (Date.now() - act.sinceTs) / 60_000;
  const pool: Candidate[] = [];

  // Time-of-day rhythm.
  if (hour >= 5 && hour < 11) pool.push({ text: 'Morning brief', weight: 3 });
  if (hour >= 17 || hour < 2) pool.push({ text: 'Wrap up my day', weight: 2.5 });

  // App-class grounding — the most "it sees me" signal.
  switch (act.appClass) {
    case 'coding':
      pool.push(
        { text: 'Analyze my screen', weight: 3 },
        { text: 'What does this error mean?', weight: 1.5 },
        { text: `run git status`, weight: 2 },
      );
      break;
    case 'browsing':
      pool.push(
        { text: 'Summarize this page', weight: 3 },
        { text: 'Analyze my screen', weight: 2 },
      );
      break;
    case 'writing':
      pool.push(
        { text: 'Improve this paragraph', weight: 3 },
        { text: 'Analyze my screen', weight: 2 },
      );
      break;
    case 'comms':
      pool.push({ text: 'Draft a reply', weight: 3 }, { text: 'Catch me up', weight: 2 });
      break;
    case 'media':
      pool.push({ text: "What's next on my plate?", weight: 3 });
      break;
    default:
      pool.push({ text: 'Analyze my screen', weight: 1.5 });
  }

  // Project context → continuity pulls.
  if (act.projectGuess) {
    pool.push({ text: `Where was I on ${act.projectGuess.slice(0, 24)}?`, weight: 2.5 });
  }

  // Long single-context stretch → maybe stuck; short → just switched.
  if (heldMin > 45) pool.push({ text: 'Suggest a break point', weight: 1.5 });
  if (heldMin < 2) pool.push({ text: 'Catch me up', weight: 2 });

  // Universal fallbacks (low weight — only when context is thin).
  pool.push({ text: "What's next on my plate?", weight: 1 }, { text: 'Catch me up', weight: 0.8 });

  // Weighted sample without replacement, deterministic-ish per hour so
  // chips don't flicker between consecutive bubbles.
  const seed = hour * 7 + new Date().getDate();
  const picked: string[] = [];
  const candidates = [...pool];
  let s = seed;
  while (picked.length < 3 && candidates.length > 0) {
    const total = candidates.reduce((sum, c) => sum + c.weight, 0);
    s = (s * 9301 + 49297) % 233280; // LCG
    let r = (s / 233280) * total;
    let idx = 0;
    for (let i = 0; i < candidates.length; i++) {
      r -= candidates[i]!.weight;
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    const c = candidates.splice(idx, 1)[0]!;
    if (!picked.includes(c.text)) picked.push(c.text);
  }
  return picked;
}

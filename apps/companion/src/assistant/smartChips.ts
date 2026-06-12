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
import { loadAssistantLanguage } from '../state/language';

/**
 * Chip i18n (Jarvis v9.1): display labels follow the ASSISTANT language,
 * but routing stays canonical-English — `canonicalChip()` reverse-maps a
 * tapped RO label back to the EN key the SKILL_CHIPS router expects.
 */
const CHIP_RO: Record<string, string> = {
  'Morning brief': 'Brief de dimineață',
  'Wrap up my day': 'Încheie-mi ziua',
  'Analyze my screen': 'Analizează-mi ecranul',
  'What does this error mean?': 'Ce înseamnă eroarea asta?',
  'Summarize this page': 'Rezumă pagina asta',
  'Improve this paragraph': 'Îmbunătățește paragraful',
  'Draft a reply': 'Schițează un răspuns',
  'Catch me up': 'Pune-mă la curent',
  "What's next on my plate?": 'Ce urmează pentru mine?',
  'Suggest a break point': 'Sugerează o pauză',
};
const CHIP_RO_REVERSE = new Map(Object.entries(CHIP_RO).map(([en, ro]) => [ro, en]));

/** Display-localize a canonical chip (prefix chips keep their dynamic tail). */
export function localizeChip(text: string): string {
  if (loadAssistantLanguage() !== 'ro') return text;
  if (CHIP_RO[text]) return CHIP_RO[text];
  const wasI = /^Where was I on (.+)\?$/.exec(text);
  if (wasI) return `Unde rămăsesem la ${wasI[1]}?`;
  return text;
}

/** Reverse-map a (possibly localized) tapped label to its canonical key. */
export function canonicalChip(text: string): string {
  const direct = CHIP_RO_REVERSE.get(text);
  if (direct) return direct;
  const wasI = /^Unde rămăsesem la (.+)\?$/.exec(text);
  if (wasI) return `Where was I on ${wasI[1]}?`;
  return text;
}

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
  return picked.map(localizeChip);
}

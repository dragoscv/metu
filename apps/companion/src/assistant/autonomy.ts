/**
 * Autonomy engine (Jarvis v6) — the assistant works in the BACKGROUND.
 *
 * Three loops, all silent until they have something:
 *
 *   1. NOTICER — scans recent screen text every 3min for actionable
 *      fragments (TODOs, FIXMEs, bug mentions, "remember to…"). Drafts a
 *      capture in the console inbox (never schedules/assigns) and keeps
 *      a note to mention casually later.
 *
 *   2. PRE-RESEARCHER — when the suggestion engine reports a stuck error,
 *      pre-fetches recall + screen context in the background so the
 *      moment the user taps "help", the answer is instant and grounded.
 *
 *   3. TRIGGER WATCHERS — agent-finished, repeated-search,
 *      end-of-session: new high-signal moments that surface as
 *      ACTION CARDS (concrete chips that execute lanes) + a short
 *      narrative line (the user asked for both styles).
 *
 * Everything respects proactivity mode and the existing learning
 * cooldowns. Capture drafting is the ONLY world-write, and it goes to
 * the INBOX (reversible, visible, never auto-promoted).
 */
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../state/runtime';
import { getActivityState } from './activityModel';
import { loadProactivity } from './proactivity';
import type { AuthState } from '../state/auth';
import { ensureFreshAuth } from '../state/auth';

export interface ActionCard {
  /** Narrative line for the bubble. */
  text: string;
  /** Concrete action chips — routed through quickReply lanes. */
  actions: string[];
  /** Suggestion id for the learning loop. */
  id: string;
}

interface AutonomyOpts {
  auth: AuthState;
  onCard: (card: ActionCard) => void;
}

/** Patterns worth noting into the inbox. */
const NOTICE_RES: Array<[RegExp, string]> = [
  [/\bTODO[:\s]+([^\n]{8,120})/i, 'TODO'],
  [/\bFIXME[:\s]+([^\n]{8,120})/i, 'FIXME'],
  [/\bremember to\s+([^\n]{8,120})/i, 'reminder'],
  [/\bdon'?t forget\s+(?:to\s+)?([^\n]{8,120})/i, 'reminder'],
  [/\bbug[:\s]+([^\n]{8,120})/i, 'bug'],
];

const NOTICED_KEY = 'metu.autonomy.noticed.v1';

function loadNoticed(): string[] {
  try {
    const raw = localStorage.getItem(NOTICED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveNoticed(list: string[]): void {
  try {
    localStorage.setItem(NOTICED_KEY, JSON.stringify(list.slice(-60)));
  } catch {
    /* ignore */
  }
}

/** Normalized fingerprint so re-seeing the same TODO doesn't re-draft. */
function fp(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
}

async function draftCapture(auth: AuthState, text: string, label: string): Promise<boolean> {
  try {
    const fresh = (await ensureFreshAuth(auth)) ?? auth;
    const res = await fetch(`${fresh.apiBase.replace(/\/$/, '')}/api/sdk/v1/capture`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${fresh.accessToken}`,
      },
      body: JSON.stringify({
        kind: 'note',
        content: `[noticed on screen — ${label}] ${text}`,
        source: 'companion',
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Pre-research cache: question → prepared context, consumed by skills. */
let preparedContext: { query: string; content: string; at: number } | null = null;

export function consumePreparedContext(query: string): string | null {
  if (!preparedContext) return null;
  if (Date.now() - preparedContext.at > 10 * 60_000) {
    preparedContext = null;
    return null;
  }
  const c = preparedContext.content;
  preparedContext = null;
  return c;
}

async function preResearch(auth: AuthState, errorText: string): Promise<void> {
  try {
    const fresh = (await ensureFreshAuth(auth)) ?? auth;
    const res = await fetch(`${fresh.apiBase.replace(/\/$/, '')}/api/sdk/v1/recall`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${fresh.accessToken}`,
      },
      body: JSON.stringify({ query: errorText.slice(0, 300), k: 4 }),
    });
    if (!res.ok) return;
    const json = (await res.json()) as Array<{ content?: string }>;
    const hits = (Array.isArray(json) ? json : [])
      .map((r) => r.content)
      .filter(Boolean)
      .join('\n');
    if (hits) {
      preparedContext = {
        query: errorText.slice(0, 100),
        content: `[Pre-researched memory matches]\n${hits.slice(0, 2_000)}`,
        at: Date.now(),
      };
    }
  } catch {
    /* best-effort */
  }
}

/** Agent-finished heuristics: VS Code title patterns + completion words. */
const AGENT_DONE_RES = /\b(completed|finished|done|all tests pass|committed|56[0-9] passed)\b/i;

export function startAutonomy(opts: AutonomyOpts): () => void {
  if (!isTauri()) return () => {};
  const noticed = new Set(loadNoticed());
  let lastNoticeAt = 0;
  let lastSearches: string[] = [];
  let searchCardAt = 0;
  let agentCardAt = 0;
  let eodOfferedDate = '';
  let lastErrorResearch = 0;

  // ── Loop 1+3: scan recent text every 3min ─────────────────────────────
  const scanTimer = setInterval(() => {
    void (async () => {
      if (loadProactivity() === 'silent') return;
      const act = getActivityState();
      if (!act.watching) return;
      const text = await invoke<string>('sense_recent_text', {
        minutes: 4,
        maxChars: 5_000,
      }).catch(() => '');
      if (!text) return;

      // NOTICER: actionable fragments → inbox draft (max 1 per 10min).
      if (Date.now() - lastNoticeAt > 10 * 60_000) {
        for (const [re, label] of NOTICE_RES) {
          const m = re.exec(text);
          const frag = m?.[1]?.trim();
          if (!frag) continue;
          const key = fp(frag);
          if (noticed.has(key)) continue;
          noticed.add(key);
          saveNoticed([...noticed]);
          lastNoticeAt = Date.now();
          void draftCapture(opts.auth, frag, label).then((ok) => {
            if (ok) {
              opts.onCard({
                id: `noticed_${Date.now()}`,
                text: `I noted that ${label} you scrolled past — it's in your inbox.`,
                actions: ['Catch me up', 'Analyze my screen'],
              });
            }
          });
          break;
        }
      }

      // PRE-RESEARCH: error visible → fetch memory context silently.
      if (
        /\b(error|exception|failed|traceback|panic)\b/i.test(text) &&
        Date.now() - lastErrorResearch > 5 * 60_000
      ) {
        lastErrorResearch = Date.now();
        const errLine = /[^\n]*\b(?:error|exception|failed)\b[^\n]*/i.exec(text)?.[0] ?? '';
        if (errLine) void preResearch(opts.auth, errLine);
      }

      // AGENT-FINISHED: completion phrases while in an editor/terminal.
      if (
        (act.appClass === 'coding' || /terminal/i.test(act.app)) &&
        AGENT_DONE_RES.test(text) &&
        Date.now() - agentCardAt > 15 * 60_000
      ) {
        agentCardAt = Date.now();
        opts.onCard({
          id: `agent_done_${Date.now()}`,
          text: 'Looks like one of your agents just finished its run.',
          actions: ['Catch me up', 'run git log --oneline -5', 'Analyze my screen'],
        });
      }

      // REPEATED-SEARCH: same rare term across recent samples.
      const words = (text.toLowerCase().match(/\b[a-z][a-z0-9_-]{5,24}\b/g) ?? []).filter(
        (w) => !/^(function|return|import|export|const|interface)$/.test(w),
      );
      const counts = new Map<string, number>();
      for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
      const hot = [...counts.entries()].filter(([, n]) => n >= 6).map(([w]) => w);
      const repeatedAcross = hot.find((w) => lastSearches.includes(w));
      lastSearches = hot.slice(0, 20);
      if (repeatedAcross && Date.now() - searchCardAt > 20 * 60_000) {
        searchCardAt = Date.now();
        opts.onCard({
          id: `search_${Date.now()}`,
          text: `You keep circling "${repeatedAcross}" — I can dig through my memory for it.`,
          actions: [`Where was I on ${repeatedAcross}?`, 'Catch me up'],
        });
      }

      // END-OF-SESSION: evening + idle creep → offer the wrap ONCE per day.
      const today = new Date().toISOString().slice(0, 10);
      const hour = new Date().getHours();
      if (
        hour >= 18 &&
        eodOfferedDate !== today &&
        act.focusDepth === 'idle' &&
        loadProactivity() !== 'silent'
      ) {
        eodOfferedDate = today;
        opts.onCard({
          id: `eod_${Date.now()}`,
          text: 'Winding down? I can wrap the day and note where to pick up tomorrow.',
          actions: ['Wrap up my day', "What's next on my plate?"],
        });
      }
    })();
  }, 3 * 60_000);

  return () => clearInterval(scanTimer);
}

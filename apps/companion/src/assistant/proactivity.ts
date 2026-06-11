/**
 * Jarvis Slice D — proactivity modes + suggestion engine.
 *
 * Mode controls WHEN the assistant is allowed to initiate (mood/personality
 * controls HOW it sounds — orthogonal, both user-switchable):
 *
 *   silent → never initiates; perfect awareness, speaks only when summoned
 *   aware  → (default) initiates only when confidence is high AND the user
 *            is not in deep focus
 *   chatty → comments freely, like a pair-programming buddy
 *
 * The suggestion engine watches the ActivityModel and emits gated
 * suggestions through a callback the Assistant window turns into bubbles
 * (and, in chatty mode + voice later, spoken interjections). Triggers are
 * deliberately few and high-signal:
 *
 *   return-from-idle   → "catch me up" offer after ≥10min away
 *   error-on-screen    → repeated error text in OCR while app unchanged
 *   context-thrash     → ≥8 app switches in 3min = lost context, offer help
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '../state/runtime';
import { getActivityState } from './activityModel';

export type ProactivityMode = 'silent' | 'aware' | 'chatty';

const MODE_KEY = 'metu.companion.proactivity';

export function loadProactivity(): ProactivityMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === 'silent' || v === 'aware' || v === 'chatty') return v;
  } catch {
    /* ignore */
  }
  return 'aware';
}

export function saveProactivity(mode: ProactivityMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
    window.dispatchEvent(new CustomEvent('metu:proactivity', { detail: mode }));
  } catch {
    /* ignore */
  }
}

export function onProactivityChange(cb: (m: ProactivityMode) => void): () => void {
  const handler = (e: Event) => {
    const m = (e as CustomEvent<ProactivityMode>).detail;
    if (m === 'silent' || m === 'aware' || m === 'chatty') cb(m);
  };
  window.addEventListener('metu:proactivity', handler);
  return () => window.removeEventListener('metu:proactivity', handler);
}

// ── Suggestion engine ──────────────────────────────────────────────────────

export interface Suggestion {
  id: string;
  /** Bubble text. */
  text: string;
  /** One-tap quick replies for the bubble. */
  quickReplies?: string[];
  /** high → allowed in aware mode; low → chatty only. */
  confidence: 'high' | 'low';
  /** Ask the director to walk beside the active window when surfacing. */
  approach?: boolean;
}

interface EngineOpts {
  onSuggest: (s: Suggestion) => void;
}

const SUGGEST_COOLDOWN_MS = 4 * 60_000; // global: at most one suggestion / 4min
const ERROR_WORDS = /\b(error|exception|failed|cannot|unhandled|traceback|panic)\b/i;

type SenseEvent =
  | { kind: 'focus'; ts: number; app: string; title: string }
  | { kind: 'frame'; ts: number; app: string; chars: number; deduped: boolean }
  | { kind: 'privacy'; ts: number; paused: boolean; reason: string }
  | { kind: 'idle'; ts: number; idle: boolean; idleMs: number };

export function startSuggestionEngine(opts: EngineOpts): () => void {
  if (!isTauri()) return () => {};

  let mode = loadProactivity();
  const offMode = onProactivityChange((m) => {
    mode = m;
  });

  let lastSuggestAt = 0;
  let idleSince: number | null = null;
  let switchTimes: number[] = [];
  let errorStreak = 0;
  let errorApp = '';

  const gate = (s: Suggestion): void => {
    if (mode === 'silent') return;
    if (mode === 'aware') {
      if (s.confidence !== 'high') return;
      if (getActivityState().focusDepth === 'deep') return;
    }
    const now = Date.now();
    if (now - lastSuggestAt < SUGGEST_COOLDOWN_MS) return;
    lastSuggestAt = now;
    if (s.approach) {
      window.dispatchEvent(new CustomEvent('metu:assistant-approach'));
    }
    opts.onSuggest(s);
  };

  // Error detection: poll recent OCR text on a slow cadence; a repeated
  // error word in the SAME app across 2+ samples = probably stuck.
  const errTimer = setInterval(() => {
    void (async () => {
      if (mode === 'silent') return;
      const act = getActivityState();
      if (act.appClass !== 'coding' && act.appClass !== 'browsing') return;
      const text = await invoke<string>('sense_recent_text', {
        minutes: 2,
        maxChars: 2_000,
      }).catch(() => '');
      if (ERROR_WORDS.test(text)) {
        if (errorApp === act.app) errorStreak++;
        else {
          errorApp = act.app;
          errorStreak = 1;
        }
        if (errorStreak >= 2) {
          errorStreak = 0;
          gate({
            id: `err_${Date.now()}`,
            text: 'That error has been on screen for a bit — want me to look at it?',
            quickReplies: ['What does this error mean?', 'Suggest a fix'],
            confidence: 'high',
            approach: true,
          });
        }
      } else {
        errorStreak = 0;
      }
    })();
  }, 90_000);

  let unlisten: (() => void) | undefined;
  void listen<SenseEvent>('metu://sense', (e) => {
    const ev = e.payload;
    if (ev.kind === 'idle') {
      if (ev.idle) {
        idleSince = ev.ts;
      } else if (idleSince && ev.ts - idleSince >= 10 * 60_000) {
        idleSince = null;
        gate({
          id: `back_${Date.now()}`,
          text: 'Welcome back. Want a quick catch-up on where you left off?',
          quickReplies: ['Catch me up', 'What was I doing?'],
          confidence: 'high',
        });
      } else {
        idleSince = null;
      }
    }
    if (ev.kind === 'focus') {
      const now = ev.ts;
      switchTimes.push(now);
      const cutoff = now - 3 * 60_000;
      switchTimes = switchTimes.filter((t) => t >= cutoff);
      if (switchTimes.length >= 8) {
        switchTimes = [];
        gate({
          id: `thrash_${Date.now()}`,
          text: 'Lots of context switching — looking for something? I can help.',
          quickReplies: ['What was I doing?', 'Find my last file'],
          confidence: 'low',
        });
      }
    }
  }).then((fn) => {
    unlisten = fn;
  });

  return () => {
    offMode();
    clearInterval(errTimer);
    unlisten?.();
  };
}

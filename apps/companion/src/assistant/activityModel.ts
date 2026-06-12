/**
 * Jarvis Slice B — ActivityModel + distiller.
 *
 * Listens to `metu://sense` events from the native sense engine and keeps a
 * live, queryable picture of what the user is doing:
 *
 *   { app, title, appClass, projectGuess, focusDepth, idle, watching }
 *
 * Every DISTILL_MS (and on demand) it reduces the local activity timeline
 * to a compact text summary and ships it to
 * `POST /api/sdk/v1/companion/activity` — summaries only, never raw OCR.
 * The first version distills heuristically (app times + titles + top
 * screen-text keywords); a codai-polished pass can replace `summarize()`
 * later without touching callers.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ensureFreshAuth, type AuthState } from '../state/auth';
import { isTauri } from '../state/runtime';

export type AppClass =
  | 'coding'
  | 'browsing'
  | 'writing'
  | 'comms'
  | 'media'
  | 'design'
  | 'mixed'
  | 'idle';

export type FocusDepth = 'deep' | 'normal' | 'idle';

export interface ActivityState {
  app: string;
  title: string;
  appClass: AppClass;
  projectGuess: string | null;
  focusDepth: FocusDepth;
  /** Sense engine watching (false = user paused or privacy gate). */
  watching: boolean;
  /** Epoch ms of the last focus change — how long current context held. */
  sinceTs: number;
}

const APP_CLASSES: Array<[RegExp, AppClass]> = [
  [/code|cursor|webstorm|rider|idea|pycharm|visual studio|zed|sublime/i, 'coding'],
  [/chrome|edge|firefox|brave|arc|opera/i, 'browsing'],
  [/word|notion|obsidian|typora|onenote|notepad/i, 'writing'],
  [/slack|discord|teams|telegram|whatsapp|signal|outlook|thunderbird|mail/i, 'comms'],
  [/spotify|vlc|youtube music|netflix|mpv/i, 'media'],
  [/figma|photoshop|illustrator|blender|krita|gimp|affinity/i, 'design'],
];

/** Window-title fragments that suggest a repo/project (e.g. "file — metu — VS Code"). */
const PROJECT_HINTS = /[-—·|]\s*([a-z0-9_.-]{2,40})\s*[-—·|]/i;

function classify(app: string, title: string): AppClass {
  for (const [re, cls] of APP_CLASSES) {
    if (re.test(app) || re.test(title)) return cls;
  }
  return 'mixed';
}

/** App names that must never be mistaken for a project. */
const APP_NAME_NOISE =
  /^(visual studio(?: code)?(?:\s*-?\s*insiders)?|vs ?code|code|chrome|google chrome|microsoft edge|edge|firefox|brave|notepad(?:\+\+)?|explorer|slack|discord|teams|telegram|outlook|spotify|terminal|powershell|cmd|wsl)$/i;

/** Strip editor dirty-markers / decorations a title segment may carry. */
function cleanSegment(seg: string | undefined): string | null {
  const s = seg?.replace(/^[*●✳•○◌\s]+/, '').trim();
  return s ? s.slice(0, 60) : null;
}

/**
 * A plausible project/repo/folder name — short, no sentence-like spacing.
 * Rejects tab titles like "Generated super-admin page" that aren't projects.
 */
function looksLikeProject(s: string): boolean {
  return !APP_NAME_NOISE.test(s) && !/\s/.test(s) && s.length >= 2;
}

function guessProject(title: string): string | null {
  // VS Code style: "<file> - <folder> - Visual Studio Code"
  const parts = title.split(/\s[-—]\s/);
  const candidate =
    parts.length >= 3
      ? cleanSegment(parts[parts.length - 2])
      : cleanSegment(PROJECT_HINTS.exec(title)?.[1]);
  // Reject app names ("Where was I on Visual Studio Code?" chip bug) —
  // a 2-part title like "metu - Visual Studio Code" has the APP last and
  // nothing project-like; titles can also end up with the app in the
  // middle segment on some windows.
  if (!candidate || !looksLikeProject(candidate)) {
    // Salvage: for 2-part titles take the FIRST part when the last is an
    // app name ("metu - Visual Studio Code" → "metu").
    if (parts.length === 2 && APP_NAME_NOISE.test(parts[1]?.trim() ?? '')) {
      const first = cleanSegment(parts[0]);
      // The first segment of a 2-part title is usually a FILE or tab
      // title ("*Generated super-admin page"), not a project — only
      // accept slug-like names with no whitespace.
      return first && looksLikeProject(first) ? first : null;
    }
    return null;
  }
  return candidate;
}

// ── Live model ─────────────────────────────────────────────────────────────

type SenseEvent =
  | {
      kind: 'focus';
      ts: number;
      app: string;
      title: string;
      x: number;
      y: number;
      w: number;
      h: number;
    }
  | { kind: 'frame'; ts: number; app: string; chars: number; deduped: boolean }
  | { kind: 'privacy'; ts: number; paused: boolean; reason: string }
  | { kind: 'idle'; ts: number; idle: boolean; idleMs: number };

const state: ActivityState = {
  app: '',
  title: '',
  appClass: 'mixed',
  projectGuess: null,
  focusDepth: 'normal',
  watching: true,
  sinceTs: Date.now(),
};

const listeners = new Set<(s: ActivityState) => void>();

export function getActivityState(): ActivityState {
  return { ...state };
}

export function onActivityChange(fn: (s: ActivityState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  const snapshot = getActivityState();
  for (const fn of listeners) fn(snapshot);
}

/** Focus-switch counter for deep-focus detection (few switches = deep). */
let switchTimestamps: number[] = [];

export function startActivityModel(): () => void {
  if (!isTauri()) return () => {};
  let unlisten: (() => void) | undefined;
  void listen<SenseEvent>('metu://sense', (e) => {
    const ev = e.payload;
    switch (ev.kind) {
      case 'focus': {
        state.app = ev.app;
        state.title = ev.title;
        state.appClass = classify(ev.app, ev.title);
        state.projectGuess = guessProject(ev.title) ?? state.projectGuess;
        state.sinceTs = ev.ts;
        switchTimestamps.push(ev.ts);
        const cutoff = Date.now() - 5 * 60_000;
        switchTimestamps = switchTimestamps.filter((t) => t >= cutoff);
        // Deep focus: same context ≥5min with ≤2 switches in the window.
        state.focusDepth = switchTimestamps.length <= 2 ? 'deep' : 'normal';
        emit();
        break;
      }
      case 'idle': {
        state.focusDepth = ev.idle ? 'idle' : 'normal';
        emit();
        break;
      }
      case 'privacy': {
        state.watching = !ev.paused;
        emit();
        break;
      }
      case 'frame':
        // Frames update nothing visible; the store accumulates silently.
        break;
    }
  }).then((fn) => {
    unlisten = fn;
  });
  return () => unlisten?.();
}

// ── Distiller ──────────────────────────────────────────────────────────────

const DISTILL_MS = 15 * 60_000;

interface TimelineEntry {
  app: string;
  title: string;
  startedTs: number;
  endedTs: number | null;
}

/** Heuristic local distillation — no LLM, no cost, good enough to recall. */
function summarize(entries: TimelineEntry[], startTs: number, endTs: number) {
  if (entries.length === 0) return null;
  const byApp = new Map<string, number>();
  const titles = new Map<string, number>();
  for (const e of entries) {
    const dur = (e.endedTs ?? endTs) - e.startedTs;
    if (dur <= 0) continue;
    byApp.set(e.app, (byApp.get(e.app) ?? 0) + dur);
    if (e.title) titles.set(e.title, (titles.get(e.title) ?? 0) + dur);
  }
  const apps = [...byApp.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a);
  const topTitles = [...titles.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([t]) => t.slice(0, 120));
  if (apps.length === 0) return null;

  const cls = classify(apps[0] ?? '', topTitles[0] ?? '');
  const project = topTitles.map(guessProject).find(Boolean) ?? null;
  const minutes = Math.round((endTs - startTs) / 60_000);
  const summary = [
    `${minutes}min mostly in ${apps.slice(0, 3).join(', ')}.`,
    topTitles.length ? `Contexts: ${topTitles.join(' | ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    startTs,
    endTs,
    kind: 'periodic' as const,
    summary: summary.slice(0, 2_000),
    apps: apps.slice(0, 12),
    projectGuess: project,
    activityClass: cls,
  };
}

async function distillOnce(auth: AuthState): Promise<void> {
  const endTs = Date.now();
  const startTs = endTs - DISTILL_MS;
  const entries = await invoke<TimelineEntry[]>('sense_timeline', {
    sinceTs: startTs,
    limit: 500,
  }).catch(() => [] as TimelineEntry[]);
  const payload = summarize(entries, startTs, endTs);
  if (!payload) return;

  // Persist locally regardless of sync result.
  const fresh = (await ensureFreshAuth(auth).catch(() => null)) ?? auth;
  let synced = false;
  try {
    const res = await fetch(`${fresh.apiBase}/api/sdk/v1/companion/activity`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${fresh.accessToken}`,
      },
      body: JSON.stringify(payload),
    });
    synced = res.ok;
  } catch {
    synced = false;
  }
  await invoke('sense_store_summary', {
    kind: payload.kind,
    summary: payload.summary,
    synced,
  }).catch(() => {});
}

/** Start the periodic distiller. Returns a stop function. */
export function startDistiller(auth: AuthState): () => void {
  if (!isTauri()) return () => {};
  const timer = setInterval(() => {
    void distillOnce(auth);
  }, DISTILL_MS);
  return () => clearInterval(timer);
}

/** On-demand "catch me up" context: recent screen text + timeline. */
export async function catchMeUpContext(): Promise<string> {
  const [recent, timeline] = await Promise.all([
    invoke<string>('sense_recent_text', { minutes: 30, maxChars: 3000 }).catch(() => ''),
    invoke<TimelineEntry[]>('sense_timeline', {
      sinceTs: Date.now() - 4 * 3600_000,
      limit: 100,
    }).catch(() => [] as TimelineEntry[]),
  ]);
  const apps = [...new Set(timeline.map((t) => t.app))].slice(0, 8);
  return [
    apps.length ? `Recent apps: ${apps.join(', ')}` : '',
    recent ? `Recent screen text:\n${recent}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Live screen context for a conversation turn (chat OR voice): focused
 * app/window/project header + last few minutes of on-screen text.
 * Privacy-gated natively (sense engine pauses on sensitive contexts);
 * capped to stay well under the server's 6KB screenContext limit.
 * Returns '' outside Tauri or on any failure.
 */
export async function fetchScreenContext(): Promise<string> {
  if (!isTauri()) return '';
  const act = getActivityState();
  const [recent, windows] = await Promise.all([
    invoke<string>('sense_recent_text', { minutes: 5, maxChars: 3_200 }).catch(() => ''),
    // Cross-window synthesis (Jarvis v10): ALL visible windows, not just
    // the focused one — the orchestrator's parallel agent runs become
    // visible to the model. Agent-chat windows are flagged explicitly.
    invoke<Array<{ app: string; title: string; minimized: boolean }>>('sense_window_map')
      .then((wins) =>
        wins
          .filter((w) => !w.minimized && w.title && !/^metu/i.test(w.app))
          .slice(0, 12)
          .map((w) => {
            const isAgent =
              /copilot|codai|chat|agent/i.test(w.title) && /code|cursor|insiders/i.test(w.app);
            return `- ${w.app}: ${w.title.slice(0, 90)}${isAgent ? ' [AGENT SESSION]' : ''}`;
          })
          .join('\n'),
      )
      .catch(() => ''),
  ]);
  const head = act.app
    ? `Focused: ${act.app}${act.title ? ` — ${act.title}` : ''} (${act.appClass}${
        act.projectGuess ? `, project: ${act.projectGuess}` : ''
      })`
    : '';
  const ctx = [head, windows ? `Open windows:\n${windows}` : '', recent].filter(Boolean).join('\n');
  return ctx.length > 5_800 ? ctx.slice(0, 5_800) : ctx;
}

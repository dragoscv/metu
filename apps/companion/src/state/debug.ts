/**
 * Front-end debug bus + diagnostics client.
 *
 * `log()` records a structured line into an in-memory ring (for the in-app
 * Debug panel), mirrors it to the Rust file-backed log (so "Copy diagnostics"
 * includes it and it survives a crash), and—when VITE_DEBUG is set—prints to
 * the webview console.
 *
 * Everything is best-effort and synchronous-feeling; the Rust mirror is fire
 * and forget so logging never blocks the UI.
 */
import { invoke } from '@tauri-apps/api/core';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DebugLine {
  at: number;
  level: LogLevel;
  scope: string;
  msg: string;
}

const RING_CAP = 400;
const ring: DebugLine[] = [];
type Listener = (lines: DebugLine[]) => void;
const listeners = new Set<Listener>();

const VERBOSE = Boolean(import.meta.env.VITE_DEBUG);

export function log(level: LogLevel, scope: string, msg: string, extra?: unknown) {
  const full = extra !== undefined ? `${msg} ${safe(extra)}` : msg;
  const line: DebugLine = { at: Date.now(), level, scope, msg: full };
  ring.push(line);
  if (ring.length > RING_CAP) ring.shift();
  listeners.forEach((l) => l(ring.slice()));

  if (VERBOSE || level === 'warn' || level === 'error') {
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(`[${scope}] ${full}`);
  }

  // Mirror to Rust file log (fire-and-forget; ignore if not in Tauri).
  invoke('diag_log', {
    level,
    scope,
    msg: `${new Date(line.at).toISOString()} ${full}`,
  }).catch(() => {});
}

export const debug = (scope: string, msg: string, extra?: unknown) =>
  log('debug', scope, msg, extra);
export const info = (scope: string, msg: string, extra?: unknown) => log('info', scope, msg, extra);
export const warn = (scope: string, msg: string, extra?: unknown) => log('warn', scope, msg, extra);
export const error = (scope: string, msg: string, extra?: unknown) =>
  log('error', scope, msg, extra);

export function getRecent(): DebugLine[] {
  return ring.slice();
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  fn(ring.slice());
  return () => listeners.delete(fn);
}

export interface RustDiagnostics {
  app_version: string;
  tauri_version: string;
  os: string;
  arch: string;
  log_path: string | null;
  recent: { at: string; level: string; scope: string; msg: string }[];
}

/** Build a copy-pasteable diagnostics blob (bundles Rust snapshot + JS ring). */
export async function buildDiagnostics(context: Record<string, unknown>): Promise<string> {
  let rust: RustDiagnostics | null = null;
  try {
    rust = await invoke<RustDiagnostics>('diag_snapshot');
  } catch {
    /* not in tauri */
  }
  const header = [
    '── METU Companion diagnostics ──',
    `time: ${new Date().toISOString()}`,
    rust ? `app: v${rust.app_version} · tauri ${rust.tauri_version}` : 'app: (web)',
    rust ? `os: ${rust.os}/${rust.arch}` : '',
    rust?.log_path ? `log: ${rust.log_path}` : '',
    '',
    '── context ──',
    JSON.stringify(context, null, 2),
    '',
    '── recent logs ──',
  ].filter(Boolean);
  const lines = getRecent()
    .slice(-120)
    .map((l) => `${new Date(l.at).toISOString()} [${l.level}] ${l.scope}: ${l.msg}`);
  return [...header, ...lines].join('\n');
}

function safe(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Desktop actions (Jarvis v5) — the "hands" lanes the user asked for:
 *
 *   clipboard  — read/transform/copy ("copy that", "fix grammar in my clipboard")
 *   open       — allowlisted opens (apps via shell, folders, https URLs)
 *   write file — save text with EXPLICIT confirm (caller shows the bubble)
 *
 * Window management rides the existing act/UIA lane (minimize buttons are
 * real UIA elements); no new native surface needed.
 *
 * Safety model mirrors the terminal lane: tight allowlists run instantly,
 * everything else either confirms or refuses. No shell interpolation —
 * apps launch by absolute/registered name with zero args.
 */
import { invoke } from '@tauri-apps/api/core';
import { writeText, readText } from '@tauri-apps/plugin-clipboard-manager';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { isTauri } from '../state/runtime';

// ── Clipboard ──────────────────────────────────────────────────────────────

export async function readClipboard(): Promise<string> {
  try {
    return (await readText()) ?? '';
  } catch {
    return '';
  }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (isTauri()) await writeText(text);
    else await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Detect "…my clipboard" intents; returns the transform instruction. */
export function parseClipboardIntent(text: string): string | null {
  const m =
    /^(?:(.*?)\s+)?(?:my\s+|the\s+)?clipboard(?:\s+(.*))?$/i.exec(text.trim()) ??
    /^(translate|fix|correct|summarize|summarise|rewrite|improve|shorten)\s+(?:this|that|it)$/i.exec(
      text.trim(),
    );
  if (!m) return null;
  const instruction = [m[1], m[2]].filter(Boolean).join(' ').trim();
  return instruction || 'Clean this up';
}

// ── Open things ────────────────────────────────────────────────────────────

/** Known apps: spoken name → executable (PATH-resolved or absolute). */
const APP_ALIASES: Record<string, string> = {
  'vs code': 'code',
  vscode: 'code',
  code: 'code',
  notepad: 'notepad',
  calculator: 'calc',
  calc: 'calc',
  explorer: 'explorer',
  terminal: 'wt',
  'windows terminal': 'wt',
  spotify: 'spotify',
  chrome: 'chrome',
  edge: 'msedge',
  firefox: 'firefox',
};

/** Known folders: spoken name → resolved path (expanded at call time). */
const FOLDER_ALIASES: Record<string, string> = {
  desktop: '%USERPROFILE%\\Desktop',
  downloads: '%USERPROFILE%\\Downloads',
  documents: '%USERPROFILE%\\Documents',
  pictures: '%USERPROFILE%\\Pictures',
  home: '%USERPROFILE%',
};

export interface OpenIntent {
  kind: 'app' | 'folder' | 'url';
  target: string;
  label: string;
}

/** Parse "open X" → a SAFE open intent, or null when not an open command. */
export function parseOpenIntent(text: string): OpenIntent | null {
  const m = /^(?:open|launch|start|porne[șs]te|deschide)\s+(.+)$/i.exec(text.trim());
  if (!m?.[1]) return null;
  const raw = m[1].trim().toLowerCase().replace(/[.!]$/, '');
  // URL?
  if (/^https?:\/\/\S+$/i.test(raw)) return { kind: 'url', target: raw, label: raw };
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(raw) && raw.includes('.')) {
    return { kind: 'url', target: `https://${raw}`, label: raw };
  }
  if (FOLDER_ALIASES[raw]) return { kind: 'folder', target: FOLDER_ALIASES[raw], label: raw };
  if (APP_ALIASES[raw]) return { kind: 'app', target: APP_ALIASES[raw], label: raw };
  return null; // unknown target — let chat handle it (may escalate)
}

export async function executeOpen(intent: OpenIntent): Promise<void> {
  if (intent.kind === 'url') {
    await shellOpen(intent.target);
    return;
  }
  if (intent.kind === 'folder') {
    // explorer expands %VARS% itself when launched via cmd-style start;
    // resolve via the shell-open of the expanded path.
    const expanded = intent.target.replace(
      /%USERPROFILE%/g,
      // Tauri webview doesn't expose env — derive from the well-known shape.
      (await invoke<string>('sense_home_dir').catch(() => '')) || 'C:\\Users\\Default',
    );
    await shellOpen(expanded);
    return;
  }
  // App: launch via shell open of the bare program name (registered apps
  // resolve through the OS; zero arguments, zero interpolation).
  await shellOpen(intent.target);
}

// ── Write file (confirm-gated by the caller) ──────────────────────────────

export interface WriteIntent {
  /** Filename only (no path separators) — sanitized. */
  filename: string;
  /** Target folder alias. */
  folder: keyof typeof FOLDER_ALIASES;
}

/** Parse "save this as notes.md on my desktop" style commands. */
export function parseWriteIntent(text: string): WriteIntent | null {
  const m =
    /^(?:save|write)\s+(?:this|that|it)\s+(?:as|to)\s+([\w][\w .-]{0,80}\.\w{1,8})(?:\s+(?:on|in|to)\s+(?:my\s+)?(\w+))?$/i.exec(
      text.trim(),
    );
  if (!m?.[1]) return null;
  const filename = m[1].replace(/[\\/:*?"<>|]/g, '_');
  const folderRaw = (m[2] ?? 'desktop').toLowerCase();
  const folder = (
    folderRaw in FOLDER_ALIASES ? folderRaw : 'desktop'
  ) as keyof typeof FOLDER_ALIASES;
  return { filename, folder };
}

export async function executeWrite(intent: WriteIntent, content: string): Promise<string> {
  const home = (await invoke<string>('sense_home_dir').catch(() => '')) || '';
  if (!home) throw new Error('Could not resolve your home directory.');
  const alias = FOLDER_ALIASES[intent.folder] ?? FOLDER_ALIASES.desktop!;
  const dir = alias.replace(/%USERPROFILE%/g, home);
  const path = `${dir}\\${intent.filename}`;
  await writeTextFile(path, content);
  return path;
}

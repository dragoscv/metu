/**
 * Chat attachments (Jarvis v4.6) — read files CLIENT-side into text the
 * agent can reason over. No binary upload: the companion extracts text
 * locally and ships ≤24k chars per file (4 files max per message).
 *
 * Sources:
 *   - <input type=file> / paperclip button (browser File objects)
 *   - HTML5 drag-drop onto the chat panel (DataTransfer files)
 *   - Tauri native drag-drop onto the AVATAR window (paths → fs read)
 */
import { readTextFile, readFile } from '@tauri-apps/plugin-fs';

export interface ChatAttachment {
  name: string;
  content: string;
  truncated?: boolean;
  /** Rough size for the UI chip. */
  bytes: number;
}

const MAX_CHARS = 24_000;
const MAX_FILES = 4;

/** Extensions we read as plain text (everything code/markup/config). */
const TEXT_EXT =
  /\.(txt|md|markdown|json|jsonc|yaml|yml|toml|ini|env|csv|tsv|log|xml|html?|css|scss|less|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|php|sql|sh|ps1|bat|cmd|svelte|vue|astro|prisma|graphql|gql|dockerfile|gitignore|editorconfig|lock)$/i;

function looksTextual(name: string): boolean {
  return TEXT_EXT.test(name) || !/\./.test(name); // extensionless → try text
}

function finalize(name: string, raw: string, bytes: number): ChatAttachment {
  // Binary sniff: real text rarely contains NULs.
  if (raw.slice(0, 2_000).includes('\0')) {
    return {
      name,
      content: `(binary file — ${bytes} bytes — content not readable as text)`,
      bytes,
    };
  }
  const truncated = raw.length > MAX_CHARS;
  return { name, content: truncated ? raw.slice(0, MAX_CHARS) : raw, truncated, bytes };
}

/** Browser File → attachment (file input + HTML5 drop). */
export async function fromFile(file: File): Promise<ChatAttachment> {
  if (!looksTextual(file.name) && file.size > 0) {
    // Try anyway for unknown extensions under 1MB; text() on real
    // binaries yields replacement chars caught by the NUL sniff.
    if (file.size > 1_000_000) {
      return {
        name: file.name,
        content: `(file too large/binary — ${file.size} bytes — not attached as text)`,
        bytes: file.size,
      };
    }
  }
  const raw = await file.text().catch(() => '');
  return finalize(file.name, raw, file.size);
}

/** Tauri native drop path → attachment (drop on the avatar window). */
export async function fromPath(path: string): Promise<ChatAttachment> {
  const name = path.split(/[\\/]/).pop() ?? path;
  try {
    if (looksTextual(name)) {
      const raw = await readTextFile(path);
      return finalize(name, raw, raw.length);
    }
    // Unknown extension: read bytes, size-gate, decode best-effort.
    const bytes = await readFile(path);
    if (bytes.byteLength > 1_000_000) {
      return {
        name,
        content: `(file too large/binary — ${bytes.byteLength} bytes — not attached as text)`,
        bytes: bytes.byteLength,
      };
    }
    const raw = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    return finalize(name, raw, bytes.byteLength);
  } catch (err) {
    return {
      name,
      content: `(could not read file: ${err instanceof Error ? err.message : 'unknown error'})`,
      bytes: 0,
    };
  }
}

/** Cap + merge helper. */
export function addAttachments(
  current: ChatAttachment[],
  incoming: ChatAttachment[],
): ChatAttachment[] {
  const merged = [...current];
  for (const a of incoming) {
    if (merged.length >= MAX_FILES) break;
    if (!merged.some((m) => m.name === a.name && m.bytes === a.bytes)) merged.push(a);
  }
  return merged;
}

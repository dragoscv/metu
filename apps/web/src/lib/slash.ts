/**
 * Pure helper for parsing slash commands typed in the command bar.
 * Extracted so the regex can be unit-tested without dragging in React.
 *
 * Examples:
 *   "/recall foo bar"  → { cmd: "/recall", arg: "foo bar" }
 *   "/go dashboard"    → { cmd: "/go",     arg: "dashboard" }
 *   "/CAPTURE"         → { cmd: "/capture", arg: "" }   (lower-cased)
 *   "hello world"      → null
 */
export interface ParsedSlash {
  cmd: string;
  arg: string;
}

const SLASH_RE = /^\/(\w+)\s*(.*)$/;

export function parseSlash(input: string): ParsedSlash | null {
  const trimmed = input.trim();
  const m = trimmed.match(SLASH_RE);
  if (!m) return null;
  return { cmd: '/' + m[1]!.toLowerCase(), arg: m[2] ?? '' };
}

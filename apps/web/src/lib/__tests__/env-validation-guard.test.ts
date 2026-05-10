/**
 * Architectural regression guard for environment-variable handling.
 *
 * Catches the bug class:
 *   const SECRET = process.env.MY_SECRET || 'dev-fallback';
 *
 * A fallback secret is the worst kind of secret: it ships to production,
 * everyone knows it, and code that "works" with the fallback masks the
 * real misconfiguration until the day it doesn't.
 *
 * This guard scans every TS file under apps/* and packages/* (excluding
 * tests + node_modules + .next + dist) and fails if it finds:
 *
 *   process.env.<NAME> || '<literal>'           (any literal fallback)
 *   process.env.<NAME> ?? '<literal>'           (same)
 *
 * where <NAME> matches a known-secret pattern (SECRET, TOKEN, KEY, etc).
 *
 * Numeric / boolean / port / url defaults for non-secret config (PORT,
 * NODE_ENV, etc) are fine — the regex requires an UPPERCASE name
 * containing one of the secret tokens.
 */
import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Dirent } from 'node:fs';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const SCAN_ROOTS = [path.join(REPO_ROOT, 'apps'), path.join(REPO_ROOT, 'packages')];
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'build',
  'src-tauri',
  '__tests__',
  'drizzle', // generated SQL migrations
  'public',
]);

const SECRET_NAME_PATTERN = /(SECRET|TOKEN|KEY|PASSWORD|PASSPHRASE|CREDENTIAL|API_KEY)/;

/**
 * Specific call sites where a literal fallback is intentional. Each
 * entry is `<repo-relative-path>:<line>` plus a comment.
 */
const EXEMPT_SITES = new Set<string>([
  // (none today)
]);

async function walkTs(dir: string, out: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walkTs(full, out);
    } else if (
      e.isFile() &&
      (full.endsWith('.ts') || full.endsWith('.tsx')) &&
      !full.endsWith('.test.ts') &&
      !full.endsWith('.spec.ts')
    ) {
      out.push(full);
    }
  }
}

describe('env-validation guard', () => {
  it('no secret-named env var has a literal string fallback', async () => {
    const files: string[] = [];
    for (const root of SCAN_ROOTS) {
      await walkTs(root, files);
    }
    const offenders: string[] = [];
    // Match: process.env.NAME ?? 'literal'   OR   process.env.NAME || 'literal'
    // Where NAME matches the SECRET_NAME_PATTERN.
    const re = /process\.env\.([A-Z_][A-Z0-9_]*)\s*(\?\?|\|\|)\s*(['"`])([^'"`]*)\3/g;
    for (const file of files) {
      const src = await fs.readFile(file, 'utf8');
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const name = m[1]!;
        if (!SECRET_NAME_PATTERN.test(name)) continue;
        const fallback = m[4]!;
        // Empty string fallback is OK — it's typically used for
        // "missing → fail" sentinels (e.g. `if (!TOKEN)` later).
        if (fallback === '') continue;
        const before = src.slice(0, m.index);
        const lineNo = before.split('\n').length;
        const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
        const key = `${rel}:${lineNo}`;
        if (EXEMPT_SITES.has(key)) continue;
        offenders.push(`${key}  → process.env.${name} ${m[2]} '${fallback}'`);
      }
    }
    expect(
      offenders,
      `Secret-named env vars with literal fallbacks (must read from env, never default to a hard-coded value):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

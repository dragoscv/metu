/**
 * Architectural regression guard — every `console.error/warn/info/log`
 * call inside server-side code under `apps/web/src/app/{actions,api}/**`
 * MUST start with a grep-friendly `[scope]` prefix so production log
 * tailing can filter by area. Examples:
 *   console.warn('[capture] inngest dispatch failed', err);
 *   console.error('[oauth] token rotated', { clientId });
 *
 * Allowed: literal `[name]`, `[name.subname]`, `[name space]`, or a
 * template-literal that begins with `` `[ ``.
 */
import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Dirent } from 'node:fs';

const ROOTS = [
  path.resolve(__dirname, '../../app/actions'),
  path.resolve(__dirname, '../../app/api'),
];

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (
      e.isFile() &&
      (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) &&
      !e.name.includes('.test.') &&
      !p.includes('__tests__')
    ) {
      out.push(p);
    }
  }
  return out;
}

describe('server-side console logging hygiene', () => {
  it('every console.* call has a [scope] prefix', async () => {
    const files = (await Promise.all(ROOTS.map(walk))).flat();
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    const callRe = /console\.(error|warn|info|log)\(([^)]{0,120})/g;
    // First-arg shape we accept:
    //   '[scope]…'   "[scope]…"   `[scope]…`   `[${dynamic}]…`
    const okRe = /^\s*['"`]\s*\[/;
    for (const file of files) {
      const src = await fs.readFile(file, 'utf8');
      let match: RegExpExecArray | null;
      while ((match = callRe.exec(src))) {
        const arg = match[2] ?? '';
        if (!okRe.test(arg)) {
          const before = src.slice(0, match.index);
          const lineNo = before.split('\n').length;
          const rel = path.relative(path.resolve(__dirname, '../..'), file).replace(/\\/g, '/');
          offenders.push(`${rel}:${lineNo}  console.${match[1]}(${arg.slice(0, 60)}…`);
        }
      }
    }
    expect(offenders, `console.* calls without [scope] prefix:\n${offenders.join('\n')}`).toEqual(
      [],
    );
  });
});

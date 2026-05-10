/**
 * Architectural regression guard — every POST/PUT/PATCH/DELETE route under
 * `apps/web/src/app/api/sdk/v1/` MUST call `rateLimit(<bucket>, …)` (any
 * bucket — `'sdk-write'` is the default, voice routes use
 * `'voice-realtime'`) to prevent token-flood / write-amplification by a
 * misbehaving connected device. If you intentionally add a new write
 * endpoint that does NOT need this (idempotent reads, bearer-free public
 * health checks), add the file path to `EXEMPT` below with a comment
 * explaining why.
 */
import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const SDK_ROOT = path.resolve(__dirname, '../../app/api/sdk/v1');

/** Files that legitimately don't need sdk-write rate limiting. */
const EXEMPT = new Set<string>([
  // (none right now — every write endpoint is rate-limited)
]);

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.isFile() && e.name === 'route.ts') out.push(p);
  }
  return out;
}

describe('sdk write endpoints rate-limit guard', () => {
  it('every write route under api/sdk/v1 calls rateLimit(...)', async () => {
    const routes = await walk(SDK_ROOT);
    expect(routes.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of routes) {
      const rel = path.relative(SDK_ROOT, file).replace(/\\/g, '/');
      if (EXEMPT.has(rel)) continue;
      const src = await fs.readFile(file, 'utf8');
      const isWrite = /export async function (POST|PUT|PATCH|DELETE)\b/.test(src);
      if (!isWrite) continue;
      if (!/rateLimit\(['"]/.test(src)) {
        offenders.push(rel);
      }
    }
    expect(offenders, `Missing rateLimit(...) in:\n${offenders.join('\n')}`).toEqual([]);
  });
});

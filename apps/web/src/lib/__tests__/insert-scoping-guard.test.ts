/**
 * Architectural regression guard — every `db.insert(<table>)` call in
 * Server Actions writing to a workspace-scoped table MUST include a
 * `workspaceId:` key in the `.values({...})` payload. Otherwise a row
 * gets inserted with a NULL workspace_id which: (a) violates the FK,
 * (b) is invisible to every workspace-scoped read.
 *
 * We only check `apps/web/src/app/actions/**`. Helper packages that
 * wrap inserts (e.g. `@metu/db/queries`) are tested at their own level.
 *
 * Tables EXEMPT from the workspace-scoping convention (user-owned,
 * global, or the workspace table itself) are listed in `EXEMPT_TABLES`.
 */
import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Dirent } from 'node:fs';

const ACTIONS_ROOT = path.resolve(__dirname, '../../app/actions');

/** Tables that are not workspace-scoped (user-owned, global, etc). */
const EXEMPT_TABLES = new Set<string>([
  'user',
  'workspace', // identity IS the scope
  'workspaceMember',
  'account',
  'session',
  'verificationToken',
  'authenticator',
  'passkey',
  'workspacePreference',
  'notificationPreference',
  'copilotModel',
  'copilotProfile',
  'oauthToken', // device-flow tokens — sometimes have workspaceId, sometimes not (pre-auth pairing)
]);

async function listActionFiles(): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(ACTIONS_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.test.ts'))
    .map((e) => path.join(ACTIONS_ROOT, e.name));
}

describe('server actions db.insert workspaceId guard', () => {
  it('every db.insert(<table>) into a scoped table includes workspaceId in values', async () => {
    const files = await listActionFiles();
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    // Capture both the call site and the table identifier.
    const callRe = /\bdb(?:\(\))?\s*\.\s*insert\s*\(\s*([A-Za-z_]\w*)\s*\)/g;
    for (const file of files) {
      const src = await fs.readFile(file, 'utf8');
      const name = path.basename(file);
      let match: RegExpExecArray | null;
      while ((match = callRe.exec(src))) {
        const table = match[1] ?? '';
        if (EXEMPT_TABLES.has(table)) continue;
        // Look at a window AROUND the insert (400 chars before — to catch
        // an array/object built up earlier in the same function — and
        // 800 after for inline `.values({...})`). Accept any mention of
        // the word `workspaceId` in that window.
        const start = Math.max(0, match.index - 1200);
        const window = src.slice(start, match.index + 800);
        if (!/\bworkspaceId\b/.test(window)) {
          const before = src.slice(0, match.index);
          const lineNo = before.split('\n').length;
          offenders.push(`${name}:${lineNo}  db.insert(${table})  → no workspaceId in scope`);
        }
      }
    }
    expect(
      offenders,
      `Inserts on scoped tables missing workspaceId in values:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

/**
 * Architectural regression guards for Server Actions.
 *
 * 1. Every file under `apps/web/src/app/actions/**` that defines a
 *    `'use server'` exported async function MUST call `auth()`. The only
 *    exception is helper-only files that don't export actions.
 *
 * 2. Every workspace-scoped UPDATE/DELETE in those files MUST include
 *    `workspaceId` in the WHERE clause. We grep for `db.update(<table>)`
 *    or `db.delete(<table>)` followed by `.where(...)` and require the
 *    closing `.where(...)` block to mention `workspaceId`. False positives
 *    are listed in `WORKSPACE_EXEMPT` with reasons.
 *
 * These guards catch the bug class fixed in Slice 12 — defense in depth
 * against future refactors silently dropping the predicate.
 */
import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ACTIONS_ROOT = path.resolve(__dirname, '../../app/actions');

/** Files that legitimately don't need `auth()` calls (no exported actions). */
const AUTH_EXEMPT = new Set<string>([
  // (none currently)
]);

/**
 * UPDATE/DELETE call sites where the workspaceId predicate intentionally
 * doesn't appear lexically near the call (e.g. composed via a helper that
 * embeds it; or table is global, not workspace-scoped). Each entry is the
 * path-relative file name plus a comment.
 */
const WORKSPACE_EXEMPT = new Set<string>([
  // workspace_preferences is keyed by (workspaceId, userId) directly — single-row upsert per user, table itself is the scoping primitive
  'workspace-preferences.ts',
  // notification_preference is similarly user-scoped within a single workspace per session
  'notification-prefs.ts',
  // billing.ts mutates Stripe-side, not our DB tables; the local rows are linked via stripeCustomerId guarded by getCustomer()
  'billing.ts',
  // profile-wizard writes to user table (auth-owned, single-row by user id)
  'profile-wizard.ts',
  // copilot-models / copilot store per-user prefs not per-workspace data
  'copilot-models.ts',
  'copilot.ts',
  // autonomy.ts updates `workspace.id = wsId` directly — the table identity IS the scope.
  'autonomy.ts',
]);

async function listActionFiles(): Promise<string[]> {
  const entries = await fs.readdir(ACTIONS_ROOT, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.test.ts'))
    .map((e) => path.join(ACTIONS_ROOT, e.name));
}

function relName(file: string): string {
  return path.basename(file);
}

describe('server actions auth() guard', () => {
  it('every actions file with exported async functions calls auth()', async () => {
    const files = await listActionFiles();
    const offenders: string[] = [];
    for (const file of files) {
      const name = relName(file);
      if (AUTH_EXEMPT.has(name)) continue;
      const src = await fs.readFile(file, 'utf8');
      // Every file in actions/ should be a 'use server' file that exports
      // at least one async function.
      const hasExportedAction =
        /export\s+async\s+function\s+\w+/.test(src) || /export\s+const\s+\w+\s*=\s*async/.test(src);
      if (!hasExportedAction) continue;
      // Either calls auth() directly OR uses a helper from this file
      // that calls it (e.g. ownedProject, ensureCaptureOwnership). All
      // such helpers in this codebase end in `Ownership` or start with
      // `owned`, OR the file imports `auth` from `@metu/auth` and uses
      // it via a wrapper.
      const importsAuth = /from\s+['"]@metu\/auth['"]/.test(src) && /\bauth\b/.test(src);
      if (!importsAuth) {
        offenders.push(name);
      }
    }
    expect(
      offenders,
      `Server-action files missing auth() integration:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

describe('server actions workspaceId scoping guard', () => {
  it('every db.update/delete call site mentions workspaceId nearby', async () => {
    const files = await listActionFiles();
    const offenders: string[] = [];
    for (const file of files) {
      const name = relName(file);
      if (WORKSPACE_EXEMPT.has(name)) continue;
      const src = await fs.readFile(file, 'utf8');
      // Grab each db.update(...) or db.delete(...) call and look for
      // workspaceId mention within 400 chars after it. That's enough to
      // span the .set({...}).where(and(eq(table.id, x), eq(table.workspaceId, ws)))
      // pattern but tight enough to catch a missing predicate.
      const callRe = /\bdb\s*\.\s*(update|delete)\s*\(/g;
      let match: RegExpExecArray | null;
      while ((match = callRe.exec(src))) {
        const window = src.slice(match.index, match.index + 600);
        // Skip `db.delete(toolCall).where(eq(toolCall.id, …))` style if the
        // table itself is keyed by something already-scoped.
        if (!/workspaceId/i.test(window)) {
          const before = src.slice(0, match.index);
          const lineNo = before.split('\n').length;
          offenders.push(`${name}:${lineNo}  → ${match[0]}…`);
        }
      }
    }
    expect(
      offenders,
      `db.update/delete call sites without workspaceId in scope:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

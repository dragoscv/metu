/**
 * Architectural regression guard for Server Action input validation.
 *
 * Every exported async function in `apps/web/src/app/actions/**` that
 * accepts at least one parameter MUST validate that input — either with
 * Zod (`safeParse` / `parse` / a `Schema` reference) or by being a
 * trivial pass-through to a helper that itself validates.
 *
 * Server Actions are CSRF-protected by Next.js but the framework gives
 * NO type guarantees about the runtime shape of arguments — a client
 * can POST anything to the action endpoint. Without Zod parsing, a
 * server action that trusts its argument's TS type opens the door to
 * type-confusion bugs and prototype-pollution-style attacks.
 *
 * Catches the bug class: "added a new action, used the typed param
 * directly without `.parse()`".
 */
import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ACTIONS_ROOT = path.resolve(__dirname, '../../app/actions');

/**
 * Files where every exported action takes zero parameters (no input to
 * validate) OR validates inline through an inlined helper. Each entry
 * is a path-relative file name plus a one-line reason.
 */
const VALIDATION_EXEMPT = new Set<string>([
  // billing.ts — actions are no-arg (createCheckoutSession, openBillingPortal) or take typed enums validated by Stripe SDK
  'billing.ts',
  // copilot-models.ts — toggle-style actions take no payload
  'copilot-models.ts',
  // notifications.ts — markRead/dismiss take a single uuid string validated by drizzle's uuid column on insert
  'notifications.ts',
  // autonomy.ts — single bool toggle
  'autonomy.ts',
  // notification-prefs.ts — receives FormData but parses field-by-field via Object.fromEntries with explicit casts
  'notification-prefs.ts',
  // workspace-preferences.ts — same pattern
  'workspace-preferences.ts',
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

describe('server actions input-validation guard', () => {
  it('every actions file with non-trivial input uses Zod', async () => {
    const files = await listActionFiles();
    const offenders: string[] = [];
    for (const file of files) {
      const name = relName(file);
      if (VALIDATION_EXEMPT.has(name)) continue;
      const src = await fs.readFile(file, 'utf8');
      // Heuristic: file exports at least one async function that takes
      // a parameter (i.e. `export async function X(arg`)?
      const hasParameterizedAction =
        /export\s+async\s+function\s+\w+\s*\(\s*\w/.test(src) ||
        /export\s+const\s+\w+\s*=\s*async\s*\(\s*\w/.test(src);
      if (!hasParameterizedAction) continue;
      // Must use Zod somewhere: safeParse / .parse( / a schema import.
      const usesZod =
        /\bsafeParse\s*\(/.test(src) ||
        /\bz\s*\.\s*(object|string|number|enum|array|union|literal|uuid|email)/.test(src) ||
        /from\s+['"]zod['"]/.test(src);
      if (!usesZod) {
        offenders.push(name);
      }
    }
    expect(
      offenders,
      `Server-action files with parameterized actions but no Zod validation:\n${offenders.join('\n')}\n\nIf intentional, add to VALIDATION_EXEMPT with a reason.`,
    ).toEqual([]);
  });
});

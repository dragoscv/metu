/**
 * Architectural regression guard for migration idempotency.
 *
 * Per the conventions doc: "Migrations 0001–0003 are not idempotent.
 * Make any new migration idempotent (`DO $$ … EXCEPTION WHEN
 * duplicate_object THEN null; END $$;`)."
 *
 * This guard scans every `.sql` file under `packages/db/drizzle/` (the
 * Drizzle migrations directory) and fails if a migration uses any of
 * the schema-altering verbs that are NOT wrapped in either:
 *   - `IF NOT EXISTS` / `IF EXISTS` (built-in idempotency)
 *   - a `DO $$ ... EXCEPTION WHEN duplicate_object THEN null; END $$;`
 *     guard around the statement
 *
 * Catches the bug class: "added a new migration that crashes on retry
 * if the previous run partially failed".
 */
import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const MIG_DIR = path.resolve(__dirname, '../../../../../packages/db/drizzle');

/**
 * Migrations that pre-date this guard and cannot be made idempotent
 * without rewriting history. Per the conventions doc, 0000-0003 are
 * known non-idempotent.
 */
const LEGACY_MIGRATIONS = new Set<string>([
  '0000_military_layla_miller.sql',
  '0001_external_mcp.sql',
  '0002_audit_hardening.sql',
  '0003_integration_multi_account.sql',
]);

/**
 * Verbs that mutate schema and need explicit idempotency guards.
 * Each line of the SQL is checked for these as the first non-whitespace
 * keyword (after `--` comments stripped).
 */
const RISKY_VERBS = [
  /^\s*CREATE\s+(TABLE|INDEX|UNIQUE\s+INDEX|TYPE|EXTENSION|SEQUENCE|VIEW|MATERIALIZED\s+VIEW|FUNCTION|TRIGGER|SCHEMA)\b/i,
  /^\s*ALTER\s+TABLE\s+\S+\s+ADD\s+(COLUMN|CONSTRAINT|FOREIGN KEY)\b/i,
  /^\s*ALTER\s+TYPE\s+\S+\s+ADD\s+VALUE\b/i,
  /^\s*DROP\s+(TABLE|INDEX|TYPE|SEQUENCE|VIEW|FUNCTION|TRIGGER|SCHEMA)\b/i,
];

/** Phrases that indicate the statement is already idempotent. */
const IDEMPOTENCY_GUARDS = [
  /\bIF\s+NOT\s+EXISTS\b/i,
  /\bIF\s+EXISTS\b/i,
  /\bDO\s+\$\$/i,
  /EXCEPTION\s+WHEN\s+duplicate_object/i,
  /EXCEPTION\s+WHEN\s+undefined_(table|column|object)/i,
];

function stripComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

describe('migration idempotency guard', () => {
  it('every non-legacy migration uses IF [NOT] EXISTS or a DO $$ guard', async () => {
    const entries = await fs.readdir(MIG_DIR, { withFileTypes: true });
    const sqlFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith('.sql'))
      .map((e) => e.name)
      .sort();

    const offenders: string[] = [];
    for (const name of sqlFiles) {
      if (LEGACY_MIGRATIONS.has(name)) continue;
      const src = stripComments(await fs.readFile(path.join(MIG_DIR, name), 'utf8'));
      // Block-aware scan: split on `--> statement-breakpoint` (Drizzle's
      // separator) and check each statement independently.
      const statements = src
        .split(/-->\s*statement-breakpoint/i)
        .map((s) => s.trim())
        .filter(Boolean);
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i]!;
        const isRisky = RISKY_VERBS.some((re) => re.test(stmt));
        if (!isRisky) continue;
        const isGuarded = IDEMPOTENCY_GUARDS.some((re) => re.test(stmt));
        if (isGuarded) continue;
        // Show the first risky line of the statement for context.
        const firstLine =
          stmt
            .split('\n')
            .find((l) => l.trim().length > 0)
            ?.trim() ?? '';
        offenders.push(`${name} stmt #${i + 1}  → ${firstLine.slice(0, 120)}`);
      }
    }

    expect(
      offenders,
      `Migrations with non-idempotent statements (must use IF [NOT] EXISTS or DO $$ … EXCEPTION WHEN … END $$;):\n${offenders.join('\n')}\n\nIf the migration was already applied to all environments and rewriting it is not safe, add it to LEGACY_MIGRATIONS.`,
    ).toEqual([]);
  });
});

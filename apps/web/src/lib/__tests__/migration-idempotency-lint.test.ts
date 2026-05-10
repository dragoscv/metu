/**
 * Migration idempotency linter.
 *
 * Every Drizzle SQL file under packages/db/drizzle/*.sql must be safe
 * to re-apply. The journal in `packages/db/drizzle/meta/_journal.json`
 * only tracks 0000 — the rest are pushed via `drizzle-kit push` or
 * by hand, and the convention since 0004 has been to write idempotent
 * SQL using `IF NOT EXISTS` for objects and `DO $$ … EXCEPTION WHEN
 * duplicate_object` for constraints.
 *
 * This guard fails CI if a new migration omits those guards.
 *
 * Files in `EXEMPT` predate the convention and are tolerated by name
 * to avoid rewriting committed history. Do not add to that list — fix
 * the migration to be idempotent instead.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIG_DIR = join(__dirname, '../../../../../packages/db/drizzle');

// Pre-existing migrations that don't fully follow the convention. New
// migrations land outside this list — see the test below.
const EXEMPT = new Set<string>([
  '0000_military_layla_miller.sql',
  '0001_external_mcp.sql',
  '0002_audit_hardening.sql',
  '0003_integration_multi_account.sql',
]);

function listMigrations(): string[] {
  return readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql'));
}

describe('drizzle migration idempotency', () => {
  it('every new migration is safe to re-apply', () => {
    const offenders: Array<{ file: string; reasons: string[] }> = [];
    for (const file of listMigrations()) {
      if (EXEMPT.has(file)) continue;
      const sql = readFileSync(join(MIG_DIR, file), 'utf8');
      const reasons: string[] = [];

      // Bare CREATE TABLE without IF NOT EXISTS.
      if (/\bCREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)\b/i.test(sql)) {
        reasons.push('CREATE TABLE without IF NOT EXISTS');
      }
      // Bare CREATE INDEX without IF NOT EXISTS.
      if (/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)\b/i.test(sql)) {
        reasons.push('CREATE INDEX without IF NOT EXISTS');
      }
      // ADD CONSTRAINT outside a DO $$ EXCEPTION block — running twice
      // throws `duplicate_object`. The guard pattern wraps the ALTER
      // in a DO block that swallows that specific exception.
      const constraints = sql.match(/ALTER\s+TABLE[\s\S]+?ADD\s+CONSTRAINT/gi);
      if (constraints) {
        const guarded = sql.match(/DO\s+\$\$[\s\S]+?duplicate_object[\s\S]+?\$\$/gi);
        if (!guarded || guarded.length < constraints.length) {
          reasons.push(
            `${constraints.length} ADD CONSTRAINT statements but only ${guarded?.length ?? 0} duplicate_object guards`,
          );
        }
      }
      // CREATE TYPE … AS ENUM should also be guarded — running twice
      // throws `duplicate_object`. drizzle-kit emits these without a
      // guard so we tolerate them only inside a DO block.
      const types = sql.match(/CREATE\s+TYPE[\s\S]+?AS\s+ENUM/gi);
      if (types) {
        const typeGuards = sql.match(/DO\s+\$\$[\s\S]+?CREATE\s+TYPE[\s\S]+?\$\$/gi);
        if (!typeGuards || typeGuards.length < types.length) {
          reasons.push(
            `${types.length} CREATE TYPE statements but only ${typeGuards?.length ?? 0} guarded`,
          );
        }
      }

      if (reasons.length) offenders.push({ file, reasons });
    }

    expect(
      offenders,
      offenders.length
        ? `Migration files missing idempotency guards. Wrap with IF NOT EXISTS or DO $$ … EXCEPTION WHEN duplicate_object THEN null; END $$;\n${offenders
            .map((o) => `  • ${o.file}: ${o.reasons.join('; ')}`)
            .join('\n')}`
        : '',
    ).toEqual([]);
  });
});

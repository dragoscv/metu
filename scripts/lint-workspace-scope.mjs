#!/usr/bin/env node
/**
 * lint-workspace-scope — heuristic guard against cross-tenant query leaks.
 *
 * For every TypeScript file outside `__tests__` and `node_modules`, find each
 * `db.select(...).from(<table>)` or `db.update(<table>)`/`db.delete(<table>)`
 * call, then verify that the same statement chain mentions `workspaceId`
 * somewhere before the next `;` or top-level await. We allow-list a handful
 * of tables that legitimately have no `workspace_id` column (auth, billing
 * stripe, OAuth provider tables, system housekeeping).
 *
 * This is a CI net, not a proof — it catches the obvious "I forgot the
 * scope" bugs while keeping false positives low.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const ALLOWED_TABLES = new Set([
  // Auth.js tables — global, scoped by userId.
  'users',
  'accounts',
  'sessions',
  'verificationTokens',
  'authenticators',
  // Workspace itself + global memberships (the row IS the scope).
  'workspace',
  'workspaceMember',
  'workspaceInvite',
  // OAuth provider primitives — scoped by clientId, not workspaceId.
  'oauthToken',
  // Stripe products / prices / global billing (use customerId for scope).
  'stripeCustomer',
  'stripeProduct',
  'stripePrice',
  // Hub DLQ + housekeeping (system tables).
  'hubDlq',
  'housekeeping',
  'rateLimit',
  'auditExport',
  // Provider catalogue (read-only static rows).
  'aiProvider',
  'aiProviderModel',
]);

const TABLE_RX =
  /\b(?:select\s*\([^)]*\)\s*\.from|update|delete)\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/g;

const files = globSync('{apps,packages}/**/src/**/*.ts', {
  cwd: ROOT,
  exclude: (p) =>
    p.includes('node_modules') ||
    p.includes('__tests__') ||
    p.endsWith('.d.ts') ||
    p.endsWith('.test.ts'),
});

let issues = 0;
for (const rel of files) {
  const abs = join(ROOT, rel);
  const src = readFileSync(abs, 'utf8');
  // Skip schema definition files — they DEFINE workspaceId, they don't query.
  if (rel.includes('/db/src/schema/')) continue;
  // Skip files that only use the raw `sql\`...\`` template — too dynamic to lint.
  if (!/\bdb\.(select|update|delete)\b/.test(src)) continue;

  for (const m of src.matchAll(TABLE_RX)) {
    const table = m[1];
    if (ALLOWED_TABLES.has(table)) continue;
    const start = m.index ?? 0;
    // Grab the next ~600 chars or until the next top-level semicolon that
    // is NOT inside a paren — good enough for a heuristic.
    const slice = src.slice(start, start + 800);
    const stmtEnd = slice.search(/;\s*\n/);
    const stmt = stmtEnd === -1 ? slice : slice.slice(0, stmtEnd);
    if (!/workspaceId|workspace_id/.test(stmt)) {
      const line = src.slice(0, start).split('\n').length;
      console.error(
        `[workspace-scope] ${relative(ROOT, abs)}:${line} — ${table} query missing workspaceId filter`,
      );
      issues += 1;
    }
  }
}

if (issues > 0) {
  console.error(`\n${issues} potential cross-tenant leak(s) found.`);
  // Strict mode (CI): fail. Default mode: advisory only — many hits are
  // legitimate cross-tabular joins or non-workspace-scoped tables that the
  // heuristic can't see through. Triage before turning on --strict.
  if (process.argv.includes('--strict')) process.exit(1);
  process.exit(0);
}
console.log(`workspace-scope: ${files.length} files scanned, no leaks detected.`);

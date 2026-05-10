#!/usr/bin/env node
/**
 * Pre-commit guard: runs `actionlint` against any GitHub Actions
 * workflow files staged in this commit. Mirrors the CI workflow at
 * .github/workflows/actionlint.yml so YAML typos fail locally instead
 * of round-tripping through CI.
 *
 * Behavior:
 *   - No workflow files staged → exit 0 (silent).
 *   - actionlint binary missing → print install hint, exit 0
 *     (CI is the safety net; we don't block contributors who haven't
 *     installed it yet).
 *   - actionlint reports issues → forward output, exit 1.
 *
 * Bypass with `git commit --no-verify` if you really need to.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const WORKFLOW_RE = /^\.github\/workflows\/.+\.ya?ml$/i;
const ALL = process.argv.includes('--all');

function stagedWorkflowFiles() {
  const res = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    encoding: 'utf8',
  });
  if (res.status !== 0) return [];
  return res.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && WORKFLOW_RE.test(s) && existsSync(s));
}

function allWorkflowFiles() {
  const dir = path.join('.github', 'workflows');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/i.test(f))
    .map((f) => path.join(dir, f));
}

function hasActionlint() {
  // `actionlint -version` returns 0 when installed.
  const r = spawnSync('actionlint', ['-version'], { stdio: 'ignore' });
  return r.status === 0;
}

const files = ALL ? allWorkflowFiles() : stagedWorkflowFiles();
if (files.length === 0) process.exit(0);

if (!hasActionlint()) {
  console.warn(
    [
      '[actionlint] Not installed locally — skipping workflow lint.',
      '  Install once and you get pre-commit feedback on workflow typos:',
      '    winget install rhysd.actionlint     # Windows',
      '    brew install actionlint             # macOS',
      '    go install github.com/rhysd/actionlint/cmd/actionlint@latest',
      '  CI will still run actionlint on this PR.',
    ].join('\n'),
  );
  process.exit(0);
}

const result = spawnSync('actionlint', files, { stdio: 'inherit' });
process.exit(result.status ?? 1);

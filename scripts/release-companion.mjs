#!/usr/bin/env node
/**
 * Release the companion app:
 *   1. Bumps version in apps/companion/{package.json, src-tauri/Cargo.toml, src-tauri/tauri.conf.json}
 *   2. Generates a CHANGELOG.md entry from conventional commits since the last
 *      `companion-v*` tag (only commits touching apps/companion or
 *      packages/* used by it are included)
 *   3. Stages, commits ("chore(companion): release vX.Y.Z"), tags
 *      `companion-vX.Y.Z`
 *
 * Usage:
 *   node scripts/release-companion.mjs patch   (default)
 *   node scripts/release-companion.mjs minor
 *   node scripts/release-companion.mjs major
 *   node scripts/release-companion.mjs 1.2.3
 *
 * The pre-commit hook will run on the resulting commit, so lint/typecheck
 * must be clean before this script will succeed.
 *
 * Push the tag with: `git push origin main --follow-tags`
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const companionDir = resolve(root, 'apps', 'companion');
const pkgPath = resolve(companionDir, 'package.json');
const cargoPath = resolve(companionDir, 'src-tauri', 'Cargo.toml');
const tauriConfPath = resolve(companionDir, 'src-tauri', 'tauri.conf.json');
const changelogPath = resolve(companionDir, 'CHANGELOG.md');

const arg = process.argv[2] ?? 'patch';

function sh(cmd, opts = {}) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], cwd: root, ...opts })
    .toString()
    .trim();
}

function shInherit(cmd) {
  execSync(cmd, { stdio: 'inherit', cwd: root });
}

// ── Working tree must be clean ────────────────────────────────────────────
const status = sh('git status --porcelain');
if (status) {
  console.error('Working tree is not clean. Commit or stash changes first.');
  console.error(status);
  process.exit(1);
}

// ── Compute next version ──────────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const current = pkg.version;
const next = bumpVersion(current, arg);
const tag = `companion-v${next}`;
console.log(`Bumping ${current} -> ${next} (${tag})`);

// ── Find previous tag ─────────────────────────────────────────────────────
let prevTag = '';
try {
  prevTag = sh('git describe --tags --abbrev=0 --match "companion-v*"');
} catch {
  prevTag = '';
}

// ── Collect commits since last tag, scoped to companion-relevant paths ────
const range = prevTag ? `${prevTag}..HEAD` : 'HEAD';
const scopedPaths = ['apps/companion', 'packages/protocol', 'packages/sdk', 'packages/types'];
const log = sh(
  `git log ${range} --no-merges --pretty=format:%H%x09%s%x09%b%x1e -- ${scopedPaths.join(' ')}`,
);
const commits = log
  .split('\x1e')
  .map((c) => c.trim())
  .filter(Boolean)
  .map((c) => {
    const [hash, subject, body] = c.split('\t');
    return { hash, subject, body: body ?? '' };
  });

const groups = {
  feat: { title: 'Features', items: [] },
  fix: { title: 'Bug Fixes', items: [] },
  perf: { title: 'Performance', items: [] },
  refactor: { title: 'Refactor', items: [] },
  docs: { title: 'Documentation', items: [] },
  build: { title: 'Build', items: [] },
  ci: { title: 'CI', items: [] },
  chore: { title: 'Chore', items: [] },
  other: { title: 'Other', items: [] },
};
const breaking = [];

const re =
  /^(?<type>feat|fix|perf|refactor|docs|build|ci|chore|test|style)(?:\((?<scope>[^)]+)\))?(?<bang>!)?:\s*(?<desc>.+)$/;
for (const c of commits) {
  const m = c.subject.match(re);
  const isBreaking = m?.groups?.bang === '!' || /BREAKING CHANGE:/.test(c.body);
  const type = m?.groups?.type ?? 'other';
  const scope = m?.groups?.scope;
  const desc = m?.groups?.desc ?? c.subject;
  const short = c.hash.slice(0, 7);
  const line = `- ${scope ? `**${scope}**: ` : ''}${desc} (${short})`;
  if (isBreaking) breaking.push(line);
  (groups[type] ?? groups.other).items.push(line);
}

const today = new Date().toISOString().slice(0, 10);
let entry = `## [${next}] - ${today}\n\n`;
if (breaking.length) entry += `### ⚠ BREAKING CHANGES\n${breaking.join('\n')}\n\n`;
for (const g of Object.values(groups)) {
  if (g.items.length) entry += `### ${g.title}\n${g.items.join('\n')}\n\n`;
}
if (!breaking.length && Object.values(groups).every((g) => !g.items.length)) {
  entry += `_No notable changes._\n\n`;
}

// ── Write CHANGELOG ───────────────────────────────────────────────────────
const header = `# Changelog\n\nAll notable changes to METU Companion are documented here.\nFormat: [Keep a Changelog](https://keepachangelog.com), [Conventional Commits](https://www.conventionalcommits.org).\n\n`;
let prevContent = '';
if (existsSync(changelogPath)) {
  prevContent = readFileSync(changelogPath, 'utf8').replace(/^# Changelog[\s\S]*?\n\n/, '');
}
writeFileSync(changelogPath, header + entry + prevContent);

// ── Update package.json ──────────────────────────────────────────────────
pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// ── Update Cargo.toml ────────────────────────────────────────────────────
const cargo = readFileSync(cargoPath, 'utf8');
const cargoNew = cargo.replace(/^version\s*=\s*"[^"]+"/m, `version = "${next}"`);
writeFileSync(cargoPath, cargoNew);

// ── Update tauri.conf.json ───────────────────────────────────────────────
const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf8'));
tauriConf.version = next;
writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');

// ── Commit + tag ─────────────────────────────────────────────────────────
shInherit(`git add "${pkgPath}" "${cargoPath}" "${tauriConfPath}" "${changelogPath}"`);
shInherit(`git commit -m "chore(companion): release v${next}"`);
shInherit(`git tag -a ${tag} -m "METU Companion v${next}"`);

console.log('');
console.log(`Tagged ${tag}.`);
console.log('Push with:  git push origin main --follow-tags');

// ─────────────────────────────────────────────────────────────────────────
function bumpVersion(curr, kind) {
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind;
  const m = curr.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) throw new Error(`Cannot parse version: ${curr}`);
  let [, maj, min, pat] = m.map(Number);
  if (kind === 'major') return `${maj + 1}.0.0`;
  if (kind === 'minor') return `${maj}.${min + 1}.0`;
  if (kind === 'patch') return `${maj}.${min}.${pat + 1}`;
  throw new Error(`Unknown bump kind: ${kind}`);
}

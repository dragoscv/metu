// node --test scripts/lib/commit-lock.test.mjs
// Runs against a throwaway repo in the OS temp dir (git init + a linked
// worktree); never touches this clone's .git.
import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { acquireCommitLock, holderMessage, lockPath, releaseCommitLock } from './commit-lock.mjs';

const LOCK_NAME = 'agent-commit.lock';

let root;
let repo;
let wt;
let common;

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

before(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'commit-lock-test-')));
  repo = join(root, 'repo');
  wt = join(root, 'wt');
  execFileSync('git', ['init', '-q', repo]);
  git(repo, 'config', 'user.email', 't@t');
  git(repo, 'config', 'user.name', 't');
  git(repo, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'a.txt'), 'a');
  git(repo, 'add', 'a.txt');
  git(repo, 'commit', '-q', '--no-verify', '-m', 'init');
  git(repo, 'worktree', 'add', '-q', '--detach', wt);
  common = join(repo, '.git');
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(common, LOCK_NAME), { force: true });
  delete process.env.AGENTQ_HELD;
});

/** A pid that is certainly dead: spawn a process and wait for it to exit. */
async function deadPid() {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  const pid = child.pid;
  await new Promise((r) => child.on('exit', r));
  return pid;
}

describe('commit-lock', () => {
  test('lock path is the COMMON git dir, identical from main clone and linked worktree', () => {
    assert.notEqual(git(wt, 'rev-parse', '--git-dir'), git(repo, 'rev-parse', '--git-dir'));
    assert.equal(lockPath(repo), join(common, LOCK_NAME));
    assert.equal(lockPath(wt), join(common, LOCK_NAME));
  });

  test('acquire writes a record with liveness + attribution fields; release removes it', () => {
    process.env.AGENTQ_SESSION = 'sess-1';
    process.env.AGENTQ_PURPOSE = 'unit test';
    try {
      const r = acquireCommitLock({ cwd: repo, ownerPid: process.pid });
      assert.equal(r.ok, true);
      const rec = JSON.parse(readFileSync(join(common, LOCK_NAME), 'utf8'));
      assert.equal(rec.ownerPid, process.pid);
      assert.equal(rec.hookPid, process.pid);
      assert.equal(rec.session, 'sess-1');
      assert.equal(rec.purpose, 'unit test');
      releaseCommitLock(repo);
      assert.equal(existsSync(join(common, LOCK_NAME)), false);
    } finally {
      delete process.env.AGENTQ_SESSION;
      delete process.env.AGENTQ_PURPOSE;
    }
  });

  test('a live holder in one worktree blocks a commit in another, with an actionable message', () => {
    assert.equal(acquireCommitLock({ cwd: repo, ownerPid: process.pid }).ok, true);
    const r = acquireCommitLock({ cwd: wt, ownerPid: process.pid, quiet: true });
    assert.equal(r.ok, false);
    assert.equal(r.holder.hookPid, process.pid);
    assert.match(r.message, /hookPid=\d+/);
    assert.match(r.message, /session=/);
    assert.match(r.message, /purpose=/);
    assert.match(r.message, /age=\d+s/);
    assert.ok(r.message.includes(join(common, LOCK_NAME)), 'names the exact lock path');
    assert.match(r.message, /ONLY if pid \d+ is dead/);
  });

  test('a lock whose hookPid is dead is reclaimed even though pid (the shell) is alive', async () => {
    const dead = await deadPid();
    writeFileSync(
      join(common, LOCK_NAME),
      JSON.stringify({ pid: process.pid, hookPid: dead, startedAt: new Date().toISOString() }),
    );
    assert.equal(acquireCommitLock({ cwd: wt, ownerPid: null }).ok, true);
  });

  test('a lock whose ownerPid (git) is dead is reclaimed', async () => {
    const dead = await deadPid();
    writeFileSync(
      join(common, LOCK_NAME),
      JSON.stringify({
        ownerPid: dead,
        pid: process.pid,
        hookPid: process.pid,
        startedAt: new Date().toISOString(),
      }),
    );
    assert.equal(acquireCommitLock({ cwd: repo, ownerPid: null }).ok, true);
  });

  test('a legacy lock (pid only) is judged on pid', async () => {
    writeFileSync(
      join(common, LOCK_NAME),
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
    assert.equal(acquireCommitLock({ cwd: repo, ownerPid: null, quiet: true }).ok, false);
    writeFileSync(
      join(common, LOCK_NAME),
      JSON.stringify({ pid: await deadPid(), startedAt: new Date().toISOString() }),
    );
    assert.equal(acquireCommitLock({ cwd: repo, ownerPid: null }).ok, true);
  });

  test('a live holder past the 20-minute TTL is reclaimed', () => {
    const old = new Date(Date.now() - 21 * 60 * 1000).toISOString();
    writeFileSync(
      join(common, LOCK_NAME),
      JSON.stringify({ hookPid: process.pid, pid: process.pid, startedAt: old }),
    );
    assert.equal(acquireCommitLock({ cwd: repo, ownerPid: null }).ok, true);
  });

  test('AGENTQ_HELD=commit:<repo> skips acquire and release entirely', () => {
    process.env.AGENTQ_HELD = `build:x commit:${basename(repo)}`;
    const r = acquireCommitLock({ cwd: wt, ownerPid: process.pid });
    assert.equal(r.ok, true);
    assert.equal(r.skipped, true);
    assert.equal(existsSync(join(common, LOCK_NAME)), false);
    process.env.AGENTQ_HELD = 'commit:some-other-repo';
    assert.equal(acquireCommitLock({ cwd: wt, ownerPid: process.pid }).skipped, undefined);
  });

  test('holderMessage tolerates an unreadable lock', () => {
    assert.match(holderMessage(null, 'X'), /ONLY if pid \? is dead: delete X/);
  });
});

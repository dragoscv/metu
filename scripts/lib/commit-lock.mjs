/**
 * Cross-agent commit mutex.
 *
 * Multiple agents/terminals committing concurrently corrupt each other's
 * staged state (the pre-commit gate runs for minutes while another agent
 * runs `git add`/`git commit`). We serialize commits with a lock file in
 * .git/ — acquired by the pre-commit hook, released by the post-commit hook.
 *
 * Scope: the lock lives in the COMMON git dir (`git rev-parse
 * --git-common-dir`), so commits from every linked worktree of this repo are
 * serialised against each other. `--git-dir` is per worktree
 * (`.git/worktrees/<name>`) and silently gave each worktree its own mutex.
 *
 * Staleness (same logic as brivio's scripts/lib/commit-lock.mjs):
 *   1. `ownerPid` — the nearest `git` ancestor, i.e. the `git commit` process.
 *      It is the only process alive for the WHOLE commit: here the acquire is
 *      a separate short-lived `node` step in .husky/pre-commit, so its own pid
 *      dies at once, and on Windows `process.ppid` is an MSYS stub `sh.exe`
 *      that dies with it (measured 2026-09-27: both dead mid-hook). If git
 *      dies (killed hook, aborted commit, closed terminal) the lock is
 *      reclaimed immediately.
 *   2. `hookPid` — brivio's 2026-09-03 fix: under husky `process.ppid` is the
 *      shell, which can outlive the commit by hours, so a killed hook left a
 *      lock nothing reclaimed until the TTL. Used when no git ancestor was found.
 *   3. `pid` — only for locks written before hookPid was trusted.
 * A hard TTL remains as a final net.
 *
 * agentq: when AGENTQ_HELD contains `commit:<repo>`, agentq already holds a
 * repo-wide commit lock around `git commit`; acquire/release become no-ops.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, openSync, closeSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const TTL_MS = 20 * 60 * 1000; // hard safety net: 20 minutes
const LOCK_NAME = 'agent-commit.lock';

export function commonGitDir(cwd = process.cwd()) {
  const out = execFileSync('git', ['rev-parse', '--git-common-dir'], {
    cwd,
    encoding: 'utf8',
  }).trim();
  return resolve(cwd, out);
}

export function lockPath(cwd = process.cwd()) {
  return join(commonGitDir(cwd), LOCK_NAME);
}

function repoName(cwd) {
  const common = commonGitDir(cwd);
  return basename(common) === '.git'
    ? basename(dirname(common))
    : basename(common).replace(/\.git$/, '');
}

function heldByAgentq(cwd) {
  const held = process.env.AGENTQ_HELD;
  return !!held && held.split(/[\s,;]+/).includes(`commit:${repoName(cwd)}`);
}

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = alive but not ours; ESRCH = dead.
    return err.code === 'EPERM';
  }
}

/** Nearest `git` ancestor of this process (the `git commit` driving the hook), or null. */
export function findGitAncestorPid() {
  try {
    if (process.platform === 'win32') {
      const script =
        `$p=${process.ppid}; for($i=0;$i -lt 12;$i++){ ` +
        `$x=Get-CimInstance Win32_Process -Filter ('ProcessId=' + $p) -ErrorAction SilentlyContinue; ` +
        `if(-not $x){break}; if($x.Name -ieq 'git.exe'){ $x.ProcessId; break }; $p=$x.ParentProcessId }`;
      const out = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        {
          encoding: 'utf8',
          timeout: 15_000,
          windowsHide: true,
        },
      ).trim();
      const pid = Number.parseInt(out, 10);
      return Number.isInteger(pid) && pid > 0 ? pid : null;
    }
    let pid = process.ppid;
    for (let i = 0; i < 12 && pid > 1; i++) {
      const [ppid, ...comm] = execFileSync('ps', ['-o', 'ppid=,comm=', '-p', String(pid)], {
        encoding: 'utf8',
      })
        .trim()
        .split(/\s+/);
      if (basename(comm.join(' ')) === 'git') return pid;
      pid = Number.parseInt(ppid, 10);
    }
  } catch {
    /* fail open: fall back to hookPid/pid liveness */
  }
  return null;
}

export function holderAlive(holder) {
  if (!holder) return false;
  if (holder.ownerPid) return pidAlive(holder.ownerPid);
  // hookPid first: it dies with the hook. Fall back to pid only for locks
  // written before hookPid was trusted.
  return holder.hookPid ? pidAlive(holder.hookPid) : pidAlive(holder.pid);
}

function fmtAge(ms) {
  if (!Number.isFinite(ms)) return '?';
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

/** One actionable message naming the holder and the exact recovery path. */
export function holderMessage(holder, path) {
  const h = holder ?? {};
  const age = h.startedAt ? Date.now() - Date.parse(h.startedAt) : NaN;
  const livePid = h.ownerPid ?? h.hookPid ?? h.pid ?? '?';
  return [
    `  Commit lock held: ownerPid=${h.ownerPid ?? '-'} hookPid=${h.hookPid ?? '?'} pid=${h.pid ?? '?'} ` +
      `user=${h.user ?? '?'} session=${h.session || '-'} purpose=${h.purpose || '-'} age=${fmtAge(age)}`,
    `  cwd=${h.cwd ?? '?'}`,
    '  Wait for that commit to finish and retry (commits are serialised across all worktrees of this repo).',
    `  ONLY if pid ${livePid} is dead: delete ${path}`,
  ].join('\n');
}

function readLock(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Try to acquire the commit lock.
 * @param {{ cwd?: string, ownerPid?: number | null, quiet?: boolean }} [opts]
 * @returns {{ ok: true, path: string, skipped?: true } | { ok: false, path: string, holder: object | null, message: string }}
 */
export function acquireCommitLock(opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const path = lockPath(cwd);
  if (heldByAgentq(cwd)) return { ok: true, path, skipped: true };
  const ownerPid = opts.ownerPid === undefined ? findGitAncestorPid() : opts.ownerPid;
  const payload = JSON.stringify(
    {
      ownerPid, // nearest `git` ancestor — alive for the whole commit
      pid: process.ppid, // legacy field (the shell under husky)
      hookPid: process.pid,
      startedAt: new Date().toISOString(),
      user: process.env.USERNAME || process.env.USER || 'unknown',
      session: process.env.AGENTQ_SESSION ?? process.env.COPILOT_SESSION_ID ?? '',
      purpose: process.env.AGENTQ_PURPOSE ?? '',
      cwd,
    },
    null,
    2,
  );

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, 'wx');
      writeFileSync(fd, payload);
      closeSync(fd);
      return { ok: true, path };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const holder = readLock(path);
      const age = holder?.startedAt ? Date.now() - Date.parse(holder.startedAt) : Infinity;
      const stale = !holder || !holderAlive(holder) || age > TTL_MS;
      if (stale) {
        try {
          unlinkSync(path);
        } catch {
          /* raced with another reclaim — retry loop handles it */
        }
        continue; // retry acquisition
      }
      return blocked(path, holder, opts.quiet);
    }
  }
  return blocked(path, readLock(path), opts.quiet);
}

function blocked(path, holder, quiet) {
  const message = holderMessage(holder, path);
  if (!quiet) console.error(message);
  return { ok: false, path, holder, message };
}

export function releaseCommitLock(cwd = process.cwd()) {
  try {
    if (heldByAgentq(cwd)) return;
    unlinkSync(lockPath(cwd));
  } catch {
    /* already released / never acquired */
  }
}

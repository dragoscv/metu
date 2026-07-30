/**
 * Cross-agent commit mutex.
 *
 * Multiple agents/terminals committing concurrently corrupt each other's
 * staged state (the pre-commit gate runs for minutes while another agent
 * runs `git add`/`git commit`). We serialize commits with a lock file in
 * .git/ — acquired by the pre-commit hook, released by the post-commit hook.
 *
 * Staleness: the lock records the PID of the owning `git` process
 * (the hook's parent). If that PID is no longer alive (aborted commit,
 * killed terminal), the lock is reclaimed automatically. A hard TTL is a
 * final safety net.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';

const TTL_MS = 20 * 60 * 1000; // hard safety net: 20 minutes

export function lockPath() {
  const gitDir = execSync('git rev-parse --git-dir', { encoding: 'utf8' }).trim();
  return join(gitDir, 'agent-commit.lock');
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = alive but not ours; ESRCH = dead.
    return err.code === 'EPERM';
  }
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
 * @returns {{ ok: true } | { ok: false, holder: object | null }}
 */
export function acquireCommitLock() {
  const path = lockPath();
  const payload = JSON.stringify(
    {
      pid: process.ppid, // the `git commit` process driving this hook
      hookPid: process.pid,
      startedAt: new Date().toISOString(),
      user: process.env.USERNAME || process.env.USER || 'unknown',
    },
    null,
    2,
  );

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, 'wx');
      writeFileSync(fd, payload);
      closeSync(fd);
      return { ok: true };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const holder = readLock(path);
      const age = holder?.startedAt ? Date.now() - Date.parse(holder.startedAt) : Infinity;
      const stale = !holder || !pidAlive(holder.pid) || age > TTL_MS;
      if (stale) {
        try {
          unlinkSync(path);
        } catch {
          /* raced with another reclaim — retry loop handles it */
        }
        continue; // retry acquisition
      }
      return { ok: false, holder };
    }
  }
  return { ok: false, holder: readLock(path) };
}

export function releaseCommitLock() {
  try {
    unlinkSync(lockPath());
  } catch {
    /* already released / never acquired */
  }
}

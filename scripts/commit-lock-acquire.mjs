#!/usr/bin/env node
// Cross-agent commit mutex — acquire (called from pre-commit).
import { acquireCommitLock, releaseCommitLock } from './lib/commit-lock.mjs';
const r = acquireCommitLock();
if (!r.ok) {
  const h = r.holder ?? {};
  console.error('');
  console.error('\x1b[31m\x1b[1m✖ Commit blocked: another commit is in progress\x1b[0m');
  console.error('  Another agent/terminal appears to be committing right now.');
  console.error(`  Holder: pid=${h.pid ?? '?'} user=${h.user ?? '?'} since=${h.startedAt ?? '?'}`);
  console.error('  Wait for it to finish, then retry. Concurrent commits corrupt staged state.');
  console.error('  If you are SURE it is stale: delete .git/agent-commit.lock');
  console.error('');
  process.exit(1);
}
process.on('exit', (code) => {
  if (code !== 0) releaseCommitLock();
});

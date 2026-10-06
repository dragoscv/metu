#!/usr/bin/env node
// Cross-agent commit mutex — acquire (called from pre-commit).
import { acquireCommitLock, releaseCommitLock } from './lib/commit-lock.mjs';
const r = acquireCommitLock({ quiet: true });
if (!r.ok) {
  console.error('');
  console.error('\x1b[31m\x1b[1m✖ Commit blocked: another commit is in progress\x1b[0m');
  console.error(r.message);
  console.error('');
  process.exit(1);
}
process.on('exit', (code) => {
  if (code !== 0) releaseCommitLock();
});

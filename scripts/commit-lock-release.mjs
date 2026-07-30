#!/usr/bin/env node
// Cross-agent commit mutex — release (called from post-commit).
import { releaseCommitLock } from './lib/commit-lock.mjs';
releaseCommitLock();

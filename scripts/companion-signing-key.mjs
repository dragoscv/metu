#!/usr/bin/env node
/**
 * Generates a Tauri updater signing key pair and prints next-steps.
 *
 *   pnpm node scripts/companion-signing-key.mjs
 *
 * The private key is written to `~/.metu/companion-signing.key` (0600
 * perms) and printed *once* — copy it into the `TAURI_SIGNING_PRIVATE_KEY`
 * GH Actions secret along with the password as `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
 *
 * The public key is written to `apps/companion/src-tauri/tauri.conf.json`'s
 * `plugins.updater.pubkey` so signed bundles verify against it.
 *
 * NEVER commit the private key. NEVER share it. Losing it means every
 * installed companion app stops receiving updates.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const KEY_DIR = join(homedir(), '.metu');
const PRIVATE_PATH = join(KEY_DIR, 'companion-signing.key');
const CONF_PATH = resolve('apps/companion/src-tauri/tauri.conf.json');

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

if (existsSync(PRIVATE_PATH)) {
  die(
    `Private key already exists at ${PRIVATE_PATH}. Refusing to overwrite. Delete it manually if you really want to rotate.`,
  );
}
if (!existsSync(CONF_PATH)) die(`tauri.conf.json not found at ${CONF_PATH}`);

mkdirSync(KEY_DIR, { recursive: true });

console.log('Generating Tauri updater signing key…');
console.log(
  'You will be prompted for a password — choose a strong one and store it in your password manager.',
);
console.log();

try {
  // Use the @tauri-apps/cli `signer generate` command. Available since v2.
  execSync(`pnpm --filter @metu/companion exec tauri signer generate -w "${PRIVATE_PATH}"`, {
    stdio: 'inherit',
  });
} catch (err) {
  die(`tauri signer generate failed: ${err.message}`);
}

const pub = readFileSync(`${PRIVATE_PATH}.pub`, 'utf8').trim();

const conf = JSON.parse(readFileSync(CONF_PATH, 'utf8'));
conf.plugins ??= {};
conf.plugins.updater ??= {};
conf.plugins.updater.pubkey = pub;
writeFileSync(CONF_PATH, JSON.stringify(conf, null, 2) + '\n');

console.log();
console.log(
  '✓ Public key written to apps/companion/src-tauri/tauri.conf.json (plugins.updater.pubkey).',
);
console.log();
console.log('NEXT STEPS:');
console.log(
  `  1. Copy the contents of ${PRIVATE_PATH} into the GH Actions secret TAURI_SIGNING_PRIVATE_KEY.`,
);
console.log(
  '  2. Store the password you just typed into the secret TAURI_SIGNING_PRIVATE_KEY_PASSWORD.',
);
console.log(
  "  3. Set up releases.metu.app/companion/latest.json to mirror the latest GitHub release's latest.json asset (Cloudflare Worker or GCS bucket).",
);
console.log('  4. Commit + push the tauri.conf.json change.');
console.log(
  '  5. Cut a new companion release; the resulting build will be signed and discoverable by older installs.',
);
console.log();
console.log(
  '!!! NEVER commit the private key. Back it up offline. Losing it bricks all updaters. !!!',
);

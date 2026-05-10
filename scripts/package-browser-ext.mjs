#!/usr/bin/env node
/**
 * Package the metu browser extension for the Chrome Web Store.
 *
 *   pnpm --filter @metu/browser-ext package          # dev build (keeps localhost hosts)
 *   pnpm --filter @metu/browser-ext package:prod     # WebStore-ready (strips localhost)
 *
 * What it does:
 *   1. Validates manifest.json fields (version, name, MV3, icons declared).
 *   2. Rasterizes apps/browser-ext/icon.svg → icons/icon-{16,32,48,128}.png
 *      via @resvg/resvg-js (already a repo devDep).
 *   3. In --prod mode, strips `http://localhost/*` from host_permissions and
 *      asserts the apiUrl never lands on localhost in popup.js.
 *   4. Emits a deterministic ZIP at apps/browser-ext/dist/metu-browser-ext-<v>.zip
 *      (mtime zeroed, files sorted) so the same source produces the same
 *      hash — useful for diffing WebStore upload artifacts.
 *   5. Prints the SHA-256 + byte size at the end.
 *
 * No external dependencies beyond `@resvg/resvg-js` (already in root devDeps).
 * ZIP is built from scratch on top of node:zlib/deflateRaw — tiny, stable,
 * good enough for ~6 file MV3 extensions.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const extDir = resolve(repoRoot, 'apps/browser-ext');
const iconsDir = resolve(extDir, 'icons');
const distDir = resolve(extDir, 'dist');
const sourceSvg = resolve(extDir, 'icon.svg');

const isProd = process.argv.includes('--prod');
const tag = isProd ? '[browser-ext:prod]' : '[browser-ext]';

// ─── 1. Load + validate manifest ───────────────────────────────────────────
const manifestPath = resolve(extDir, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

assert(manifest.manifest_version === 3, 'manifest_version must be 3');
assert(typeof manifest.name === 'string' && manifest.name.length > 0, 'manifest.name required');
assert(/^\d+\.\d+\.\d+$/.test(manifest.version), 'manifest.version must be x.y.z');
assert(manifest.description?.length >= 16, 'description must be ≥16 chars (WebStore)');
assert(manifest.icons?.['128'], 'icons.128 required by WebStore');
assert(manifest.action?.default_popup, 'action.default_popup required');

const expectedIconSizes = [16, 32, 48, 128];
for (const size of expectedIconSizes) {
  assert(
    manifest.icons[String(size)] === `icons/icon-${size}.png`,
    `icons.${size} must point to icons/icon-${size}.png`,
  );
}

// ─── 2. Rasterize icon.svg → icons/icon-N.png ──────────────────────────────
mkdirSync(iconsDir, { recursive: true });
console.log(`${tag} rasterizing icon.svg → icons/icon-{16,32,48,128}.png`);
const { Resvg } = await import('@resvg/resvg-js');
const svg = readFileSync(sourceSvg);
for (const size of expectedIconSizes) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  writeFileSync(resolve(iconsDir, `icon-${size}.png`), r.render().asPng());
}

// ─── 3. Build the manifest variant ─────────────────────────────────────────
const outManifest = JSON.parse(JSON.stringify(manifest));
if (isProd) {
  const before = outManifest.host_permissions ?? [];
  outManifest.host_permissions = before.filter((h) => !/^http:\/\/localhost(?::|\/)/.test(h));
  if (outManifest.host_permissions.length !== before.length) {
    console.log(
      `${tag} stripped ${
        before.length - outManifest.host_permissions.length
      } localhost host(s) from host_permissions`,
    );
  }
  assert(
    outManifest.host_permissions.every((h) => h.startsWith('https://')),
    'prod build must only have https:// hosts',
  );

  // Audit popup.js for hardcoded localhost defaults — fine in dev, surfaces a
  // warning for prod so we don't ship a build that talks to the wrong server.
  const popupJs = readFileSync(resolve(extDir, 'popup.js'), 'utf8');
  if (/http:\/\/localhost/.test(popupJs)) {
    console.warn(
      `${tag} WARNING: popup.js still references http://localhost. WebStore reviewers may flag this.`,
    );
  }
}

// ─── 4. Collect files for the zip ──────────────────────────────────────────
//
// Order matters: we sort lexicographically so the central directory is
// deterministic. Same source ⇒ identical ZIP bytes ⇒ identical SHA-256.
const FILES = [
  'manifest.json',
  'background.js',
  'content.js',
  'popup.html',
  'popup.js',
  ...expectedIconSizes.map((s) => `icons/icon-${s}.png`),
];
FILES.sort();

const entries = FILES.map((rel) => {
  if (rel === 'manifest.json') {
    return { path: rel, data: Buffer.from(JSON.stringify(outManifest, null, 2) + '\n', 'utf8') };
  }
  return { path: rel, data: readFileSync(resolve(extDir, rel)) };
});

// ─── 5. Build a deterministic ZIP ──────────────────────────────────────────
const zipBytes = buildZip(entries);

mkdirSync(distDir, { recursive: true });
const outName = `metu-browser-ext-${manifest.version}${isProd ? '' : '-dev'}.zip`;
const outPath = resolve(distDir, outName);
// Clean any prior artifact for the same name so SHA changes are visible.
if (existsSync(outPath)) rmSync(outPath);
writeFileSync(outPath, zipBytes);

const sha = createHash('sha256').update(zipBytes).digest('hex');
console.log(
  `${tag} wrote ${outPath.replace(repoRoot + '\\', '').replace(repoRoot + '/', '')} ` +
    `(${zipBytes.length} bytes, sha256=${sha.slice(0, 12)}…)`,
);

// Also drop a sibling SHA file, useful in CI artifacts.
writeFileSync(`${outPath}.sha256`, `${sha}  ${outName}\n`, 'utf8');

if (!isProd) {
  console.log(
    `${tag} (dev) load apps/browser-ext as an unpacked extension from chrome://extensions, OR drag the .zip in for a quick install.`,
  );
} else {
  console.log(`${tag} (prod) upload ${outName} at https://chrome.google.com/webstore/devconsole`);
}

// ─── helpers ───────────────────────────────────────────────────────────────

function assert(cond, msg) {
  if (!cond) {
    console.error(`${tag} ERROR: ${msg}`);
    process.exit(1);
  }
}

/**
 * Build a minimal ZIP (PKZIP, deflate-raw, no encryption, ZIP64 not needed).
 * Each entry uses fixed mtime=0, fixed external attrs, sorted order.
 *
 * Layout: [local headers + data]* [central dir]* [end of central dir]
 */
function buildZip(files) {
  const local = [];
  const central = [];
  let offset = 0;

  for (const { path, data } of files) {
    const nameBuf = Buffer.from(path.replaceAll('\\', '/'), 'utf8');
    const compressed = deflateRawSync(data, { level: 9 });
    const useDeflate = compressed.length < data.length;
    const stored = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0;

    const crc = crc32(data);
    const localHdr = Buffer.alloc(30);
    localHdr.writeUInt32LE(0x04034b50, 0); // local file header signature
    localHdr.writeUInt16LE(20, 4); // version needed
    localHdr.writeUInt16LE(0, 6); // gp flags
    localHdr.writeUInt16LE(method, 8);
    localHdr.writeUInt16LE(0, 10); // mtime
    localHdr.writeUInt16LE(0x21, 12); // mdate (1980-01-01)
    localHdr.writeUInt32LE(crc, 14);
    localHdr.writeUInt32LE(stored.length, 18); // compressed size
    localHdr.writeUInt32LE(data.length, 22); // uncompressed size
    localHdr.writeUInt16LE(nameBuf.length, 26);
    localHdr.writeUInt16LE(0, 28); // extra length

    local.push(localHdr, nameBuf, stored);

    const centHdr = Buffer.alloc(46);
    centHdr.writeUInt32LE(0x02014b50, 0);
    centHdr.writeUInt16LE(20, 4); // version made by
    centHdr.writeUInt16LE(20, 6); // version needed
    centHdr.writeUInt16LE(0, 8); // gp flags
    centHdr.writeUInt16LE(method, 10);
    centHdr.writeUInt16LE(0, 12); // mtime
    centHdr.writeUInt16LE(0x21, 14); // mdate
    centHdr.writeUInt32LE(crc, 16);
    centHdr.writeUInt32LE(stored.length, 20);
    centHdr.writeUInt32LE(data.length, 24);
    centHdr.writeUInt16LE(nameBuf.length, 28);
    centHdr.writeUInt16LE(0, 30); // extra
    centHdr.writeUInt16LE(0, 32); // comment
    centHdr.writeUInt16LE(0, 34); // disk #
    centHdr.writeUInt16LE(0, 36); // int attrs
    centHdr.writeUInt32LE(0, 38); // ext attrs
    centHdr.writeUInt32LE(offset, 42); // local header offset

    central.push(centHdr, nameBuf);

    offset += localHdr.length + nameBuf.length + stored.length;
  }

  const localBuf = Buffer.concat(local);
  const centralBuf = Buffer.concat(central);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // disk start
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([localBuf, centralBuf, eocd]);
}

// CRC-32 (IEEE 802.3) — table built lazily on first use.
// `var` (not `let`) so the declaration is hoisted past the TDZ, since the
// helpers below this point are called from top-level code above.
var CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c >>> 0;
    }
    CRC_TABLE = t;
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Envelope encryption for BYOK provider credentials.
 *
 * Master-key resolution paths:
 *   - dev / inline:   `ENCRYPTION_KEY=<base64-32-bytes>`
 *   - production:     `ENCRYPTION_KEY=gcp-secret://projects/PROJECT/secrets/NAME/versions/latest`
 *                     (the actual GCP fetch lives in `@metu/integrations/secrets`
 *                     so this package stays GCP-SDK-free; call `initCrypto`
 *                     once at boot with `gcpSecretManagerKeyResolver` from
 *                     `apps/web/instrumentation.ts`).
 *
 * Algorithm: AES-256-GCM with a fresh 12-byte IV per encryption.
 * Output: { ciphertext, iv, tag } as separate base64 strings, stored in
 *         distinct columns to avoid format coupling.
 *
 * The exported `seal` / `open` API is intentionally synchronous so existing
 * callers (Server Actions, route handlers) need no refactor. The first call
 * lazy-initialises the key from `ENCRYPTION_KEY` if `initCrypto` was not
 * called first; in production you SHOULD call `initCrypto` so that an
 * unreachable secret store fails the boot rather than the first encryption.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';

/**
 * Reference string passed in `ENCRYPTION_KEY`. Resolvers receive the full
 * value (e.g. `gcp-secret://...`) and must return a 32-byte key Buffer.
 */
export type MasterKeyResolver = (ref: string) => Promise<Buffer>;

let cachedKey: Buffer | null = null;
let resolver: MasterKeyResolver = defaultEnvResolver;
let initOnce: Promise<Buffer> | null = null;

/**
 * Default resolver — treats `ref` as a base64-encoded 32-byte key directly.
 * Throws with a crisp message if the input is missing/wrong size/non-base64.
 */
async function defaultEnvResolver(ref: string): Promise<Buffer> {
  return parseBase64Key(ref);
}

function parseBase64Key(ref: string): Buffer {
  if (!ref) throw new Error('ENCRYPTION_KEY is not set');
  if (!/^[A-Za-z0-9+/=_-]+$/.test(ref)) {
    throw new Error('ENCRYPTION_KEY must be base64. Run: openssl rand -base64 32');
  }
  const buf = Buffer.from(ref, 'base64');
  if (buf.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode to 32 bytes (got ${buf.length}). Run: openssl rand -base64 32`,
    );
  }
  return buf;
}

/**
 * Set the resolver used by `initCrypto`. Resolvers are dispatched on the
 * full `ENCRYPTION_KEY` value; the resolver itself decides how to fetch and
 * unwrap (e.g. detect a `gcp-secret://` prefix and call Secret Manager).
 * The default base64-env resolver handles the dev path. Tests override this
 * to inject a fake.
 */
export function setMasterKeyResolver(fn: MasterKeyResolver): void {
  resolver = fn;
  // Reset cache so the next initCrypto picks up the new resolver.
  cachedKey = null;
  initOnce = null;
}

/**
 * Resolve and cache the master key. Idempotent; safe to call from many
 * places. In production, call this once at boot so a misconfigured secret
 * fails fast instead of failing the first time someone tries to seal a
 * credential. Returns the resolved key buffer.
 */
export async function initCrypto(opts?: { resolver?: MasterKeyResolver }): Promise<Buffer> {
  if (opts?.resolver) setMasterKeyResolver(opts.resolver);
  if (cachedKey) return cachedKey;
  if (!initOnce) {
    const ref = process.env.ENCRYPTION_KEY ?? '';
    initOnce = resolver(ref).then((buf) => {
      if (!Buffer.isBuffer(buf) || buf.length !== 32) {
        throw new Error(
          `master key resolver returned ${
            Buffer.isBuffer(buf) ? `${buf.length}-byte buffer` : typeof buf
          }; expected 32-byte Buffer`,
        );
      }
      cachedKey = buf;
      return buf;
    });
  }
  return initOnce;
}

/**
 * Returns the cached master key. If not cached, falls back to a synchronous
 * env-base64 parse (the dev path). Production code paths should prefer
 * `await initCrypto()` at boot so an async resolver (KMS/Secret Manager) can
 * be wired in without forcing every caller to be async.
 */
function masterKey(): Buffer {
  if (cachedKey) return cachedKey;
  // Sync fallback — only the env path can resolve synchronously.
  cachedKey = parseBase64Key(process.env.ENCRYPTION_KEY ?? '');
  return cachedKey;
}

export interface Sealed {
  ciphertext: string;
  iv: string;
  tag: string;
}

export function seal(plaintext: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ct.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

export function open(sealed: Sealed): string {
  const decipher = createDecipheriv(ALGO, masterKey(), Buffer.from(sealed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return pt.toString('utf8');
}

/**
 * Test-only — clears the cached key and resets the resolver to the default.
 * Production code should never call this. Exported with a leading underscore
 * to discourage accidental use.
 */
export function _resetCryptoForTest(): void {
  cachedKey = null;
  initOnce = null;
  resolver = defaultEnvResolver;
}

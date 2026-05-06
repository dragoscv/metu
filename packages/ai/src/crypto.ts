/**
 * Envelope encryption for BYOK provider credentials.
 *
 * Dev mode: ENCRYPTION_KEY env (32-byte base64) is the master key directly.
 * Prod mode: ENCRYPTION_KEY references a wrapped DEK in GCP KMS — see
 *            `unwrapMasterKey()` (TODO when KMS is wired up). For V1 we use
 *            the env key directly; the schema already supports per-cred
 *            `key_ref` so we can rotate to KMS without a migration.
 *
 * Algorithm: AES-256-GCM with random 12-byte IV per encryption.
 * Output: { ciphertext, iv, tag } as separate base64 strings, stored in
 *         distinct columns to avoid format coupling.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';

function masterKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY is not set');
  if (!/^[A-Za-z0-9+/=_-]+$/.test(raw)) {
    throw new Error('ENCRYPTION_KEY must be base64. Run: openssl rand -base64 32');
  }
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode to 32 bytes (got ${buf.length}). Run: openssl rand -base64 32`,
    );
  }
  return buf;
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

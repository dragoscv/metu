/**
 * Master-key resolver backed by GCP Secret Manager.
 *
 * Recognised `ENCRYPTION_KEY` formats:
 *   - `gcp-secret://projects/PROJECT/secrets/NAME/versions/latest`
 *   - `gcp-secret://projects/PROJECT/secrets/NAME/versions/1`
 *
 * The Secret Manager payload MUST be a base64-encoded 32-byte key. We do
 * NOT implement KMS DEK-wrapping yet (Secret Manager already gives us
 * encryption-at-rest + IAM-gated access + versioning; full KMS envelope
 * encryption is a separate slice).
 *
 * Wire this in from `apps/web/instrumentation.ts`:
 *
 *   import { initCrypto } from '@metu/ai/crypto';
 *   import { gcpSecretManagerKeyResolver } from '@metu/integrations/secrets';
 *   await initCrypto({ resolver: gcpSecretManagerKeyResolver });
 *
 * If `ENCRYPTION_KEY` is plain base64 (dev mode), this resolver delegates
 * to the same parse path so a single resolver handles both.
 */
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

let client: SecretManagerServiceClient | null = null;

function getClient(): SecretManagerServiceClient {
  if (!client) client = new SecretManagerServiceClient();
  return client;
}

/**
 * `ENCRYPTION_KEY` resolver. Detects the `gcp-secret://` scheme and fetches
 * the secret from Secret Manager; otherwise treats the value as inline
 * base64 (dev mode) and parses it directly.
 *
 * Throws with crisp messages so a misconfigured boot fails immediately.
 */
export async function gcpSecretManagerKeyResolver(ref: string): Promise<Buffer> {
  if (!ref) throw new Error('ENCRYPTION_KEY is not set');

  const SCHEME = 'gcp-secret://';
  if (!ref.startsWith(SCHEME)) {
    return parseBase64Key(ref);
  }

  const name = ref.slice(SCHEME.length).trim();
  if (!name.startsWith('projects/')) {
    throw new Error(
      `ENCRYPTION_KEY: malformed gcp-secret URI (expected projects/.../secrets/.../versions/...)`,
    );
  }

  const [version] = await getClient().accessSecretVersion({ name });
  const payload = version?.payload?.data;
  if (!payload) {
    throw new Error(`ENCRYPTION_KEY: empty payload from Secret Manager (${name})`);
  }
  // The SM SDK returns Buffer | Uint8Array | string; coerce to a string then
  // parse, so an operator can paste either a base64 string OR raw bytes.
  const text =
    typeof payload === 'string' ? payload : Buffer.from(payload as Uint8Array).toString('utf8');
  return parseBase64Key(text.trim());
}

function parseBase64Key(ref: string): Buffer {
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

/** Test-only — drops the cached SM client so tests can swap mocks. */
export function _resetGcpKeyResolverForTest(): void {
  client = null;
}

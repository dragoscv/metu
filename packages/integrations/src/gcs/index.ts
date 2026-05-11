/** GCS storage adapter — signed upload URLs + read URLs for captures. */
import { Storage } from '@google-cloud/storage';
import { randomBytes } from 'node:crypto';

const storage = new Storage({
  projectId: process.env.GCP_PROJECT_ID,
});
const bucket = () => storage.bucket(process.env.GCS_BUCKET ?? 'metu-prod-uploads');

/**
 * Public-read bucket for assets we serve directly to the browser (avatars,
 * workspace logos). MUST be a separate bucket from the private capture
 * uploads bucket, configured with Uniform Bucket-Level Access + the
 * `roles/storage.objectViewer` IAM binding for `allUsers`. Set the
 * bucket name via `GCS_PUBLIC_BUCKET`. In local dev (MinIO) we fall back
 * to a `metu-public` bucket; configure it as public in MinIO console.
 */
const publicBucket = () => storage.bucket(process.env.GCS_PUBLIC_BUCKET ?? 'metu-public');

function publicBaseUrl(): string {
  // Override for MinIO / custom S3-compatible endpoints in dev.
  if (process.env.GCS_PUBLIC_BASE_URL) return process.env.GCS_PUBLIC_BASE_URL;
  const bucketName = process.env.GCS_PUBLIC_BUCKET ?? 'metu-public';
  return `https://storage.googleapis.com/${bucketName}`;
}

export function newStorageKey(prefix: string, ext: string) {
  const id = randomBytes(12).toString('hex');
  const date = new Date().toISOString().slice(0, 10);
  return `${prefix}/${date}/${id}.${ext.replace(/^\./, '')}`;
}

/** Generates a V4 signed PUT URL for direct browser/mobile uploads. */
export async function getSignedUploadUrl(input: {
  storageKey: string;
  contentType: string;
  expiresInSeconds?: number;
}) {
  const file = bucket().file(input.storageKey);
  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    contentType: input.contentType,
    expires: Date.now() + (input.expiresInSeconds ?? 60 * 5) * 1000,
  });
  return url;
}

export async function getSignedReadUrl(storageKey: string, expiresInSeconds = 60 * 60) {
  const file = bucket().file(storageKey);
  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + expiresInSeconds * 1000,
  });
  return url;
}

export async function downloadToBuffer(storageKey: string): Promise<Buffer> {
  const [buf] = await bucket().file(storageKey).download();
  return buf;
}

/**
 * Delete an object. Idempotent: missing objects (404) resolve quietly so
 * the daily cleanup cron doesn't fail on rows whose blob was already
 * lifecycle-purged by GCS itself.
 */
export async function deleteObject(storageKey: string): Promise<{ deleted: boolean }> {
  try {
    await bucket().file(storageKey).delete({ ignoreNotFound: true });
    return { deleted: true };
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 404) return { deleted: false };
    throw err;
  }
}

/**
 * Upload a buffer to the public-read bucket. Returns the canonical public
 * URL the browser can use directly (no signing). Used for avatars and
 * workspace logos. The caller MUST validate size and content type before
 * calling — this helper trusts its inputs.
 */
export async function uploadPublicObject(input: {
  storageKey: string;
  contentType: string;
  data: Buffer;
  cacheControl?: string;
}): Promise<{ url: string; storageKey: string }> {
  const file = publicBucket().file(input.storageKey);
  await file.save(input.data, {
    metadata: {
      contentType: input.contentType,
      cacheControl: input.cacheControl ?? 'public, max-age=31536000, immutable',
    },
    resumable: false,
  });
  return { url: `${publicBaseUrl()}/${input.storageKey}`, storageKey: input.storageKey };
}

/**
 * Delete from the public-read bucket. Idempotent like `deleteObject`.
 */
export async function deletePublicObject(storageKey: string): Promise<{ deleted: boolean }> {
  try {
    await publicBucket().file(storageKey).delete({ ignoreNotFound: true });
    return { deleted: true };
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 404) return { deleted: false };
    throw err;
  }
}

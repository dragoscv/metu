/** GCS storage adapter — signed upload URLs + read URLs for captures. */
import { Storage } from '@google-cloud/storage';
import { randomBytes } from 'node:crypto';

const storage = new Storage({
  projectId: process.env.GCP_PROJECT_ID,
});
const bucket = () => storage.bucket(process.env.GCS_BUCKET ?? 'metu-prod-uploads');

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

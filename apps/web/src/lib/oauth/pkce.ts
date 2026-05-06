/** PKCE + state helpers for the generic OAuth flow. */
import { createHash, randomBytes } from 'crypto';

export function randomUrlSafe(bytes = 32): string {
  return randomBytes(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function sha256Base64Url(input: string): string {
  return createHash('sha256')
    .update(input)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function newPkce(): PkcePair {
  const verifier = randomUrlSafe(48);
  return { verifier, challenge: sha256Base64Url(verifier) };
}

export function callbackUrl(appId: string): string {
  const base = process.env.AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  return `${base.replace(/\/+$/, '')}/api/oauth/${appId}/callback`;
}

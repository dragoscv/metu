import { createClient } from '@metu/sdk';

export function metuClient(accessToken: string) {
  return createClient({
    baseUrl: process.env.METU_ISSUER ?? 'http://localhost:24890',
    auth: { kind: 'token', accessToken },
  });
}

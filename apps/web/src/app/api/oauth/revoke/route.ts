/**
 * Token revocation (RFC 7009).
 */
import { eq } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { oauthToken } from '@metu/db/schema';
import { compareSecret, hashToken } from '@metu/auth/oauth';
import { findActiveClientByClientId, oauthError } from '@/lib/oauth-provider';
import { clientKey, rateLimit } from '@/lib/ratelimit';

export async function POST(req: Request) {
  const limited = await rateLimit('oauth-revoke', clientKey(req));
  if (limited) return limited;

  const form = await req.formData();
  const tokenRaw = String(form.get('token') ?? '');
  if (!tokenRaw) return oauthError('invalid_request', 'Missing token.');

  const clientId = String(form.get('client_id') ?? '');
  const clientSecret = form.has('client_secret') ? String(form.get('client_secret')) : null;
  const client = await findActiveClientByClientId(clientId);
  if (!client) return oauthError('invalid_client', undefined, 401);
  if (client.type !== 'public') {
    if (!clientSecret || !client.clientSecretHash) {
      return oauthError('invalid_client', 'Secret required.', 401);
    }
    if (!compareSecret(clientSecret, client.clientSecretHash)) {
      return oauthError('invalid_client', undefined, 401);
    }
  }

  const db = getDb();
  await db
    .update(oauthToken)
    .set({ revokedAt: new Date() })
    .where(eq(oauthToken.tokenHash, hashToken(tokenRaw)));

  // Per spec we always return 200 even if the token wasn't found.
  return new Response('', { status: 200 });
}

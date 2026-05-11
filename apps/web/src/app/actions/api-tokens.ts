/**
 * Server actions for personal API tokens (PATs).
 *
 * Issuance mints a per-user `oauth_client` of type first_party named
 * "Personal access tokens", then issues an `access_token` whose raw value
 * is returned exactly once. Plaintext is never stored.
 */
'use server';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { oauthClient, oauthToken } from '@metu/db/schema';
import { issueToken } from '@/lib/oauth-provider';

const tokenIdSchema = z.string().uuid();

const ALLOWED_SCOPES = [
  'capture:write',
  'recall:read',
  'notify:write',
  'tools:invoke',
  'creds:borrow',
  'presence:talk',
] as const;

const issueSchema = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(z.enum(ALLOWED_SCOPES)).min(1).max(ALLOWED_SCOPES.length),
  expiresInDays: z.number().int().min(1).max(365).default(90),
});

export async function revokeApiTokenAction(
  tokenId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: 'unauthenticated' };
  const parsed = tokenIdSchema.safeParse(tokenId);
  if (!parsed.success) return { ok: false, error: 'invalid_id' };
  const db = getDb();
  await db
    .update(oauthToken)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(oauthToken.id, parsed.data),
        eq(oauthToken.userId, session.user.id),
        eq(oauthToken.workspaceId, session.user.workspaceId),
      ),
    );
  revalidatePath('/settings/api-tokens');
  return { ok: true };
}

export async function issueApiTokenAction(input: {
  name: string;
  scopes: string[];
  expiresInDays?: number;
}): Promise<{ ok: true; token: string; expiresAt: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: 'unauthenticated' };
  const parsed = issueSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' };
  }

  const db = getDb();
  const clientIdSlug = `pat-${session.user.id}`;
  const [existing] = await db
    .select({ id: oauthClient.id })
    .from(oauthClient)
    .where(
      and(
        eq(oauthClient.clientId, clientIdSlug),
        eq(oauthClient.workspaceId, session.user.workspaceId),
      ),
    )
    .limit(1);
  let clientUuid = existing?.id;
  if (!clientUuid) {
    const [created] = await db
      .insert(oauthClient)
      .values({
        workspaceId: session.user.workspaceId,
        clientId: clientIdSlug,
        type: 'first_party',
        name: 'Personal access tokens',
        allowedScopes: ALLOWED_SCOPES.join(' '),
      })
      .returning();
    clientUuid = created!.id;
  }

  const issued = await issueToken({
    workspaceId: session.user.workspaceId,
    clientUuid,
    userId: session.user.id,
    kind: 'access_token',
    scopes: parsed.data.scopes,
    ttlSeconds: parsed.data.expiresInDays * 24 * 60 * 60,
    metadata: { label: parsed.data.name, source: 'pat' },
  });
  revalidatePath('/settings/api-tokens');
  return { ok: true, token: issued.token, expiresAt: issued.expiresAt.toISOString() };
}

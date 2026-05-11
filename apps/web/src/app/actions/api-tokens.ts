/**
 * Server actions for personal API tokens.
 *
 * "API tokens" in metu = `oauth_token` rows of kind `access_token` issued
 * to the current user (via the OAuth code or device flows). We don't have
 * a separate PAT table — every bearer is grant-scoped — so this surface
 * is read-only + revoke. Issuance happens via the OAuth flow on
 * /apps/[id]/connect or /companion/connect.
 */
'use server';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { oauthToken } from '@metu/db/schema';

const tokenIdSchema = z.string().uuid();

export async function revokeApiTokenAction(
  tokenId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: 'unauthenticated' };
  const parsed = tokenIdSchema.safeParse(tokenId);
  if (!parsed.success) return { ok: false, error: 'invalid_id' };
  const db = getDb();
  // Tenant + user scoping — refusing to revoke tokens not in this workspace
  // even if the user happened to know the id is the second line of defence
  // after the userId match.
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

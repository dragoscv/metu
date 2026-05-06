/**
 * Token authentication for the WS gateway.
 *
 * Mirrors `apps/web/src/lib/oauth-provider.ts#findActiveTokenByHash` — we keep
 * this duplicated rather than reaching into web internals so the hub can be
 * deployed independently.
 */
import { createHash } from 'node:crypto';
import { getDb } from '@metu/db';
import { oauthToken, workspace } from '@metu/db/schema';
import { and, eq, gt, isNull } from 'drizzle-orm';

export interface AuthenticatedToken {
  workspaceId: string;
  workspaceSlug: string | null;
  userId: string;
  scopes: string[];
  clientId: string | null;
}

const hashToken = (raw: string) => createHash('sha256').update(raw).digest('base64url');

const parseScopes = (s: string | null | undefined): string[] =>
  (s ?? '').split(/\s+/).filter(Boolean);

export async function authenticateHello(accessToken: string): Promise<AuthenticatedToken | null> {
  if (!accessToken.startsWith('metu_at_')) return null;
  const db = getDb();
  const tokenHash = hashToken(accessToken);
  const rows = await db
    .select({
      id: oauthToken.id,
      workspaceId: oauthToken.workspaceId,
      userId: oauthToken.userId,
      scopes: oauthToken.scopes,
      clientId: oauthToken.clientId,
      slug: workspace.slug,
    })
    .from(oauthToken)
    .leftJoin(workspace, eq(workspace.id, oauthToken.workspaceId))
    .where(
      and(
        eq(oauthToken.tokenHash, tokenHash),
        eq(oauthToken.kind, 'access_token'),
        isNull(oauthToken.consumedAt),
        isNull(oauthToken.revokedAt),
        gt(oauthToken.expiresAt, new Date()),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row || !row.userId) return null;
  return {
    workspaceId: row.workspaceId,
    workspaceSlug: row.slug,
    userId: row.userId,
    scopes: parseScopes(row.scopes),
    clientId: row.clientId,
  };
}

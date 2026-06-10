/**
 * Token authentication for the WS gateway.
 *
 * Mirrors `apps/web/src/lib/oauth-provider.ts#findActiveTokenByHash` — we keep
 * this duplicated rather than reaching into web internals so the hub can be
 * deployed independently.
 */
import { createHash } from 'node:crypto';
import { getDb } from '@metu/db';
import { oauthClient, oauthToken, workspace } from '@metu/db/schema';
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
      // oauthToken.clientId is the UUID FK to oauthClient.id; the hub's
      // kind↔client binding compares against the PUBLIC client id string
      // (e.g. 'metu_app_companion'), so resolve it here via the join.
      clientId: oauthClient.clientId,
      slug: workspace.slug,
    })
    .from(oauthToken)
    .leftJoin(workspace, eq(workspace.id, oauthToken.workspaceId))
    .leftJoin(oauthClient, eq(oauthClient.id, oauthToken.clientId))
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

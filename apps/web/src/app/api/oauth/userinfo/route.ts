/**
 * UserInfo endpoint (OIDC Core 1.0 §5.3).
 * Bearer access token with `openid` scope required.
 */
import { eq } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { user, workspace } from '@metu/db/schema';
import { findActiveTokenByHash, oauthError } from '@/lib/oauth-provider';
import { parseScopes } from '@metu/auth/oauth';

export async function GET(req: Request) {
  const authz = req.headers.get('authorization') ?? '';
  if (!authz.startsWith('Bearer ')) {
    return oauthError('invalid_request', 'Bearer token required.', 401);
  }
  const raw = authz.slice(7);
  const tok = await findActiveTokenByHash(raw, 'access_token');
  if (!tok || !tok.userId) {
    return oauthError('invalid_grant', 'Invalid or expired token.', 401);
  }
  const scopes = parseScopes(tok.scopes);
  if (!scopes.includes('openid')) {
    return oauthError('invalid_scope', 'openid scope required.', 403);
  }

  const db = getDb();
  const [u] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(user)
    .where(eq(user.id, tok.userId))
    .limit(1);
  if (!u) return oauthError('invalid_grant', 'User not found.', 401);

  const [ws] = await db
    .select({ id: workspace.id, name: workspace.name, slug: workspace.slug })
    .from(workspace)
    .where(eq(workspace.id, tok.workspaceId))
    .limit(1);

  const claims: Record<string, unknown> = { sub: u.id };
  if (scopes.includes('profile')) {
    claims.name = u.name;
    claims.picture = u.image;
  }
  if (scopes.includes('email')) {
    claims.email = u.email;
    claims.email_verified = !!u.email;
  }
  if (ws) {
    claims['metu_workspace_id'] = ws.id;
    claims['metu_workspace_slug'] = ws.slug;
    claims['metu_workspace_name'] = ws.name;
  }
  return Response.json(claims, { headers: { 'cache-control': 'no-store' } });
}

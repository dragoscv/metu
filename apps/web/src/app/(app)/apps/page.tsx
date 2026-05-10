import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { eq, isNull, and, desc, sql } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { oauthClient, oauthToken } from '@metu/db/schema';
import { AppsManager, type RegisteredApp } from '@/components/apps-manager';

export default async function AppsPage() {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const db = getDb();
  const rows = await db
    .select()
    .from(oauthClient)
    .where(
      and(eq(oauthClient.workspaceId, session.user.workspaceId), isNull(oauthClient.revokedAt)),
    )
    .orderBy(desc(oauthClient.createdAt));

  // Most-recent token activity per oauthClient — drives the presence dot
  // for SDK-only clients (browser-ext, mcp-server, mobile background)
  // that never open a hub WS connection.
  const liveness = await db
    .select({
      clientId: oauthToken.clientId,
      lastUsedAt: sql<Date | null>`max(${oauthToken.lastUsedAt})`,
      activeTokens: sql<number>`count(*) filter (where ${oauthToken.revokedAt} is null and ${oauthToken.kind} = 'access_token' and ${oauthToken.expiresAt} > now())`,
    })
    .from(oauthToken)
    .where(eq(oauthToken.workspaceId, session.user.workspaceId))
    .groupBy(oauthToken.clientId);
  const livenessByClient = new Map(liveness.map((l) => [l.clientId, l]));

  const apps: RegisteredApp[] = rows.map((r) => {
    const live = livenessByClient.get(r.id);
    return {
      id: r.id,
      clientId: r.clientId,
      type: r.type,
      name: r.name,
      allowedScopes: r.allowedScopes,
      redirectUris: (r.redirectUris as string[]) ?? [],
      iconUrl: r.iconUrl,
      webhookUrl: r.webhookUrl,
      lastUsedAt: live?.lastUsedAt ? new Date(live.lastUsedAt).toISOString() : null,
      activeTokens: Number(live?.activeTokens ?? 0),
    };
  });

  return <AppsManager apps={apps} />;
}

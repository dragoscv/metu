import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { eq, isNull, and, desc } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { oauthClient } from '@metu/db/schema';
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

  const apps: RegisteredApp[] = rows.map((r) => ({
    id: r.id,
    clientId: r.clientId,
    type: r.type,
    name: r.name,
    allowedScopes: r.allowedScopes,
    redirectUris: (r.redirectUris as string[]) ?? [],
    iconUrl: r.iconUrl,
    webhookUrl: r.webhookUrl,
  }));

  return <AppsManager apps={apps} />;
}

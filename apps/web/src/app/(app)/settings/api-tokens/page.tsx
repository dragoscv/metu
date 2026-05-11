/**
 * /settings/api-tokens — list active access tokens for the signed-in
 * user with their owning OAuth client + scopes + last-seen, plus a
 * one-click revoke. Issuance happens through the OAuth flow (Apps page
 * or `/companion/connect`); this page is the kill-switch.
 */
import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { oauthClient, oauthToken } from '@metu/db/schema';
import { Card, Page, PageHeader } from '@metu/ui';
import { revokeApiTokenAction } from '@/app/actions/api-tokens';

export const dynamic = 'force-dynamic';

export default async function ApiTokensPage() {
  const session = await auth();
  if (!session) redirect('/sign-in');

  const db = getDb();
  const rows = await db
    .select({
      id: oauthToken.id,
      scopes: oauthToken.scopes,
      createdAt: oauthToken.createdAt,
      expiresAt: oauthToken.expiresAt,
      lastUsedAt: oauthToken.lastUsedAt,
      clientName: oauthClient.name,
      clientId: oauthClient.id,
    })
    .from(oauthToken)
    .leftJoin(oauthClient, eq(oauthClient.id, oauthToken.clientId))
    .where(
      and(
        eq(oauthToken.userId, session.user.id),
        eq(oauthToken.kind, 'access_token'),
        isNull(oauthToken.revokedAt),
        gt(oauthToken.expiresAt, sql`now()`),
      ),
    )
    .orderBy(desc(oauthToken.createdAt));

  return (
    <Page className="mx-auto max-w-3xl">
      <PageHeader
        title="API tokens"
        description="Active bearer tokens for SDK calls. Revoke anything you don't recognise."
      />

      {rows.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-fg-subtle)]">
            No active API tokens. Connect an app from{' '}
            <a className="underline" href="/apps">
              /apps
            </a>{' '}
            or pair the companion via{' '}
            <a className="underline" href="/companion/connect">
              /companion/connect
            </a>{' '}
            to issue one.
          </p>
        </Card>
      ) : (
        <ul className="grid gap-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Card>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {r.clientName ?? 'Unknown client'}
                    </div>
                    <div className="text-[11px] text-[var(--color-fg-subtle)]">
                      {r.scopes || '—'} · expires{' '}
                      {r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : 'never'}
                      {r.lastUsedAt
                        ? ` · last used ${new Date(r.lastUsedAt).toLocaleString()}`
                        : ' · never used'}
                    </div>
                  </div>
                  <form
                    action={async () => {
                      'use server';
                      await revokeApiTokenAction(r.id);
                    }}
                  >
                    <button
                      type="submit"
                      className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-1 text-xs text-[var(--color-danger,#ef4444)] hover:bg-[var(--color-bg-elevated)]"
                    >
                      Revoke
                    </button>
                  </form>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

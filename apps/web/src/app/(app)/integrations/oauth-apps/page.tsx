import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { listOauthApps } from '@metu/db/queries';
import { Page, PageHeader, Card, Badge } from '@metu/ui';
import { KeyRound } from 'lucide-react';
import Link from 'next/link';
import { INTEGRATIONS_CATALOG } from '@/lib/integrations/catalog';
import { OauthAppsKindForm } from '@/components/oauth-apps-kind-form';

export const dynamic = 'force-dynamic';

/**
 * Per-kind OAuth client credentials manager. Pasting a client_id +
 * client_secret here lets the workspace use any built-in integration's
 * OAuth flow without setting env vars or redeploying. Existing rows show
 * with the connected `kind` and a redacted `clientId`.
 */
export default async function OauthAppsPage() {
  const session = await auth();
  if (!session) redirect('/sign-in');

  const apps = await listOauthApps(session.user.workspaceId);
  const kindApps = apps.filter((a) => a.kind);

  return (
    <Page className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <KeyRound className="h-3.5 w-3.5" />
            OAuth credentials
          </span>
        }
        title="Workspace OAuth apps"
        description="BYO OAuth client_id + client_secret per provider. Saved values are sealed and used by the matching /api/integrations/oauth/[kind] flow before any environment-variable fallback."
      />

      <Card className="space-y-3">
        <h2 className="text-sm font-medium">Add or update credentials</h2>
        <OauthAppsKindForm
          kinds={INTEGRATIONS_CATALOG.map((c) => ({ kind: c.kind, name: c.name }))}
        />
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-medium">Configured kinds</h2>
        {kindApps.length === 0 ? (
          <p className="text-sm text-[var(--color-fg-muted)]">
            No per-kind OAuth credentials saved yet. Add one above to enable Sign-in-with for that
            provider.
          </p>
        ) : (
          <ul className="space-y-1">
            {kindApps.map((a) => (
              <li
                key={a.id}
                className="bg-[var(--color-bg-elevated)]/40 flex items-center justify-between rounded-md border border-[var(--color-border)] px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  <Badge variant="neutral">{a.kind}</Badge>
                  <span className="font-mono text-[12px] text-[var(--color-fg-muted)]">
                    {a.clientId.slice(0, 6)}…{a.clientId.slice(-4)}
                  </span>
                </div>
                <Link
                  href={`/api/integrations/oauth/${a.kind}/start`}
                  className="text-[11px] text-[var(--color-brand)] underline"
                >
                  Test connect →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Page>
  );
}

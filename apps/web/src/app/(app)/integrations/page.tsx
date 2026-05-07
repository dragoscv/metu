import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { listIntegrations, listOauthApps, listOauthConnections } from '@metu/db/queries';
import type { IntegrationKind } from '@metu/types';
import { Page, PageHeader } from '@metu/ui';
import { IntegrationsGrid, type ConnectedIntegration } from '@/components/integrations-grid';
import {
  CustomOauthSection,
  type OauthAppView,
  type OauthConnectionView,
} from '@/components/custom-oauth-section';
import { ExternalMcpSection, type ExternalMcpView } from '@/components/external-mcp-section';
import { availabilityFor } from '@/lib/integrations/connect-methods';
import { INTEGRATIONS_CATALOG } from '@/lib/integrations/catalog';
import type { ConnectMethod } from '@/lib/integrations/connect-methods';
import { callbackUrl } from '@/lib/oauth/pkce';

export default async function IntegrationsPage() {
  const session = await auth();
  if (!session) redirect('/sign-in');

  const [rows, oauthApps, oauthConnections] = await Promise.all([
    listIntegrations(session.user.workspaceId),
    listOauthApps(session.user.workspaceId),
    listOauthConnections(session.user.workspaceId),
  ]);
  const connected: ConnectedIntegration[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    externalId: r.externalId,
    label: r.label,
    status: r.status,
    isDefault: r.isDefault,
    lastSyncAt: r.lastSyncAt ? r.lastSyncAt.toISOString() : null,
    lastError: r.lastError,
  }));

  const externalMcp: ExternalMcpView[] = rows
    .filter((r) => r.kind === 'external_mcp')
    .map((r) => {
      const cfg = (r.config ?? {}) as {
        url?: string;
        toolPrefix?: string;
        lastTools?: Array<{ name: string }>;
      };
      return {
        id: r.id,
        label: r.label,
        url: cfg.url ?? '',
        toolPrefix: cfg.toolPrefix ?? '',
        status: r.status,
        lastSyncAt: r.lastSyncAt ? r.lastSyncAt.toISOString() : null,
        lastError: r.lastError,
        toolCount: cfg.lastTools?.length ?? 0,
      };
    });

  const capabilities: Partial<Record<IntegrationKind, ConnectMethod[]>> = {};
  for (const entry of INTEGRATIONS_CATALOG) {
    capabilities[entry.kind] = availabilityFor(entry.kind).available;
  }

  const apps: OauthAppView[] = oauthApps.map((a) => ({
    id: a.id,
    name: a.name,
    slug: a.slug,
    authorizeUrl: a.authorizeUrl,
    tokenUrl: a.tokenUrl,
    userinfoUrl: a.userinfoUrl,
    scopes: a.scopes,
    callbackUrl: callbackUrl(a.id),
    discovered: a.discovered as OauthAppView['discovered'],
  }));
  const connections: OauthConnectionView[] = oauthConnections.map((c) => ({
    id: c.id,
    appId: c.appId,
    externalId: c.externalId,
    label: c.label,
    status: c.status,
    grantedScopes: c.grantedScopes,
    identity: c.identity,
    createdAt: c.createdAt.toISOString(),
  }));

  return (
    <Page className="space-y-10">
      <PageHeader
        title="Integrations"
        description={
          <>
            Connect external services metu reads from (GitHub, Stripe, Telegram, …). You can connect
            multiple accounts per provider — pick a default to use when a workflow needs just one.
            Tokens are sealed with AES-256-GCM and stored per workspace.
            <span className="mt-2 block text-xs text-[var(--color-fg-subtle)]">
              Looking to let another app talk to metu? See{' '}
              <a href="/apps" className="underline hover:text-[var(--color-fg)]">
                API apps
              </a>{' '}
              for OAuth2/OIDC clients.
            </span>
          </>
        }
      />

      <IntegrationsGrid connected={connected} capabilities={capabilities} />

      <ExternalMcpSection items={externalMcp} />

      <CustomOauthSection apps={apps} connections={connections} />
    </Page>
  );
}

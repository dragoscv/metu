import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { listIntegrations, listOauthApps, listOauthConnections } from '@metu/db/queries';
import type { IntegrationKind } from '@metu/types';
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
    <div className="space-y-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Integrations</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
          Connect external systems. Each closes a real loop. Tokens are sealed with AES-256-GCM and
          stored per workspace.
        </p>
      </header>

      <IntegrationsGrid connected={connected} capabilities={capabilities} />

      <ExternalMcpSection items={externalMcp} />

      <CustomOauthSection apps={apps} connections={connections} />
    </div>
  );
}

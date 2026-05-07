import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { agentPolicy, integration, toolAcl, workspace } from '@metu/db/schema';
import { agent } from '@metu/core';
import { Page, PageHeader } from '@metu/ui';
import { AutonomyForm, type AutonomyMode } from '@/components/autonomy-form';

const KIND_DEFAULT: Record<'read' | 'low_risk' | 'high_risk', AutonomyMode> = {
  read: 'autopilot',
  low_risk: 'auto_with_undo',
  high_risk: 'ask',
};

/** Tools whose ACL can be scoped per-integration. Mirrors `extractIntegrationId` in policy.ts.
 * `creds_borrow` is not in the LLM tool registry but is gated by the same ACL via the
 * `/api/sdk/v1/credentials/borrow` route. */
const SCOPED_TOOLS = new Set(['external_invoke', 'creds_borrow']);

const VIRTUAL_TOOLS: Array<{
  name: string;
  description: string;
  kind: 'read' | 'low_risk' | 'high_risk';
}> = [
  {
    name: 'creds_borrow',
    description: 'Mint a short-lived borrowed credential for a connected integration.',
    kind: 'high_risk',
  },
];

export default async function AutonomyPage() {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const db = getDb();
  const wsId = session.user.workspaceId;

  const [policyRow] = await db
    .select()
    .from(agentPolicy)
    .where(eq(agentPolicy.workspaceId, wsId))
    .limit(1);

  const [wsRow] = await db
    .select({ unlimitedAi: workspace.unlimitedAi })
    .from(workspace)
    .where(eq(workspace.id, wsId))
    .limit(1);

  const acls = await db
    .select({
      tool: toolAcl.tool,
      mode: toolAcl.mode,
      integrationId: toolAcl.integrationId,
    })
    .from(toolAcl)
    .where(eq(toolAcl.workspaceId, wsId));

  const wsAclMap = new Map<string, AutonomyMode>();
  const scopedAclMap = new Map<string, AutonomyMode>(); // key = `${tool}::${integrationId}`
  for (const a of acls) {
    if (a.integrationId) scopedAclMap.set(`${a.tool}::${a.integrationId}`, a.mode as AutonomyMode);
    else wsAclMap.set(a.tool, a.mode as AutonomyMode);
  }

  const integrations = await db
    .select({
      id: integration.id,
      kind: integration.kind,
      label: integration.label,
      status: integration.status,
    })
    .from(integration)
    .where(eq(integration.workspaceId, wsId));

  const tools = agent.listTools();
  const defaultMode = (policyRow?.defaultMode as AutonomyMode | undefined) ?? 'ask';

  // Combine real tools with virtual ones (no LLM exposure, ACL-gated routes).
  const allTools = [
    ...tools,
    ...VIRTUAL_TOOLS.filter((v) => !tools.some((t) => t.name === v.name)),
  ];

  const toolRows = allTools.map((t) => {
    const override = wsAclMap.get(t.name) ?? null;
    const effective: AutonomyMode =
      t.kind === 'read' ? 'autopilot' : (override ?? defaultMode ?? KIND_DEFAULT[t.kind]);
    return {
      name: t.name,
      description: t.description,
      kind: t.kind,
      effective,
      override,
      scopable: SCOPED_TOOLS.has(t.name),
    };
  });

  // Per-integration override matrix only for tools flagged as scopable.
  const scopedRows = toolRows
    .filter((t) => t.scopable)
    .flatMap((t) =>
      integrations.map((i) => ({
        tool: t.name,
        integrationId: i.id,
        integrationLabel: i.label,
        integrationKind: i.kind,
        integrationStatus: i.status,
        effective: t.effective,
        override: scopedAclMap.get(`${t.name}::${i.id}`) ?? null,
      })),
    );

  return (
    <Page>
      <PageHeader
        title="Autonomy"
        description="Configure how the Conductor acts on your behalf. Every tool the agent can call is governed by these rules — scoped per-integration when relevant."
      />
      <AutonomyForm
        initial={{
          defaultMode,
          enabled: policyRow?.enabled ?? true,
          notificationLevel: policyRow?.notificationLevel ?? 40,
          dailyCostCapUsd: policyRow?.dailyCostCapUsd ?? 2,
          dailyActionCap: policyRow?.dailyActionCap ?? 50,
          tickIntervalSec: policyRow?.tickIntervalSec ?? 300,
          unlimitedAi: wsRow?.unlimitedAi ?? false,
        }}
        tools={toolRows}
        scopedRows={scopedRows}
      />
    </Page>
  );
}

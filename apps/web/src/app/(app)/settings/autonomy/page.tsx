import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { agentPolicy, toolAcl, workspace } from '@metu/db/schema';
import { agent } from '@metu/core';
import { AutonomyForm, type AutonomyMode } from '@/components/autonomy-form';

const KIND_DEFAULT: Record<'read' | 'low_risk' | 'high_risk', AutonomyMode> = {
  read: 'autopilot',
  low_risk: 'auto_with_undo',
  high_risk: 'ask',
};

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
    .select({ tool: toolAcl.tool, mode: toolAcl.mode })
    .from(toolAcl)
    .where(eq(toolAcl.workspaceId, wsId));
  const aclMap = new Map(acls.map((a) => [a.tool, a.mode as AutonomyMode]));

  const tools = agent.listTools();
  const defaultMode = (policyRow?.defaultMode as AutonomyMode | undefined) ?? 'ask';

  const toolRows = tools.map((t) => {
    const override = aclMap.get(t.name) ?? null;
    const effective: AutonomyMode =
      t.kind === 'read' ? 'autopilot' : (override ?? defaultMode ?? KIND_DEFAULT[t.kind]);
    return {
      name: t.name,
      description: t.description,
      kind: t.kind,
      effective,
      override,
    };
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Autonomy</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
          Configure how the Conductor acts on your behalf. Every tool the agent can call is governed
          by these rules.
        </p>
      </header>
      <AutonomyForm
        initial={{
          defaultMode,
          notificationLevel: policyRow?.notificationLevel ?? 40,
          dailyCostCapUsd: policyRow?.dailyCostCapUsd ?? 2,
          dailyActionCap: policyRow?.dailyActionCap ?? 50,
          tickIntervalSec: policyRow?.tickIntervalSec ?? 300,
          unlimitedAi: wsRow?.unlimitedAi ?? false,
        }}
        tools={toolRows}
      />
    </div>
  );
}

import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { and, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { agentRun, voiceUsage, workspace, workspaceMember } from '@metu/db/schema';
import { Page, PageHeader, Card, CardTitle, CardValue, CardDescription } from '@metu/ui';

function startOfMonthUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return '$0.00';
  return `$${n.toFixed(2)}`;
}

export default async function UsageSettingsPage() {
  const session = await auth();
  if (!session) redirect('/sign-in');

  const db = getDb();
  const workspaceId = session.user.workspaceId;

  // Owner or admin only — usage is workspace-wide, including everyone's BYOK spend.
  const [me] = await db
    .select({ role: workspaceMember.role })
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.userId, session.user.id),
        eq(workspaceMember.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!me || (me.role !== 'owner' && me.role !== 'admin')) {
    return (
      <Page className="mx-auto max-w-3xl">
        <PageHeader
          title="Usage"
          description="Owner or admin role required to view workspace usage."
        />
      </Page>
    );
  }

  const [ws] = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      cap: workspace.monthlyCostCapUsd,
      unlimited: workspace.unlimitedAi,
    })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  if (!ws) redirect('/');

  const monthStart = startOfMonthUtc();

  // AI spend this month (all runs, grouped by intent for the breakdown).
  const aiRows = await db
    .select({
      intent: agentRun.intent,
      cost: sql<number>`coalesce(sum(${agentRun.costUsd}), 0)`,
      runs: sql<number>`count(*)`,
    })
    .from(agentRun)
    .where(and(eq(agentRun.workspaceId, workspaceId), gte(agentRun.startedAt, monthStart)))
    .groupBy(agentRun.intent);

  const aiTotal = aiRows.reduce((s, r) => s + Number(r.cost ?? 0), 0);
  const aiRuns = aiRows.reduce((s, r) => s + Number(r.runs ?? 0), 0);

  // Voice spend this month (separate table, paid BYOK provider calls).
  const voiceRows = await db
    .select({
      lane: voiceUsage.lane,
      cost: sql<number>`coalesce(sum(${voiceUsage.costUsd}), 0)`,
      seconds: sql<number>`coalesce(sum(${voiceUsage.seconds}), 0)`,
      calls: sql<number>`count(*)`,
    })
    .from(voiceUsage)
    .where(and(eq(voiceUsage.workspaceId, workspaceId), gte(voiceUsage.createdAt, monthStart)))
    .groupBy(voiceUsage.lane);

  const voiceTotal = voiceRows.reduce((s, r) => s + Number(r.cost ?? 0), 0);
  const voiceCalls = voiceRows.reduce((s, r) => s + Number(r.calls ?? 0), 0);

  const total = aiTotal + voiceTotal;
  const capUsd = ws.cap ? Number(ws.cap) : null;
  const capPct = capUsd && capUsd > 0 ? Math.min(100, (total / capUsd) * 100) : null;

  return (
    <Page className="mx-auto max-w-4xl">
      <PageHeader
        title="Usage"
        description={`AI + voice spend this month, billed to your BYOK keys. Resets on the 1st (UTC).`}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-5">
          <CardDescription>Total this month</CardDescription>
          <CardValue>{formatUsd(total)}</CardValue>
          {ws.unlimited ? (
            <CardDescription className="mt-1">Unlimited mode — caps disabled</CardDescription>
          ) : capUsd != null ? (
            <div className="mt-2">
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-subtle)]">
                <div
                  className={`h-full ${capPct! >= 90 ? 'bg-red-500' : capPct! >= 70 ? 'bg-amber-500' : 'bg-[var(--color-brand)]'}`}
                  style={{ width: `${capPct ?? 0}%` }}
                />
              </div>
              <CardDescription className="mt-1">
                {formatUsd(total)} of {formatUsd(capUsd)} cap ({Math.round(capPct ?? 0)}%)
              </CardDescription>
            </div>
          ) : (
            <CardDescription className="mt-1">No monthly cap set</CardDescription>
          )}
        </Card>

        <Card className="p-5">
          <CardDescription>AI runs</CardDescription>
          <CardValue>{aiRuns.toLocaleString()}</CardValue>
          <CardDescription className="mt-1">{formatUsd(aiTotal)}</CardDescription>
        </Card>

        <Card className="p-5">
          <CardDescription>Voice calls</CardDescription>
          <CardValue>{voiceCalls.toLocaleString()}</CardValue>
          <CardDescription className="mt-1">{formatUsd(voiceTotal)}</CardDescription>
        </Card>
      </div>

      <Card className="mt-6 p-5">
        <CardTitle>AI by intent</CardTitle>
        <CardDescription>
          Each call routes through the BYOK provider mesh based on intent.
        </CardDescription>
        {aiRows.length === 0 ? (
          <p className="mt-3 text-sm italic text-[var(--color-fg-subtle)]">
            No AI runs yet this month.
          </p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[var(--color-fg-muted)]">
                <th className="pb-2">Intent</th>
                <th className="pb-2 text-right">Runs</th>
                <th className="pb-2 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {aiRows
                .slice()
                .sort((a, b) => Number(b.cost) - Number(a.cost))
                .map((r) => (
                  <tr key={r.intent} className="border-t border-[var(--color-border)]">
                    <td className="py-2 font-mono text-xs">{r.intent}</td>
                    <td className="py-2 text-right tabular-nums">
                      {Number(r.runs).toLocaleString()}
                    </td>
                    <td className="py-2 text-right tabular-nums">{formatUsd(Number(r.cost))}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="mt-4 p-5">
        <CardTitle>Voice by lane</CardTitle>
        <CardDescription>Realtime sessions, transcription (STT), and TTS.</CardDescription>
        {voiceRows.length === 0 ? (
          <p className="mt-3 text-sm italic text-[var(--color-fg-subtle)]">
            No voice calls yet this month.
          </p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[var(--color-fg-muted)]">
                <th className="pb-2">Lane</th>
                <th className="pb-2 text-right">Calls</th>
                <th className="pb-2 text-right">Seconds</th>
                <th className="pb-2 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {voiceRows.map((r) => (
                <tr key={r.lane} className="border-t border-[var(--color-border)]">
                  <td className="py-2 font-mono text-xs">{r.lane}</td>
                  <td className="py-2 text-right tabular-nums">
                    {Number(r.calls).toLocaleString()}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {Number(r.seconds).toLocaleString()}
                  </td>
                  <td className="py-2 text-right tabular-nums">{formatUsd(Number(r.cost))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}

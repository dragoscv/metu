/**
 * Dashboard cost-budget warning. Renders a banner only when today's metered
 * spend exceeds 80% of the workspace daily cap. Silent otherwise.
 */
import { and, eq, sql } from 'drizzle-orm';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { getDb } from '@metu/db';
import { agentPolicy, toolCall, workspace } from '@metu/db/schema';

export async function CostBudgetBanner({ workspaceId }: { workspaceId: string }) {
  const db = getDb();
  const [policy] = await db
    .select({
      cap: agentPolicy.dailyCostCapUsd,
    })
    .from(agentPolicy)
    .where(eq(agentPolicy.workspaceId, workspaceId))
    .limit(1);
  const [ws] = await db
    .select({ unlimited: workspace.unlimitedAi })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);

  const capRaw = policy?.cap;
  const cap = capRaw ? Number(capRaw) : 0;
  if (!cap || cap <= 0 || ws?.unlimited) return null;

  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [agg] = await db
    .select({
      cost: sql<number>`coalesce(sum(coalesce(${toolCall.actualCostUsd}, ${toolCall.estimatedCostUsd}, 0)), 0)::float8`,
    })
    .from(toolCall)
    .where(and(eq(toolCall.workspaceId, workspaceId), sql`${toolCall.requestedAt} >= ${dayStart}`));
  const spent = Number(agg?.cost ?? 0);
  const pct = cap > 0 ? (spent / cap) * 100 : 0;

  if (pct < 80) return null;
  const exceeded = pct >= 100;

  return (
    <Link
      href="/audit"
      className={
        exceeded
          ? 'border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 hover:bg-[var(--color-danger)]/15 flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm text-[var(--color-danger)]'
          : 'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 hover:bg-[var(--color-warning)]/15 flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm text-[var(--color-warning)]'
      }
    >
      <span className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="font-medium">
          {exceeded ? 'Daily AI cost cap exceeded' : 'Approaching daily AI cost cap'}
        </span>
      </span>
      <span className="font-mono text-xs tabular-nums">
        ${spent.toFixed(3)} / ${cap.toFixed(2)} ({pct.toFixed(0)}%)
      </span>
    </Link>
  );
}

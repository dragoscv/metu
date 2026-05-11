/**
 * Month-to-date cost summary + naive end-of-month projection.
 * Helps the user spot a runaway spend mid-month before the bill lands.
 */
import { and, eq, sql } from 'drizzle-orm';
import { Card, CardTitle } from '@metu/ui';
import { DollarSign, TrendingUp } from 'lucide-react';
import { getDb } from '@metu/db';
import { toolCall } from '@metu/db/schema';

export async function AuditMtdCost({ workspaceId }: { workspaceId: string }) {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const daysInMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const dayOfMonth = now.getUTCDate();

  const db = getDb();
  const [agg] = await db
    .select({
      cost: sql<number>`coalesce(sum(${toolCall.actualCostUsd}), 0)::float8`,
      calls: sql<number>`count(*)::int`,
    })
    .from(toolCall)
    .where(
      and(eq(toolCall.workspaceId, workspaceId), sql`${toolCall.requestedAt} >= ${monthStart}`),
    );

  const mtdCost = typeof agg?.cost === 'string' ? Number(agg.cost) : (agg?.cost ?? 0);
  const mtdCalls = typeof agg?.calls === 'string' ? Number(agg.calls) : (agg?.calls ?? 0);
  if (mtdCost === 0 && mtdCalls === 0) return null;

  const projected = dayOfMonth > 0 ? (mtdCost / dayOfMonth) * daysInMonth : 0;
  const monthLabel = monthStart.toLocaleString('en', { month: 'long', year: 'numeric' });

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle className="!mt-0 flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-[var(--color-brand)]" />
            Month-to-date
          </CardTitle>
          <p className="mt-0.5 text-xs text-[var(--color-fg-subtle)]">
            {monthLabel} · day {dayOfMonth}/{daysInMonth} · {mtdCalls} call
            {mtdCalls === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-xs text-[var(--color-fg-subtle)]">Spent</div>
            <div className="font-mono text-lg font-medium tabular-nums">${mtdCost.toFixed(3)}</div>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-1 text-xs text-[var(--color-fg-subtle)]">
              <TrendingUp className="h-3 w-3" />
              Projected EOM
            </div>
            <div className="font-mono text-lg font-medium tabular-nums text-[var(--color-fg-muted)]">
              ${projected.toFixed(3)}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

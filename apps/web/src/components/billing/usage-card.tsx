/**
 * Usage card for /settings/billing.
 *
 * Server component — pulls last-30-day counters per workspace and renders
 * a compact stats grid: captures, timeline events, tool calls (split by
 * status). No caching (`use cache` would lie about live billing usage).
 */
import { getDb } from '@metu/db';
import { capture, timelineEvent, toolCall } from '@metu/db/schema';
import { Card } from '@metu/ui';
import { and, count, eq, gte, sql } from 'drizzle-orm';

interface UsageRow {
  label: string;
  value: number;
  hint?: string;
}

export async function UsageCard({ workspaceId }: { workspaceId: string }) {
  const db = getDb();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [captures, events, tools] = await Promise.all([
    db
      .select({ n: count() })
      .from(capture)
      .where(and(eq(capture.workspaceId, workspaceId), gte(capture.createdAt, since))),
    db
      .select({ n: count() })
      .from(timelineEvent)
      .where(and(eq(timelineEvent.workspaceId, workspaceId), gte(timelineEvent.occurredAt, since))),
    db
      .select({
        status: toolCall.status,
        n: count(),
        cost: sql<number>`coalesce(sum(${toolCall.actualCostUsd}), 0)`,
      })
      .from(toolCall)
      .where(and(eq(toolCall.workspaceId, workspaceId), gte(toolCall.requestedAt, since)))
      .groupBy(toolCall.status),
  ]);

  const totalTools = tools.reduce((s, r) => s + Number(r.n ?? 0), 0);
  const successTools = tools
    .filter((r) => r.status === 'success')
    .reduce((s, r) => s + Number(r.n ?? 0), 0);
  const totalCost = tools.reduce((s, r) => s + Number(r.cost ?? 0), 0);

  const rows: UsageRow[] = [
    { label: 'Captures', value: Number(captures[0]?.n ?? 0), hint: 'last 30d' },
    { label: 'Timeline events', value: Number(events[0]?.n ?? 0), hint: 'last 30d' },
    {
      label: 'Tool calls',
      value: totalTools,
      hint: `${successTools} ok · $${totalCost.toFixed(2)}`,
    },
  ];

  return (
    <Card>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {rows.map((r) => (
          <div
            key={r.label}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3"
          >
            <div className="text-xs uppercase tracking-wide text-[var(--color-fg-subtle)]">
              {r.label}
            </div>
            <div className="mt-1 font-mono text-2xl">{r.value.toLocaleString()}</div>
            {r.hint ? (
              <div className="mt-0.5 text-[11px] text-[var(--color-fg-subtle)]">{r.hint}</div>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}

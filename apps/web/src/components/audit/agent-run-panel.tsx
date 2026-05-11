/**
 * Agent runs tile for /audit. Shows status counts + total spend across
 * Inngest functions and synchronous planner runs in the active window.
 */
import { Card } from '@metu/ui';

const STATUS_TONE: Record<string, string> = {
  pending: 'text-[var(--color-fg-subtle)]',
  running: 'text-[var(--color-info)]',
  success: 'text-[var(--color-success)]',
  failed: 'text-[var(--color-danger)]',
  cancelled: 'text-[var(--color-warning)]',
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  running: 'Running',
  success: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

interface AgentRunStat {
  status: string;
  count: number;
  cost: number;
}

export function AgentRunPanel({ rows }: { rows: AgentRunStat[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <h2 className="text-sm font-medium">Agent runs</h2>
        <p className="mt-1 text-xs text-[var(--color-fg-subtle)]">
          No planner / Inngest runs in this window.
        </p>
      </Card>
    );
  }
  const totalRuns = rows.reduce((s, r) => s + r.count, 0);
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  return (
    <Card>
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium">Agent runs</h2>
        <span className="text-[11px] text-[var(--color-fg-subtle)]">
          {totalRuns.toLocaleString()} runs · ${totalCost.toFixed(3)}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {rows.map((r) => (
          <div
            key={r.status}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-2"
          >
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
              {STATUS_LABEL[r.status] ?? r.status}
            </div>
            <div
              className={`mt-0.5 text-lg font-semibold tabular-nums ${
                STATUS_TONE[r.status] ?? 'text-[var(--color-fg)]'
              }`}
            >
              {r.count.toLocaleString()}
            </div>
            {r.cost > 0 && (
              <div className="text-[10px] tabular-nums text-[var(--color-fg-subtle)]">
                ${r.cost.toFixed(3)}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

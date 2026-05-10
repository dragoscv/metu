/**
 * ACL-mode comparison for /audit.
 *
 * Surfaces, per tool, how each ACL mode (`observe`, `ask`,
 * `auto-with-undo`, `autopilot`) differs in volume, cost, and
 * outcome. Computes a "vs cheapest mode" multiplier per tool so
 * "autopilot is 3.2× the avg cost of ask for editor.copilot_chat"
 * jumps off the page.
 *
 * Client component so the per-tool filter dropdown is interactive
 * without a server round-trip. The data fan-in is already small
 * (one row per tool×mode pair) so client filtering is fine.
 */
'use client';
import { useMemo, useState } from 'react';
import { Card, CardTitle } from '@metu/ui';

interface AclRow {
  tool: string;
  aclMode: string | null;
  calls: number;
  successCalls: number;
  failedCalls: number;
  rejectedCalls: number;
  totalCost: number;
  avgCost: number;
  maxCost: number;
}

interface Props {
  rows: AclRow[];
}

const MODE_ORDER = ['observe', 'ask', 'auto_with_undo', 'autopilot'] as const;
type Mode = (typeof MODE_ORDER)[number];

const MODE_LABEL: Record<string, string> = {
  observe: 'observe',
  ask: 'ask',
  auto_with_undo: 'auto+undo',
  autopilot: 'autopilot',
  unknown: 'unknown',
};

const MODE_TONE: Record<string, string> = {
  observe: 'text-[var(--color-fg-subtle)] border-[var(--color-border)]',
  ask: 'text-[var(--color-info)] border-[var(--color-info)]/40',
  auto_with_undo: 'text-[var(--color-warning)] border-[var(--color-warning)]/40',
  autopilot: 'text-[var(--color-danger)] border-[var(--color-danger)]/40',
  unknown: 'text-[var(--color-fg-subtle)] border-[var(--color-border)]',
};

function modeKey(m: string | null): string {
  return m ?? 'unknown';
}

export function AuditAclPanel({ rows }: Props) {
  const [selectedTool, setSelectedTool] = useState<string>('');

  // Group by tool — preserve the SQL ordering (cost desc, calls desc)
  // by walking once and only inserting on first sight.
  const byTool = useMemo(() => {
    const m = new Map<string, AclRow[]>();
    for (const r of rows) {
      const list = m.get(r.tool);
      if (list) list.push(r);
      else m.set(r.tool, [r]);
    }
    return m;
  }, [rows]);

  // Pick the top 6 tools by sum-of-cost-or-calls so the panel stays
  // dense without scrolling. The full data is still available on the
  // unfiltered list below.
  const topTools = useMemo(
    () =>
      Array.from(byTool.entries())
        .map(([tool, modes]) => {
          const totalCost = modes.reduce((s, m) => s + m.totalCost, 0);
          const totalCalls = modes.reduce((s, m) => s + m.calls, 0);
          return { tool, modes, totalCost, totalCalls };
        })
        .sort((a, b) => {
          if (b.totalCost !== a.totalCost) return b.totalCost - a.totalCost;
          return b.totalCalls - a.totalCalls;
        }),
    [byTool],
  );

  if (rows.length === 0) {
    return (
      <Card>
        <CardTitle>ACL mode comparison</CardTitle>
        <p className="mt-2 text-xs text-[var(--color-fg-subtle)]">
          No tool calls in this window. Once the Conductor or any connected agent starts running
          tools, you&apos;ll see how each ACL mode stacks up here.
        </p>
      </Card>
    );
  }

  const visible = selectedTool
    ? topTools.filter((t) => t.tool === selectedTool)
    : topTools.slice(0, 6);

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <CardTitle>ACL mode comparison</CardTitle>
        <div className="flex items-center gap-2">
          <label className="text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            tool
          </label>
          <select
            value={selectedTool}
            onChange={(e) => setSelectedTool(e.target.value)}
            className="h-7 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 text-[11px]"
          >
            <option value="">top {Math.min(6, topTools.length)}</option>
            {topTools.map((t) => (
              <option key={t.tool} value={t.tool}>
                {t.tool}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="mt-1 text-[11px] text-[var(--color-fg-subtle)]">
        Volume + spend + outcome per ACL mode. Multipliers compare avg cost to the cheapest non-zero
        mode for the same tool.
      </p>

      <div className="mt-3 space-y-3">
        {visible.length === 0 ? (
          <p className="text-xs text-[var(--color-fg-subtle)]">No data for this tool.</p>
        ) : (
          visible.map(({ tool, modes }) => <ToolRow key={tool} tool={tool} modes={modes} />)
        )}
      </div>
    </Card>
  );
}

function ToolRow({ tool, modes }: { tool: string; modes: AclRow[] }) {
  const sorted = modes
    .slice()
    .sort((a, b) => modeIndex(modeKey(a.aclMode)) - modeIndex(modeKey(b.aclMode)));

  // Cheapest non-zero average cost among modes for this tool — if any
  // mode has avgCost > 0, we use it as the multiplier baseline.
  const cheapestAvg = sorted.reduce<number | null>((m, r) => {
    if (r.avgCost <= 0) return m;
    if (m === null || r.avgCost < m) return r.avgCost;
    return m;
  }, null);

  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-mono text-xs">{tool}</span>
        <span className="shrink-0 text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
          {sorted.length} mode{sorted.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {sorted.map((r) => (
          <ModeCell key={modeKey(r.aclMode)} row={r} cheapestAvg={cheapestAvg} />
        ))}
      </div>
    </div>
  );
}

function ModeCell({ row, cheapestAvg }: { row: AclRow; cheapestAvg: number | null }) {
  const tone =
    MODE_TONE[modeKey(row.aclMode)] ?? 'text-[var(--color-fg-subtle)] border-[var(--color-border)]';
  const label = MODE_LABEL[modeKey(row.aclMode)] ?? row.aclMode ?? 'unknown';
  const successRate = row.calls > 0 ? Math.round((row.successCalls / row.calls) * 100) : 0;
  const multiplier =
    cheapestAvg !== null && cheapestAvg > 0 && row.avgCost > 0 ? row.avgCost / cheapestAvg : null;
  const isBaseline = multiplier !== null && Math.abs(multiplier - 1) < 0.01;

  return (
    <div className={`rounded-md border bg-[var(--color-bg-card)] p-2 ${tone}`}>
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
        {multiplier !== null ? (
          <span
            className="font-mono text-[10px] tabular-nums"
            title={
              isBaseline
                ? 'cheapest mode for this tool'
                : `${multiplier.toFixed(2)}× cheapest mode's avg cost`
            }
          >
            {isBaseline ? '·' : `${multiplier.toFixed(1)}×`}
          </span>
        ) : null}
      </div>
      <div className="mt-1 flex items-baseline justify-between text-[11px] text-[var(--color-fg)]">
        <span className="tabular-nums">{row.calls} calls</span>
        <span className="tabular-nums opacity-80">{successRate}% ok</span>
      </div>
      <div className="mt-1 flex items-baseline justify-between text-[10px] text-[var(--color-fg-subtle)]">
        <span className="tabular-nums">
          {row.totalCost > 0 ? `$${row.totalCost.toFixed(4)}` : '—'}
        </span>
        <span className="tabular-nums">
          {row.avgCost > 0 ? `avg $${row.avgCost.toFixed(4)}` : 'no spend'}
        </span>
      </div>
      {row.failedCalls + row.rejectedCalls > 0 ? (
        <div className="mt-1 text-[10px] text-[var(--color-fg-subtle)]">
          {row.failedCalls > 0 ? `${row.failedCalls} failed` : ''}
          {row.failedCalls > 0 && row.rejectedCalls > 0 ? ' · ' : ''}
          {row.rejectedCalls > 0 ? `${row.rejectedCalls} rejected` : ''}
        </div>
      ) : null}
    </div>
  );
}

function modeIndex(mode: string): number {
  const i = MODE_ORDER.indexOf(mode as Mode);
  return i === -1 ? MODE_ORDER.length : i;
}

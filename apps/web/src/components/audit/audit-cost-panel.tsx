/**
 * Cost panel for /audit — daily cost sparkline + top-5 most expensive
 * tools in the selected window. Server component, inline SVG (no
 * recharts/client deps) since it's read-only and small.
 */
import { Card, CardTitle } from '@metu/ui';

interface DailyPoint {
  day: string;
  cost: number;
  calls: number;
}

interface TopRow {
  tool: string;
  total: number;
  calls: number;
}

interface Props {
  daily: DailyPoint[];
  top: TopRow[];
  totalCost: number;
}

export function AuditCostPanel({ daily, top, totalCost }: Props) {
  const hasAnySpend = totalCost > 0;
  const days = daily.length;
  const maxCost = Math.max(0, ...daily.map((d) => d.cost));
  const peak = daily.reduce<DailyPoint | null>(
    (best, d) => (best === null || d.cost > best.cost ? d : best),
    null,
  );

  return (
    <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
      <Card>
        <div className="flex items-baseline justify-between gap-3">
          <CardTitle>Daily cost</CardTitle>
          <span className="text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            {days}-day window
          </span>
        </div>
        {hasAnySpend ? (
          <>
            <Sparkline points={daily} maxCost={maxCost} />
            <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--color-fg-subtle)]">
              <span>{daily[0]?.day ?? ''}</span>
              {peak && peak.cost > 0 ? (
                <span>
                  peak <span className="font-mono">${peak.cost.toFixed(4)}</span> on {peak.day}
                </span>
              ) : null}
              <span>{daily[daily.length - 1]?.day ?? ''}</span>
            </div>
          </>
        ) : (
          <p className="mt-3 text-xs text-[var(--color-fg-subtle)]">
            No metered tool spend in this window.
          </p>
        )}
      </Card>

      <Card>
        <CardTitle>Top tools by cost</CardTitle>
        {top.length === 0 ? (
          <p className="mt-3 text-xs text-[var(--color-fg-subtle)]">
            No metered calls yet — costs land here once tools report `actualCostUsd`.
          </p>
        ) : (
          <ol className="mt-3 space-y-1.5">
            {top.map((t) => {
              const pct = totalCost > 0 ? Math.min(100, (t.total / totalCost) * 100) : 0;
              return (
                <li key={t.tool} className="text-xs">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-mono">{t.tool}</span>
                    <span className="shrink-0 tabular-nums text-[var(--color-fg-subtle)]">
                      ${t.total.toFixed(4)} <span className="opacity-60">· {t.calls}</span>
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-elevated)]">
                    <div
                      className="bg-[var(--color-brand)]/70 h-full rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </div>
  );
}

function Sparkline({ points, maxCost }: { points: DailyPoint[]; maxCost: number }) {
  const W = 320;
  const H = 64;
  const pad = 2;
  const n = points.length;
  if (n === 0 || maxCost <= 0) {
    return <div className="mt-3 h-16 w-full rounded bg-[var(--color-bg-elevated)]" />;
  }
  const stepX = n > 1 ? (W - pad * 2) / (n - 1) : 0;
  const yFor = (v: number) => H - pad - (v / maxCost) * (H - pad * 2);

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${pad + i * stepX} ${yFor(p.cost)}`)
    .join(' ');
  const areaPath = `${linePath} L ${pad + (n - 1) * stepX} ${H - pad} L ${pad} ${H - pad} Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mt-3 h-16 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label="Daily tool-call cost over the selected window"
    >
      <defs>
        <linearGradient id="audit-cost-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#audit-cost-fill)" />
      <path
        d={linePath}
        fill="none"
        stroke="var(--color-brand)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

'use client';
import dynamic from 'next/dynamic';

export interface SparklinePoint {
  t: number;
  v: number;
}

// recharts is heavy (~50KB gz); load it only when a sparkline actually
// renders. The placeholder reserves the same height to avoid layout shift.
const SparklineChart = dynamic(() => import('./sparkline-chart'), {
  ssr: false,
  loading: () => <div className="animate-pulse rounded bg-[var(--color-bg-muted)]" />,
});

export function Sparkline({
  data,
  color = 'var(--color-brand)',
  height = 36,
}: {
  data: SparklinePoint[];
  color?: string;
  height?: number;
}) {
  if (!data || data.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-[10px] text-[var(--color-fg-subtle)]"
        style={{ height }}
      >
        not enough data
      </div>
    );
  }
  return <SparklineChart data={data} color={color} height={height} />;
}

'use client';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';

export interface SparklinePoint {
  t: number;
  v: number;
}

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
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <defs>
            <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            fill="url(#sparkFill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

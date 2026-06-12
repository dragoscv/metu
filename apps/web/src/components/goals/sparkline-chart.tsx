'use client';
/**
 * Recharts-rendering body of the sparkline. Loaded lazily via
 * next/dynamic from `sparkline.tsx` so recharts (~50KB gz) stays out of
 * the initial bundle of every page that lists goals.
 */
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import type { SparklinePoint } from './sparkline';

export default function SparklineChart({
  data,
  color,
  height,
}: {
  data: SparklinePoint[];
  color: string;
  height: number;
}) {
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

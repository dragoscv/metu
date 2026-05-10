'use client';
/**
 * Stacked-bar chart of voice spend over the last N days, broken down by
 * lane (realtime / stt / tts). Reads from `getVoiceUsageDailyAction` so
 * the data is server-aggregated and tiny.
 */
import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { VoiceUsageDayBucket } from '@/app/actions/billing';

interface Props {
  initial: VoiceUsageDayBucket[];
  refetch: () => Promise<VoiceUsageDayBucket[]>;
}

export function VoiceUsageChart({ initial, refetch }: Props) {
  const [data, setData] = useState(initial);
  useEffect(() => {
    const t = window.setInterval(() => {
      void refetch()
        .then(setData)
        .catch(() => {});
    }, 60_000);
    return () => window.clearInterval(t);
  }, [refetch]);

  const total = data.reduce((s, d) => s + d.totalUsd, 0);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between text-xs text-zinc-400">
        <span>Last {data.length} days</span>
        <span className="font-mono">${total.toFixed(3)} spent</span>
      </div>
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis
              dataKey="day"
              fontSize={10}
              stroke="rgba(255,255,255,0.4)"
              tickFormatter={(d: string) => d.slice(5)}
            />
            <YAxis
              fontSize={10}
              stroke="rgba(255,255,255,0.4)"
              tickFormatter={(v: number) => `$${v.toFixed(2)}`}
            />
            <Tooltip
              contentStyle={{
                background: 'rgb(20 20 24)',
                border: '1px solid rgb(40 40 48)',
                fontSize: 12,
              }}
              formatter={(v) => `$${Number(v).toFixed(4)}`}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="realtimeUsd" name="Realtime" stackId="a" fill="#7c3aed" />
            <Bar dataKey="sttUsd" name="STT" stackId="a" fill="#0ea5e9" />
            <Bar dataKey="ttsUsd" name="TTS" stackId="a" fill="#10b981" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

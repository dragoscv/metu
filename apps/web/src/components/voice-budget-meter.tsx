'use client';
/**
 * Voice budget meter — companion-agent slice 7.
 *
 * Shows current month voice spend vs cap. Polls every 60 s; goes amber at
 * 80 % (soft warn) and red at 100 % (hard cut — broker returns 402).
 *
 * Mounted in `/settings/presence`. Hidden when the workspace is unlimited
 * or no cap is configured.
 */
import { useEffect, useState } from 'react';
import type { VoiceCapView } from '@/app/actions/presence';

export interface VoiceBudgetMeterProps {
  initial: VoiceCapView;
  refetch: () => Promise<VoiceCapView>;
}

export function VoiceBudgetMeter({ initial, refetch }: VoiceBudgetMeterProps) {
  const [state, setState] = useState(initial);

  useEffect(() => {
    let alive = true;
    const t = setInterval(async () => {
      try {
        const next = await refetch();
        if (alive) setState(next);
      } catch {
        // Best-effort; next tick will retry.
      }
    }, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [refetch]);

  if (state.unlimited) {
    return (
      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
        Voice usage: unlimited
      </div>
    );
  }
  if (state.capUsd <= 0) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-400">
        Voice usage tracking: idle (no cap configured)
      </div>
    );
  }

  const pct = Math.min(100, Math.round((state.spentUsd / state.capUsd) * 100));
  const tone = state.hard
    ? 'border-red-500/50 bg-red-500/10 text-red-200'
    : state.soft
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
      : 'border-zinc-700 bg-zinc-900/40 text-zinc-300';
  const barTone = state.hard ? 'bg-red-500' : state.soft ? 'bg-amber-400' : 'bg-emerald-500';

  return (
    <div className={`rounded-lg border ${tone} px-3 py-2 text-xs`}>
      <div className="flex items-center justify-between gap-3">
        <span>
          Voice usage: <span className="font-mono">${state.spentUsd.toFixed(2)}</span> /{' '}
          <span className="font-mono">${state.capUsd.toFixed(2)}</span> this month
        </span>
        <span className="font-mono">{pct}%</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-zinc-800">
        <div
          className={`h-full ${barTone} transition-[width] duration-300`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {state.hard ? (
        <p className="mt-1 text-[11px]">
          Cap reached — voice broker is rejecting new requests until next billing period or cap
          increase.
        </p>
      ) : state.soft ? (
        <p className="mt-1 text-[11px]">Approaching monthly cap.</p>
      ) : null}
    </div>
  );
}

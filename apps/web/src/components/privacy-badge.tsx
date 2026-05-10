'use client';
/**
 * Privacy badge — the on-screen "you are being observed" indicator (D16).
 *
 * Renders a small dot+label that updates every minute via re-fetching
 * `getPrivacyBadgeState()`. When any persona is active OR there's been a
 * sensory event in the last 5min, it goes amber. Mounts on the
 * /settings/presence page; companion gets its own mirror in slice 11.
 */
import { useEffect, useState } from 'react';
import type { PrivacyBadgeState } from '@/app/actions/presence';

export interface PrivacyBadgeProps {
  initial: PrivacyBadgeState;
  /** Server action reference passed in so the client doesn't need to import it directly. */
  refetch: () => Promise<PrivacyBadgeState>;
}

export function PrivacyBadge({ initial, refetch }: PrivacyBadgeProps) {
  const [state, setState] = useState(initial);

  useEffect(() => {
    let alive = true;
    const t = setInterval(async () => {
      try {
        const next = await refetch();
        if (alive) setState(next);
      } catch {
        // Network blips are fine — try again next tick.
      }
    }, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [refetch]);

  const observing = state.observingActivations > 0 || state.recentSensoryCount > 0;
  const tone = observing
    ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
    : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200';
  const dotTone = observing
    ? 'bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.7)]'
    : 'bg-emerald-300';

  return (
    <div
      className={
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ' + tone
      }
      role="status"
      aria-live="polite"
    >
      <span className={'h-2 w-2 rounded-full ' + dotTone} aria-hidden />
      {observing ? (
        <>
          <span>Observing</span>
          <span className="text-[10px] opacity-70">
            · {state.observingActivations} active
            {state.recentSensoryCount > 0
              ? ` · ${state.recentSensoryCount} event${
                  state.recentSensoryCount === 1 ? '' : 's'
                } in the last 5m`
              : ''}
            {state.lastSensoryAt
              ? ` · last ${state.lastSensoryKind ?? 'event'} ${formatRel(state.lastSensoryAt)}`
              : ''}
          </span>
        </>
      ) : (
        <span>Idle · nothing recently observed</span>
      )}
    </div>
  );
}

function formatRel(d: Date | string): string {
  const t = typeof d === 'string' ? new Date(d) : d;
  const diff = Date.now() - t.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

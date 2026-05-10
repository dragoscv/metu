/**
 * Companion — privacy badge mirror.
 *
 * Polls `/api/sdk/v1/presence/badge` every 60s and renders a small pill
 * that goes amber when any persona is active or anything was observed in
 * the last 5 minutes. Mirrors the web `<PrivacyBadge>` so the companion
 * never silently observes — D16 commitment.
 */
import { useEffect, useState } from 'react';
import type { AuthState } from '../state/auth';

interface BadgeState {
  observingActivations: number;
  recentSensoryCount: number;
  lastSensoryAt: string | null;
  lastSensoryKind: string | null;
}

const POLL_MS = 60_000;

export function ObservingBadge({ auth }: { auth: AuthState }) {
  const [state, setState] = useState<BadgeState | null>(null);

  useEffect(() => {
    let alive = true;
    const url = `${auth.apiBase.replace(/\/$/, '')}/api/sdk/v1/presence/badge`;
    async function tick() {
      try {
        const res = await fetch(url, {
          headers: { authorization: `Bearer ${auth.accessToken}` },
        });
        if (!res.ok) return;
        const json = (await res.json()) as { ok: boolean } & BadgeState;
        if (alive && json.ok) setState(json);
      } catch {
        // Network blips are fine — try again next tick.
      }
    }
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [auth.apiBase, auth.accessToken]);

  if (!state) return null;

  const observing = state.observingActivations > 0 || state.recentSensoryCount > 0;
  const cls = observing ? 'observing-badge observing-badge--on' : 'observing-badge';
  return (
    <div className={cls} role="status" aria-live="polite">
      <span className="observing-badge__dot" aria-hidden />
      <span className="observing-badge__label">{observing ? 'Observing' : 'Idle'}</span>
      {observing && state.lastSensoryAt ? (
        <span className="observing-badge__detail">
          · last {state.lastSensoryKind ?? 'event'} {formatRel(state.lastSensoryAt)}
        </span>
      ) : null}
    </div>
  );
}

function formatRel(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

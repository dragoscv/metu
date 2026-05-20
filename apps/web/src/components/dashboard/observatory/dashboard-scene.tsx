'use client';
/**
 * DashboardScene — composes the observatory.
 *
 *   <Atmosphere>            (fixed background, behind everything)
 *   <NowRail>               (anchor: clock + date + capture CTA)
 *   <Heartbeat skin>        (dynamic: constellation / rings / river / garden / cards)
 *   <ActionSurface>         (optional: capture / ring / console — TBD batches)
 *
 * The skin is chosen via prefs.skin, falling back to constellation.
 * Reduced-motion users automatically get the card-stack skin regardless.
 */
import { useEffect, useState } from 'react';
import type { DashboardPrefs, StreamItem } from '@/lib/dashboard/types';
import { Atmosphere } from './atmosphere';
import { NowRail } from './now-rail';
import { HEARTBEAT_LABELS, pickHeartbeat } from './heartbeats';
import { ActionRing } from './action-ring';
import { ActionConsole } from './action-console';
import { SoundCanopy } from './sound-canopy';

export interface DashboardSceneProps {
  prefs: DashboardPrefs;
  streams: StreamItem[];
  greetingName?: string;
}

export function DashboardScene({ prefs, streams, greetingName }: DashboardSceneProps) {
  const [osReduced, setOsReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setOsReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setOsReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const forceCalm = osReduced || prefs.manualReducedMotion;
  const effectiveSkin = forceCalm ? 'card-stack' : prefs.skin;
  const motionMode = forceCalm ? 'calm' : prefs.motionMode;
  const Heartbeat = pickHeartbeat(effectiveSkin);
  const skinMeta = HEARTBEAT_LABELS[effectiveSkin];

  return (
    <section className="space-y-6" aria-label="dashboard observatory" data-mood={prefs.mood}>
      <Atmosphere motionMode={motionMode} />
      <NowRail
        greetingName={greetingName}
        showSessionAnchor={prefs.showSessionAnchor}
        actionSurface={prefs.actionSurface}
      />
      {prefs.actionSurface === 'console' ? <ActionConsole /> : null}
      <div className="space-y-2">
        {/*
         * key=effectiveSkin remounts the heartbeat on switch so the new
         * skin gets its entrance animation instead of swapping silently.
         */}
        <div
          key={effectiveSkin}
          className="animate-[metu-skin-fade_320ms_cubic-bezier(0.22,1,0.36,1)]"
        >
          <Heartbeat
            streams={streams}
            motionMode={motionMode}
            staleAfterDays={prefs.staleAfterDays}
          />
        </div>
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
          <span>
            {skinMeta.name} — {skinMeta.tagline}
          </span>
          <div className="flex items-center gap-2">
            <SoundCanopy enabled={prefs.soundEnabled} streams={streams} />
            <a href="/settings/dashboard" className="hover:text-[var(--color-fg-muted)]">
              customize
            </a>
          </div>
        </div>
      </div>
      {prefs.actionSurface === 'ring' && !forceCalm ? <ActionRing motionMode={motionMode} /> : null}
    </section>
  );
}

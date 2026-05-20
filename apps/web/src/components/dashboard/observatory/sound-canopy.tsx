'use client';
/**
 * SoundCanopy — observatory ambient + chime player.
 *
 * Listens to the latest stream-item ids the scene currently renders. When
 * a new item appears (id we haven't seen before in this mount), we play a
 * short chime tuned to that item's valence. Throttled to one chime per 1.2s
 * so a burst of new items doesn't machine-gun the user.
 *
 * Ambient drone toggles purely from `enabled`. Browser autoplay policy
 * means we still need a user gesture before the first sound — we expose
 * a small "enable audio" affordance when `enabled && !primed`.
 */
import { useEffect, useRef, useState } from 'react';
import { Volume2 } from 'lucide-react';
import type { StreamItem } from '@/lib/dashboard/types';
import { playChime, startAmbient, stopAmbient } from '@/lib/dashboard/sounds';

const THROTTLE_MS = 1200;

export function SoundCanopy({ enabled, streams }: { enabled: boolean; streams: StreamItem[] }) {
  const seenIds = useRef<Set<string>>(new Set());
  const lastChimeAt = useRef<number>(0);
  const [primed, setPrimed] = useState(false);

  // Initialize known-set on mount so we don't chime for the initial paint.
  useEffect(() => {
    seenIds.current = new Set(streams.map((s) => s.id));
    // Intentionally one-shot — subsequent updates flow through the diff effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drive ambient on/off.
  useEffect(() => {
    if (!enabled || !primed) {
      stopAmbient();
      return;
    }
    startAmbient();
    return () => stopAmbient();
  }, [enabled, primed]);

  // Diff streams; chime for new ids.
  useEffect(() => {
    if (!enabled || !primed) {
      // Still record so we don't chime when re-enabled.
      seenIds.current = new Set(streams.map((s) => s.id));
      return;
    }
    const now = Date.now();
    for (const s of streams) {
      if (seenIds.current.has(s.id)) continue;
      seenIds.current.add(s.id);
      if (now - lastChimeAt.current >= THROTTLE_MS) {
        lastChimeAt.current = now;
        playChime(s.valence);
        break; // one chime per render at most
      }
    }
  }, [streams, enabled, primed]);

  if (!enabled || primed) return null;

  return (
    <button
      type="button"
      onClick={() => {
        // First gesture unlocks Web Audio (browser policy).
        playChime('pulse', { volume: 0.05 });
        setPrimed(true);
      }}
      className="bg-[var(--color-night-elev)]/40 inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] px-2.5 py-1 text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)] backdrop-blur-md transition-colors hover:border-[var(--color-pulse)] hover:text-[var(--color-fg-muted)]"
      aria-label="enable observatory audio"
    >
      <Volume2 className="h-3 w-3" />
      enable audio
    </button>
  );
}

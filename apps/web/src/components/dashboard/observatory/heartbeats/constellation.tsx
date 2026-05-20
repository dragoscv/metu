'use client';
/**
 * Constellation — DEFAULT heartbeat skin.
 *
 * Composition rules:
 *   - center is the user (implicit, void)
 *   - STREAKS rise vertically: y is pushed up by intensity
 *   - PULSES cluster near center, jittered by recency
 *   - DRIFTS orbit outward, radial distance grows with age
 *
 * Pure SVG over a normal block element — no R3F yet (Slice 2+).
 * Items are absolutely positioned in a 16:9-ish viewport that scales.
 */
import { useMemo } from 'react';
import type { StreamItem } from '@/lib/dashboard/types';
import { intensityFor } from '@/lib/dashboard/valence';
import { StreamObject } from '../stream-object';
import { EmptyHeartbeat } from './empty-heartbeat';

export interface ConstellationProps {
  streams: StreamItem[];
  motionMode: 'calm' | 'alive';
  staleAfterDays: number;
}

interface Placed {
  item: StreamItem;
  x: number; // %
  y: number; // %
  intensity: number;
}

function deterministicHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

function place(streams: StreamItem[], staleAfterDays: number): Placed[] {
  const placed: Placed[] = [];
  let streakCol = 0;
  const streaks = streams.filter((s) => s.valence === 'streak');
  const pulses = streams.filter((s) => s.valence === 'pulse');
  const drifts = streams.filter((s) => s.valence === 'drift');

  // STREAKS: vertical column on the left, taller = stronger
  for (const s of streaks) {
    const inten = intensityFor(s, staleAfterDays);
    const x = 12 + (streakCol % 3) * 6; // 3-wide column
    const y = 80 - inten * 65; // bottom (low) → top (high)
    placed.push({ item: s, x, y, intensity: inten });
    streakCol++;
  }

  // PULSES: cluster around center (50,50), brighter = closer
  for (const s of pulses) {
    const inten = intensityFor(s, staleAfterDays);
    const r = deterministicHash(s.id);
    const r2 = deterministicHash(s.id + 'y');
    const angle = r * Math.PI * 2;
    const dist = (1 - inten) * 25 + r2 * 6; // 0..31% from center
    const x = 50 + Math.cos(angle) * dist;
    const y = 50 + Math.sin(angle) * dist * 0.7; // squish vertical
    placed.push({ item: s, x, y, intensity: inten });
  }

  // DRIFTS: outer orbit on the right, older = further out
  let driftIdx = 0;
  for (const s of drifts) {
    const inten = intensityFor(s, staleAfterDays);
    const ringRadius = 22 + (1 - inten) * 18;
    const angle = (driftIdx / Math.max(1, drifts.length)) * Math.PI - Math.PI / 2;
    const x = 78 + Math.cos(angle) * ringRadius;
    const y = 50 + Math.sin(angle) * ringRadius * 0.8;
    placed.push({ item: s, x, y, intensity: inten });
    driftIdx++;
  }

  return placed;
}

export default function Constellation({ streams, motionMode, staleAfterDays }: ConstellationProps) {
  const placed = useMemo(() => place(streams, staleAfterDays), [streams, staleAfterDays]);
  const animated = motionMode === 'alive';

  if (streams.length === 0) {
    return (
      <EmptyHeartbeat
        glyph="☆"
        title="A still sky."
        hint="Capture a thought, sync an integration, or set a goal — the first lights will appear here."
      />
    );
  }

  return (
    <div
      className="from-[var(--color-night-deep)]/60 to-[var(--color-night-elev)]/40 relative aspect-[16/9] w-full overflow-hidden rounded-2xl border border-[var(--color-border)] bg-gradient-to-b backdrop-blur-sm"
      role="region"
      aria-label="constellation of your streams"
    >
      {/* faint horizon line */}
      <div
        aria-hidden
        className="absolute inset-x-12 bottom-12 h-px"
        style={{
          background:
            'linear-gradient(90deg, transparent, color-mix(in oklch, var(--color-mist) 40%, transparent), transparent)',
        }}
      />
      {placed.map(({ item, x, y, intensity }) => (
        <div
          key={item.id}
          className="absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${x}%`, top: `${y}%` }}
        >
          <StreamObject
            item={item}
            intensity={intensity}
            animated={animated}
            staleAfterDays={staleAfterDays}
            size={28}
          />
        </div>
      ))}
    </div>
  );
}

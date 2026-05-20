'use client';
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import type { StreamItem } from '@/lib/dashboard/types';
import { intensityFor, VALENCE_STYLE } from '@/lib/dashboard/valence';
import { StreamObject } from '../stream-object';
import { EmptyHeartbeat } from './empty-heartbeat';

/**
 * PulseRings — items orbit on rings keyed by valence.
 * Streaks on the inner ring (most committed), pulses mid, drifts outer.
 * In `alive` mode each ring rotates slowly and outward ripples breathe
 * from the center on a 6 s loop.
 */
export default function PulseRings({
  streams,
  motionMode,
  staleAfterDays,
}: {
  streams: StreamItem[];
  motionMode: 'calm' | 'alive';
  staleAfterDays: number;
}) {
  const rings = useMemo(() => {
    const order: Array<{ valence: 'streak' | 'pulse' | 'drift'; r: number; rot: number }> = [
      { valence: 'streak', r: 18, rot: 24 },
      { valence: 'pulse', r: 32, rot: -16 },
      { valence: 'drift', r: 46, rot: 12 },
    ];
    return order.map((o) => {
      const items = streams.filter((s) => s.valence === o.valence);
      return {
        ...o,
        items: items.map((s, i) => {
          const angle = (i / Math.max(1, items.length)) * Math.PI * 2;
          return {
            item: s,
            angle,
            x: 50 + Math.cos(angle) * o.r,
            y: 50 + Math.sin(angle) * o.r * 0.78,
            intensity: intensityFor(s, staleAfterDays),
          };
        }),
      };
    });
  }, [streams, staleAfterDays]);

  if (streams.length === 0) {
    return (
      <EmptyHeartbeat
        glyph="◯"
        title="No echoes yet."
        hint="As you capture, sync, or check in, ripples will pulse outward from the center."
      />
    );
  }

  return (
    <div className="bg-[var(--color-night-deep)]/50 relative aspect-[16/9] w-full overflow-hidden rounded-2xl border border-[var(--color-border)]">
      {motionMode === 'alive'
        ? [0, 1, 2].map((i) => (
            <motion.div
              key={i}
              aria-hidden
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border"
              style={{
                width: 24,
                height: 24,
                borderColor: 'color-mix(in oklch, var(--color-pulse) 50%, transparent)',
              }}
              initial={{ scale: 0.6, opacity: 0.6 }}
              animate={{ scale: [0.6, 4.5], opacity: [0.55, 0] }}
              transition={{ duration: 6, ease: 'easeOut', repeat: Infinity, delay: i * 2 }}
            />
          ))
        : null}

      {rings.map((ring) => (
        <div key={ring.valence} className="absolute inset-0">
          <div
            aria-hidden
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              width: `${ring.r * 2}%`,
              aspectRatio: '1 / 0.78',
              border: `1px dashed color-mix(in oklch, var(${VALENCE_STYLE[ring.valence].colorVar}) 30%, transparent)`,
            }}
          />
          <motion.div
            className="absolute inset-0"
            animate={motionMode === 'alive' ? { rotate: ring.rot } : { rotate: 0 }}
            transition={{
              duration: 80,
              repeat: motionMode === 'alive' ? Infinity : 0,
              ease: 'linear',
              repeatType: 'loop',
            }}
            style={{ transformOrigin: '50% 50%' }}
          >
            {ring.items.map(({ item, x, y, intensity }) => (
              <div
                key={item.id}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${x}%`, top: `${y}%` }}
              >
                <motion.div
                  animate={motionMode === 'alive' ? { rotate: -ring.rot } : { rotate: 0 }}
                  transition={{
                    duration: 80,
                    repeat: motionMode === 'alive' ? Infinity : 0,
                    ease: 'linear',
                    repeatType: 'loop',
                  }}
                >
                  <StreamObject
                    item={item}
                    intensity={intensity}
                    animated={motionMode === 'alive'}
                    staleAfterDays={staleAfterDays}
                    size={26}
                  />
                </motion.div>
              </div>
            ))}
          </motion.div>
        </div>
      ))}
    </div>
  );
}

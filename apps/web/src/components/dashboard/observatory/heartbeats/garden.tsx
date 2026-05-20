'use client';
import { motion } from 'framer-motion';
import type { StreamItem } from '@/lib/dashboard/types';
import { intensityFor, VALENCE_STYLE } from '@/lib/dashboard/valence';
import { StreamObject } from '../stream-object';
import { EmptyHeartbeat } from './empty-heartbeat';

/**
 * Garden — items as plants on three tiers of ground.
 *   • streaks  → roots/trees on the lowest tier (sturdy)
 *   • pulses   → flowers on the middle tier
 *   • drifts   → embers on the upper tier (fading sky)
 *
 * Alive mode adds a slow wind sway and ember drift.
 */
export default function Garden({
  streams,
  motionMode,
  staleAfterDays,
}: {
  streams: StreamItem[];
  motionMode: 'calm' | 'alive';
  staleAfterDays: number;
}) {
  if (streams.length === 0) {
    return (
      <EmptyHeartbeat
        glyph="⚘"
        title="Bare ground."
        hint="Plant your first seed with a capture, a goal check-in, or an integration sync."
      />
    );
  }

  const tiers: Array<{
    key: 'streak' | 'pulse' | 'drift';
    y: string;
    label: string;
    items: StreamItem[];
  }> = [
    { key: 'drift', y: '24%', label: 'sky', items: streams.filter((s) => s.valence === 'drift') },
    {
      key: 'pulse',
      y: '52%',
      label: 'meadow',
      items: streams.filter((s) => s.valence === 'pulse'),
    },
    {
      key: 'streak',
      y: '78%',
      label: 'roots',
      items: streams.filter((s) => s.valence === 'streak'),
    },
  ];

  return (
    <div
      className="relative aspect-[16/9] w-full overflow-hidden rounded-2xl border border-[var(--color-border)]"
      style={{
        background:
          'linear-gradient(180deg, color-mix(in oklch, var(--color-rim-cyan) 18%, var(--color-night-deep)) 0%, color-mix(in oklch, var(--color-pulse) 8%, var(--color-night-deep)) 60%, var(--color-night-deep) 100%)',
      }}
    >
      {/* horizon glow */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-1/2 h-1/2"
        style={{
          background:
            'radial-gradient(ellipse at 50% 0%, color-mix(in oklch, var(--color-pulse) 18%, transparent) 0%, transparent 60%)',
        }}
      />

      {tiers.map((tier) => (
        <div key={tier.key} className="absolute inset-x-0" style={{ top: tier.y }}>
          <div
            aria-hidden
            className="absolute inset-x-6 h-px"
            style={{
              background: `linear-gradient(90deg, transparent, color-mix(in oklch, var(${VALENCE_STYLE[tier.key].colorVar}) 35%, transparent), transparent)`,
            }}
          />
          <span
            className="absolute -top-3 right-3 text-[10px] uppercase tracking-wider"
            style={{ color: `var(${VALENCE_STYLE[tier.key].colorVar})`, opacity: 0.5 }}
          >
            {tier.label}
          </span>
        </div>
      ))}

      {tiers.flatMap((tier) =>
        tier.items.map((item, i) => {
          const x = 8 + ((i * 11 + tier.key.length * 5) % 84);
          const inten = intensityFor(item, staleAfterDays);
          const drift = tier.key === 'drift';
          const sway = tier.key === 'pulse';
          return (
            <motion.div
              key={item.id}
              className="absolute -translate-x-1/2 -translate-y-full"
              style={{ left: `${x}%`, top: tier.y }}
              animate={
                motionMode === 'alive'
                  ? drift
                    ? { y: [0, -10, 0], opacity: [0.6, 0.95, 0.6] }
                    : sway
                      ? { rotate: [-3, 3, -3] }
                      : { y: [0, -1.5, 0] }
                  : undefined
              }
              transition={{
                duration: drift ? 8 : sway ? 5 : 6,
                repeat: motionMode === 'alive' ? Infinity : 0,
                ease: 'easeInOut',
                delay: (i % 5) * 0.4,
              }}
            >
              <div className="flex flex-col items-center">
                <StreamObject
                  item={item}
                  intensity={inten}
                  animated={motionMode === 'alive'}
                  staleAfterDays={staleAfterDays}
                  size={tier.key === 'streak' ? 28 : tier.key === 'pulse' ? 24 : 18}
                />
                {tier.key === 'streak' ? (
                  <div
                    aria-hidden
                    className="mt-0.5 w-px"
                    style={{
                      height: 12 + inten * 14,
                      background: `linear-gradient(180deg, color-mix(in oklch, var(${VALENCE_STYLE.streak.colorVar}) 60%, transparent), transparent)`,
                    }}
                  />
                ) : null}
              </div>
            </motion.div>
          );
        }),
      )}
    </div>
  );
}

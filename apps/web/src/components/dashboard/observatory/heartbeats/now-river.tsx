'use client';
import { motion } from 'framer-motion';
import type { StreamItem } from '@/lib/dashboard/types';
import { StreamObject } from '../stream-object';
import { humanTimeSince } from '@/lib/dashboard/valence';
import { EmptyHeartbeat } from './empty-heartbeat';

/**
 * NowRiver — horizontal timeline. Older on the left, "now" on the right.
 * Items float on alternating banks of an animated current; an SVG wave
 * gently drifts when motionMode === 'alive'.
 */
export default function NowRiver({
  streams,
  motionMode,
  staleAfterDays,
}: {
  streams: StreamItem[];
  motionMode: 'calm' | 'alive';
  staleAfterDays: number;
}) {
  const sorted = [...streams].sort(
    (a, b) => new Date(a.anchorAt).getTime() - new Date(b.anchorAt).getTime(),
  );
  if (streams.length === 0) {
    return (
      <EmptyHeartbeat
        glyph="∿"
        title="The river is calm."
        hint="Nothing has flowed by today. Drop a capture and the current will start."
      />
    );
  }

  const total = sorted.length;
  const oldest = new Date(sorted[0]!.anchorAt).getTime();
  const newest = new Date(sorted[total - 1]!.anchorAt).getTime();
  const span = Math.max(1, newest - oldest);

  return (
    <div className="bg-[var(--color-night-deep)]/50 relative aspect-[21/9] w-full overflow-hidden rounded-2xl border border-[var(--color-border)]">
      <svg
        aria-hidden
        viewBox="0 0 100 30"
        preserveAspectRatio="none"
        className="absolute inset-x-0 top-1/2 h-12 w-full -translate-y-1/2"
      >
        <defs>
          <linearGradient id="river-grad" x1="0" x2="1">
            <stop offset="0%" stopColor="color-mix(in oklch, var(--color-mist) 25%, transparent)" />
            <stop
              offset="100%"
              stopColor="color-mix(in oklch, var(--color-pulse) 80%, transparent)"
            />
          </linearGradient>
        </defs>
        <motion.path
          d="M0,15 Q12,9 25,15 T50,15 T75,15 T100,15"
          fill="none"
          stroke="url(#river-grad)"
          strokeWidth={0.6}
          strokeLinecap="round"
          animate={
            motionMode === 'alive'
              ? {
                  d: [
                    'M0,15 Q12,9 25,15 T50,15 T75,15 T100,15',
                    'M0,15 Q12,21 25,15 T50,15 T75,15 T100,15',
                    'M0,15 Q12,9 25,15 T50,15 T75,15 T100,15',
                  ],
                }
              : undefined
          }
          transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.path
          d="M0,15 Q12,12 25,15 T50,15 T75,15 T100,15"
          fill="none"
          stroke="color-mix(in oklch, var(--color-rim-cyan) 35%, transparent)"
          strokeWidth={0.3}
          animate={
            motionMode === 'alive'
              ? {
                  d: [
                    'M0,15 Q12,12 25,15 T50,15 T75,15 T100,15',
                    'M0,15 Q12,18 25,15 T50,15 T75,15 T100,15',
                    'M0,15 Q12,12 25,15 T50,15 T75,15 T100,15',
                  ],
                }
              : undefined
          }
          transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut', delay: 0.7 }}
        />
      </svg>

      {/* "now" anchor on the right */}
      <div
        aria-hidden
        className="absolute bottom-2 right-3 top-2 w-px"
        style={{
          background:
            'linear-gradient(180deg, transparent, color-mix(in oklch, var(--color-pulse) 60%, transparent), transparent)',
        }}
      />
      <div className="absolute right-3 top-1.5 -translate-x-1/2 text-[10px] uppercase tracking-wider text-[var(--color-mist)]">
        now
      </div>

      <div className="absolute inset-0 px-8">
        {sorted.map((item, i) => {
          const t = (new Date(item.anchorAt).getTime() - oldest) / span;
          const left = 6 + t * 84;
          const top = i % 2 === 0 ? '36%' : '60%';
          return (
            <motion.div
              key={item.id}
              className="absolute flex flex-col items-center gap-1"
              style={{ left: `${left}%`, top }}
              animate={motionMode === 'alive' ? { y: [0, i % 2 === 0 ? -3 : 3, 0] } : { y: 0 }}
              transition={{
                duration: 4 + (i % 3),
                repeat: motionMode === 'alive' ? Infinity : 0,
                ease: 'easeInOut',
              }}
            >
              <StreamObject
                item={item}
                animated={motionMode === 'alive'}
                staleAfterDays={staleAfterDays}
                size={22}
              />
              <span className="text-[10px] text-[var(--color-fg-subtle)]">
                {humanTimeSince(item.anchorAt)}
              </span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

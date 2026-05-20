'use client';
import type { StreamItem } from '@/lib/dashboard/types';
import {
  VALENCE_STYLE,
  humanTimeSince,
  intensityFor,
  verboseTimeSince,
} from '@/lib/dashboard/valence';
import Link from 'next/link';
import { EmptyHeartbeat } from './empty-heartbeat';

/**
 * CardStack — calm, scannable, no-motion view (still grouped by valence).
 * Each column gets a leading accent bar and per-group emptiness hints,
 * intensity drives row brightness, and rows show a thin underline whose
 * width tracks intensity (a passive heat-bar).
 */
export default function CardStack({
  streams,
  staleAfterDays,
}: {
  streams: StreamItem[];
  motionMode: 'calm' | 'alive';
  staleAfterDays: number;
}) {
  if (streams.length === 0) {
    return (
      <EmptyHeartbeat
        glyph="☰"
        title="Empty stack."
        hint="As streams arrive, they’ll group themselves here by feel — streaks, pulses, drifts."
      />
    );
  }
  const groups: Array<{
    key: 'streak' | 'pulse' | 'drift';
    label: string;
    empty: string;
    items: StreamItem[];
  }> = [
    {
      key: 'streak',
      label: 'streaks (longer = stronger)',
      empty: 'Nothing standing yet — streaks form as patterns repeat.',
      items: streams.filter((s) => s.valence === 'streak'),
    },
    {
      key: 'pulse',
      label: 'recent pulses',
      empty: 'Quiet for now. Captures and check-ins land here first.',
      items: streams.filter((s) => s.valence === 'pulse'),
    },
    {
      key: 'drift',
      label: 'drifting (gentle reminders)',
      empty: 'Nothing has drifted out of view. Good.',
      items: streams.filter((s) => s.valence === 'drift'),
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {groups.map((g) => {
        const colorVar = VALENCE_STYLE[g.key].colorVar;
        return (
          <div
            key={g.key}
            className="bg-[var(--color-night-elev)]/40 relative overflow-hidden rounded-2xl border border-[var(--color-border)] p-4 backdrop-blur-sm"
          >
            <span
              aria-hidden
              className="absolute left-0 top-0 h-full w-0.5"
              style={{
                background: `linear-gradient(180deg, transparent, color-mix(in oklch, var(${colorVar}) 70%, transparent), transparent)`,
              }}
            />
            <div className="mb-3 flex items-baseline justify-between">
              <h3
                className="text-xs uppercase tracking-wider"
                style={{ color: `var(${colorVar})` }}
              >
                {g.label}
              </h3>
              <span className="font-mono text-[10px] text-[var(--color-fg-subtle)]">
                {g.items.length}
              </span>
            </div>
            <ul className="space-y-1.5">
              {g.items.length === 0 && (
                <li className="text-xs text-[var(--color-fg-subtle)]">{g.empty}</li>
              )}
              {g.items.map((item) => {
                const inten = intensityFor(item, staleAfterDays);
                const Row = (
                  <div
                    className="group relative flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-[var(--color-bg-elevated)]"
                    style={{ opacity: 0.55 + inten * 0.45 }}
                    title={verboseTimeSince(item.anchorAt)}
                  >
                    <span className="truncate text-[var(--color-fg)]">{item.label}</span>
                    <span className="shrink-0 font-mono text-xs text-[var(--color-mist)] group-hover:text-[var(--color-fg)]">
                      {humanTimeSince(item.anchorAt)}
                    </span>
                    <span
                      aria-hidden
                      className="absolute bottom-0 left-2 h-px"
                      style={{
                        width: `${20 + inten * 70}%`,
                        background: `color-mix(in oklch, var(${colorVar}) 50%, transparent)`,
                      }}
                    />
                  </div>
                );
                return (
                  <li key={item.id}>
                    {item.href ? (
                      <Link href={item.href} prefetch={false}>
                        {Row}
                      </Link>
                    ) : (
                      Row
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

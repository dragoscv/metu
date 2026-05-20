'use client';
/**
 * StreamObject — single light-object on the heartbeat canvas.
 *
 * Shape switches by valence (color is never the only signal, per a11y):
 *   - streak: upward-pointing leaf  (jade)
 *   - pulse:  filled circle          (magenta)
 *   - drift:  flame teardrop         (amber)
 *
 * Brightness modulates with `intensity` (0..1).
 * Hover reveals a tooltip with `humanTimeSince` + the verbose timestamp.
 * Optional href turns the whole svg into a link.
 */
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { type StreamItem } from '@/lib/dashboard/types';
import {
  VALENCE_STYLE,
  humanTimeSince,
  intensityFor,
  verboseTimeSince,
} from '@/lib/dashboard/valence';

export interface StreamObjectProps {
  item: StreamItem;
  /** Diameter in px (final visual size scales with intensity). */
  size?: number;
  /** Whether to apply the slow ambient animation (alive mode). */
  animated?: boolean;
  /** When provided, overrides intensityFor (used by skins for choreography). */
  intensity?: number;
  staleAfterDays?: number;
  /** Optional class for positioning context (eg. absolute on a constellation). */
  className?: string;
  style?: CSSProperties;
}

function ShapePath({ shape, color }: { shape: 'circle' | 'leaf' | 'flame'; color: string }) {
  if (shape === 'circle') {
    return <circle cx={12} cy={12} r={9} fill={color} />;
  }
  if (shape === 'leaf') {
    return <path d="M12 2 C16 7, 20 11, 12 22 C4 11, 8 7, 12 2 Z" fill={color} />;
  }
  // flame
  return (
    <path
      d="M12 22 C5 18, 5 13, 9 9 C9 12, 11 11, 11 7 C13 9, 17 12, 17 16 C17 20, 14 22, 12 22 Z"
      fill={color}
    />
  );
}

export function StreamObject({
  item,
  size = 28,
  animated = false,
  intensity,
  staleAfterDays = 60,
  className,
  style,
}: StreamObjectProps) {
  const style$ = VALENCE_STYLE[item.valence];
  const lvl = intensity ?? intensityFor(item, staleAfterDays);
  const color = item.accent ?? `var(${style$.colorVar})`;
  const finalSize = Math.round(size * (0.7 + lvl * 0.6));
  const opacity = 0.4 + lvl * 0.6;

  const animName =
    item.valence === 'streak'
      ? 'metu-streak-rise'
      : item.valence === 'drift'
        ? 'metu-drift-orbit'
        : 'metu-breathe';
  const animDuration = item.valence === 'streak' ? '6s' : item.valence === 'drift' ? '9s' : '4s';

  const tooltip = `${item.label}${item.sublabel ? ` · ${item.sublabel}` : ''} · ${verboseTimeSince(item.anchorAt)}`;

  const inner = (
    <span
      role="img"
      aria-label={`${item.label}, ${style$.aria}, ${humanTimeSince(item.anchorAt)} ago`}
      title={tooltip}
      className={[
        'group relative inline-flex items-center justify-center transition-transform duration-300 ease-out hover:scale-110',
        className ?? '',
      ].join(' ')}
      style={{
        width: finalSize,
        height: finalSize,
        filter: `drop-shadow(var(${style$.shadowVar}))`,
        ...style,
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width={finalSize}
        height={finalSize}
        style={{
          opacity,
          animation: animated ? `${animName} ${animDuration} ease-in-out infinite` : undefined,
          color,
        }}
      >
        <ShapePath shape={style$.shape} color={color} />
      </svg>
      <span
        className="bg-[var(--color-bg-overlay)]/95 pointer-events-none absolute left-1/2 top-full z-10 mt-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-fg)] opacity-0 shadow-lg backdrop-blur-md transition-opacity duration-200 group-hover:opacity-100"
        role="tooltip"
      >
        <span className="text-[var(--color-fg)]">{item.label}</span>
        {item.sublabel && <span className="text-[var(--color-fg-subtle)]"> · {item.sublabel}</span>}
        <span className="ml-2 text-[var(--color-mist)]">{humanTimeSince(item.anchorAt)}</span>
      </span>
    </span>
  );

  if (item.href) {
    return (
      <Link href={item.href} aria-label={`${item.label}, open`} prefetch={false}>
        {inner}
      </Link>
    );
  }
  return inner;
}

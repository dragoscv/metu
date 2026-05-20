'use client';
/**
 * Atmosphere — non-interactive ambient background for the observatory.
 *
 * Layered SVG nebula + a slow-drifting twinkle field. CSS-only (no canvas)
 * so it's cheap, accessible, and SSR-safe. Disabled when:
 *   - prefers-reduced-motion: reduce
 *   - user prefs.motionMode === 'calm' (still renders nebula, just not the twinkles)
 */
import { useEffect, useMemo, useState } from 'react';
import type { MotionMode } from '@/lib/dashboard/types';

export interface AtmosphereProps {
  motionMode: MotionMode;
  /** Number of twinkle particles. Capped at 80 for perf. */
  density?: number;
}

export function Atmosphere({ motionMode, density = 60 }: AtmosphereProps) {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const showTwinkles = !reducedMotion && motionMode === 'alive';
  const N = Math.min(80, Math.max(0, density));

  // Stable random positions (deterministic per mount).
  const particles = useMemo(
    () =>
      Array.from({ length: N }, (_, i) => {
        const seed = (i * 9301 + 49297) % 233280;
        const r = seed / 233280;
        const r2 = ((seed * 7) % 233280) / 233280;
        const r3 = ((seed * 13) % 233280) / 233280;
        return {
          x: r * 100,
          y: r2 * 100,
          size: 0.6 + r3 * 1.6,
          delay: r * 8,
          duration: 4 + r2 * 6,
        };
      }),
    [N],
  );

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{
        background:
          'radial-gradient(ellipse 80% 60% at 20% 0%, color-mix(in oklch, var(--color-pulse) 18%, transparent), transparent 60%),' +
          'radial-gradient(ellipse 70% 60% at 100% 100%, color-mix(in oklch, var(--color-rim-cyan) 14%, transparent), transparent 65%),' +
          'radial-gradient(ellipse 50% 50% at 50% 50%, color-mix(in oklch, var(--color-streak-jade) 8%, transparent), transparent 70%),' +
          'var(--color-night-deep)',
      }}
    >
      {showTwinkles && (
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {particles.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={p.size / 8}
              fill="var(--color-ivory)"
              style={{
                opacity: 0.35,
                animation: `metu-twinkle ${p.duration}s ease-in-out ${p.delay}s infinite`,
              }}
            />
          ))}
        </svg>
      )}
    </div>
  );
}

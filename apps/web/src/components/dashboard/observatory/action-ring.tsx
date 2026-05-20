'use client';
/**
 * ActionRing — long-press radial menu.
 *
 * Press-and-hold anywhere on the observatory for ~450 ms to open an 8-spoke
 * radial of quick actions at the press location. Release on a spoke to fire
 * its action; release outside or press Esc to dismiss.
 *
 * Touch + mouse + keyboard. Honors prefers-reduced-motion (motionMode='calm'
 * skips the open-tween).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bookmark, Brain, CheckSquare, Mic, Plus, Search, Settings, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { createCapture } from '@/app/actions/capture';
import { kickConductorAction } from '@/app/actions/metu';

type Spoke = {
  id: string;
  label: string;
  Icon: typeof Plus;
  hint?: string;
  run: (ctx: { router: ReturnType<typeof useRouter> }) => Promise<void> | void;
};

const SPOKES: Spoke[] = [
  {
    id: 'capture',
    label: 'Capture',
    Icon: Plus,
    hint: 'quick text note',
    run: async () => {
      const text = window.prompt('Quick capture');
      if (text && text.trim()) {
        await createCapture({ kind: 'text', content: text.trim(), source: 'web', metadata: {} });
      }
    },
  },
  {
    id: 'task',
    label: 'New task',
    Icon: CheckSquare,
    run: ({ router }) => router.push('/tasks/new'),
  },
  {
    id: 'goal',
    label: 'New goal',
    Icon: Bookmark,
    run: ({ router }) => router.push('/goals/new'),
  },
  {
    id: 'voice',
    label: 'Voice',
    Icon: Mic,
    hint: 'open voice rail',
    run: ({ router }) => router.push('/voice'),
  },
  {
    id: 'wake',
    label: 'Wake conductor',
    Icon: Brain,
    run: async () => {
      await kickConductorAction();
    },
  },
  {
    id: 'search',
    label: 'Search',
    Icon: Search,
    run: ({ router }) => router.push('/search'),
  },
  {
    id: 'settings',
    label: 'Dashboard prefs',
    Icon: Settings,
    run: ({ router }) => router.push('/settings/dashboard'),
  },
  {
    id: 'archive',
    label: 'Dismiss',
    Icon: Trash2,
    hint: 'close ring',
    run: () => {},
  },
];

const HOLD_MS = 380;
const RADIUS = 96;

export function ActionRing({ motionMode }: { motionMode: 'calm' | 'alive' }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [center, setCenter] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const holdTimer = useRef<number | null>(null);
  const armedAt = useRef<{ x: number; y: number } | null>(null);

  const cancelHold = useCallback(() => {
    if (holdTimer.current != null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    armedAt.current = null;
  }, []);

  // Global pointer listeners — armed on dashboard area, opens anywhere.
  useEffect(() => {
    function onDown(e: PointerEvent) {
      if (open) return;
      // Ignore presses that originate on interactive controls.
      const target = e.target as HTMLElement | null;
      if (
        target?.closest('button, a, input, textarea, [role="button"], [contenteditable="true"]')
      ) {
        return;
      }
      // Only inside the observatory section.
      if (!target?.closest('[aria-label="dashboard observatory"]')) return;
      armedAt.current = { x: e.clientX, y: e.clientY };
      holdTimer.current = window.setTimeout(() => {
        setCenter({ x: e.clientX, y: e.clientY });
        setOpen(true);
        // Light haptic on supported devices.
        if ('vibrate' in navigator) navigator.vibrate?.(8);
      }, HOLD_MS);
    }
    function onMove(e: PointerEvent) {
      if (!armedAt.current) return;
      const dx = e.clientX - armedAt.current.x;
      const dy = e.clientY - armedAt.current.y;
      if (dx * dx + dy * dy > 49) cancelHold(); // 7px tolerance
    }
    function onUp() {
      cancelHold();
    }
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
    };
  }, [open, cancelHold]);

  // Esc closes; Space/Enter on a spoke fires it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setHover(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const fire = useCallback(
    async (id: string) => {
      const spoke = SPOKES.find((s) => s.id === id);
      setOpen(false);
      setHover(null);
      if (!spoke) return;
      try {
        await spoke.run({ router });
      } catch {
        /* swallow — user-initiated quick action */
      }
    },
    [router],
  );

  if (!open || !center) return null;

  const animProps =
    motionMode === 'alive'
      ? {
          initial: { scale: 0.85, opacity: 0 },
          animate: { scale: 1, opacity: 1 },
          exit: { scale: 0.9, opacity: 0 },
        }
      : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } };

  return (
    <AnimatePresence>
      <motion.div
        key="action-ring"
        className="fixed inset-0 z-[60]"
        onClick={() => {
          setOpen(false);
          setHover(null);
        }}
        {...animProps}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        role="dialog"
        aria-label="quick action ring"
      >
        {/* Scrim */}
        <div className="bg-[var(--color-night-deep)]/40 absolute inset-0 backdrop-blur-sm" />

        <div
          className="absolute"
          style={{
            left: center.x,
            top: center.y,
            width: 0,
            height: 0,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Center hub */}
          <div
            aria-hidden
            className="border-[var(--color-rim-cyan)]/40 pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border"
            style={{
              width: 28,
              height: 28,
              boxShadow: 'var(--shadow-glow-pulse)',
            }}
          />

          {SPOKES.map((spoke, i) => {
            const angle = (i / SPOKES.length) * Math.PI * 2 - Math.PI / 2;
            const x = Math.cos(angle) * RADIUS;
            const y = Math.sin(angle) * RADIUS;
            const isHover = hover === spoke.id;
            return (
              <button
                key={spoke.id}
                type="button"
                onPointerEnter={() => setHover(spoke.id)}
                onPointerLeave={() => setHover((h) => (h === spoke.id ? null : h))}
                onClick={() => fire(spoke.id)}
                className="absolute flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border text-[10px] uppercase tracking-wider transition-colors"
                style={{
                  left: x,
                  top: y,
                  borderColor: isHover ? 'var(--color-pulse)' : 'var(--color-border)',
                  background: isHover
                    ? 'color-mix(in oklch, var(--color-pulse) 22%, var(--color-night-elev))'
                    : 'color-mix(in oklch, var(--color-night-elev) 70%, transparent)',
                  color: isHover ? 'var(--color-fg)' : 'var(--color-fg-muted)',
                  backdropFilter: 'blur(8px)',
                  boxShadow: isHover ? 'var(--shadow-glow-pulse)' : undefined,
                }}
              >
                <spoke.Icon className="mb-0.5 h-4 w-4" />
                <span className="text-[9px] leading-none">{spoke.label.split(' ')[0]}</span>
              </button>
            );
          })}

          {/* Hover label below ring */}
          <div
            className="pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-center text-xs text-[var(--color-fg-muted)]"
            style={{ top: RADIUS + 36 }}
          >
            {hover ? (
              <>
                <div className="text-[var(--color-fg)]">
                  {SPOKES.find((s) => s.id === hover)?.label}
                </div>
                {SPOKES.find((s) => s.id === hover)?.hint && (
                  <div className="text-[10px] text-[var(--color-fg-subtle)]">
                    {SPOKES.find((s) => s.id === hover)?.hint}
                  </div>
                )}
              </>
            ) : (
              <span className="text-[10px] italic text-[var(--color-fg-subtle)]">
                release on a spoke — esc to dismiss
              </span>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

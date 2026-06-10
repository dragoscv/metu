/**
 * usePetBrain — the desktop pet's behavior engine. Runs *inside* the pet
 * window so it can move its own window via `getCurrentWindow().setPosition`
 * without cross-window plumbing.
 *
 * State machine:
 *   idle   → resting in place
 *   wander → drifting to a random peripheral point on some monitor
 *   perch  → settling next to the user's active (foreground) window
 *   point  → walking toward a target then signalling the overlay to highlight
 *   follow → trailing the cursor (used briefly during interactions)
 *
 * Movement is frame-stepped toward a target at the personality's moveSpeed.
 * Targeting decisions are made on a personality-tuned cadence and react to:
 *   - foreground window changes (perch / window-react message)
 *   - idle/away time (nudge)
 *   - explicit `point at` requests (from hub conductor events)
 *
 * Per-pixel hit-testing is also driven here: we poll the global cursor and
 * compare it to the pet's opaque region (a centered circle approximating the
 * character body) to toggle click-through, because Tauri's
 * `set_ignore_cursor_events` is all-or-nothing.
 */
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow, PhysicalPosition } from '@tauri-apps/api/window';
import {
  clampToMonitors,
  getCursor,
  getForeground,
  getMonitors,
  randomWanderTarget,
  type ForegroundWindow,
  type MonitorInfo,
  type Point,
} from './spatial';
import { PERSONALITIES, type PersonalityId } from '../avatar/personality';

export type PetMode = 'idle' | 'wander' | 'perch' | 'point' | 'follow';

export interface PointRequest {
  /** Target rect to highlight (physical px). */
  rect: { x: number; y: number; w: number; h: number };
  label?: string;
}

export interface PetBrainState {
  mode: PetMode;
  /** True when the cursor is over the opaque character region. */
  hovering: boolean;
}

interface Options {
  personality: PersonalityId;
  /** Pet window size in physical px (after scale). */
  petWidth: number;
  petHeight: number;
  /** Disable autonomous motion (e.g. while the user is dragging or talking). */
  paused?: boolean;
  /** Fired when the brain decides to surface an ambient remark. */
  onRemark?: (kind: 'greeting' | 'idleNudge' | 'windowReact') => void;
  /** Fired with the overlay highlight rect when entering `point` mode. */
  onPoint?: (req: PointRequest | null) => void;
}

const FRAME_MS = 33; // ~30fps stepping
const HOVER_POLL_MS = 80;

export function usePetBrain(opts: Options): PetBrainState {
  const { personality, petWidth, petHeight, paused, onRemark, onPoint } = opts;
  const [mode, setMode] = useState<PetMode>('idle');
  const [hovering, setHovering] = useState(false);

  // Mutable refs so the long-lived timers always see fresh values without
  // re-subscribing every render.
  const cfgRef = useRef(PERSONALITIES[personality]);
  const pausedRef = useRef(!!paused);
  const monitorsRef = useRef<MonitorInfo[]>([]);
  const targetRef = useRef<Point | null>(null);
  const posRef = useRef<Point>({ x: 0, y: 0 });
  const lastForegroundRef = useRef<string | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const pointReqRef = useRef<PointRequest | null>(null);

  useEffect(() => {
    cfgRef.current = PERSONALITIES[personality];
  }, [personality]);
  useEffect(() => {
    pausedRef.current = !!paused;
  }, [paused]);

  // Allow external (hub) point requests via a window event.
  useEffect(() => {
    const handler = (e: Event) => {
      const req = (e as CustomEvent<PointRequest>).detail;
      if (req?.rect) {
        pointReqRef.current = req;
        setMode('point');
      }
    };
    window.addEventListener('metu:pet-point', handler);
    return () => window.removeEventListener('metu:pet-point', handler);
  }, []);

  // Seed current position from the actual window + load monitor layout.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [mons, pos] = await Promise.all([
        getMonitors(),
        getCurrentWindow()
          .outerPosition()
          .catch(() => null),
      ]);
      if (!alive) return;
      monitorsRef.current = mons;
      if (pos) posRef.current = { x: pos.x, y: pos.y };
    })();
    const monTimer = setInterval(() => {
      void getMonitors().then((m) => {
        if (m.length) monitorsRef.current = m;
      });
    }, 30_000);
    return () => {
      alive = false;
      clearInterval(monTimer);
    };
  }, []);

  // ── Decision loop: pick a target on a personality cadence ────────────────
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const decide = async () => {
      if (cancelled) return;
      const cfg = cfgRef.current;
      if (!pausedRef.current) {
        // Active point request wins.
        if (pointReqRef.current) {
          const r = pointReqRef.current.rect;
          // Park beside the target's top-right corner.
          targetRef.current = clampToMonitors(
            r.x + r.w + 8,
            r.y,
            petWidth,
            petHeight,
            monitorsRef.current,
          );
          setMode('point');
          onPoint?.(pointReqRef.current);
        } else {
          const fg = await getForeground().catch(() => null);
          reactToForeground(fg, cfg.perchBias);
          const roll = Math.random();
          if (fg && roll < cfg.perchBias) {
            // Perch beside the active window.
            targetRef.current = clampToMonitors(
              fg.x + fg.w - petWidth - 8,
              Math.max(fg.y - petHeight + 24, 0),
              petWidth,
              petHeight,
              monitorsRef.current,
            );
            setMode('perch');
          } else {
            targetRef.current = randomWanderTarget(petWidth, petHeight, monitorsRef.current);
            setMode('wander');
          }
        }
      }
      // Schedule next decision with jitter.
      const base = cfgRef.current.wanderIntervalMs;
      const next = base * (0.5 + Math.random());
      timer = setTimeout(decide, next);
    };

    const reactToForeground = (fg: ForegroundWindow | null, _bias: number) => {
      const id = fg?.id ?? null;
      if (id && id !== lastForegroundRef.current) {
        lastForegroundRef.current = id;
        lastActivityRef.current = Date.now();
        if (Math.random() < cfgRef.current.chattiness) onRemark?.('windowReact');
      }
    };

    timer = setTimeout(decide, 2_000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [petWidth, petHeight]);

  // ── Idle nudge loop ──────────────────────────────────────────────────────
  useEffect(() => {
    const timer = setInterval(() => {
      const cfg = cfgRef.current;
      if (cfg.idleNudgeMs <= 0 || pausedRef.current) return;
      if (Date.now() - lastActivityRef.current >= cfg.idleNudgeMs) {
        lastActivityRef.current = Date.now();
        onRemark?.('idleNudge');
      }
    }, 30_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Movement stepping ────────────────────────────────────────────────────
  useEffect(() => {
    const w = getCurrentWindow();
    const timer = setInterval(() => {
      // While paused (user dragging or conversing), the user — not the brain —
      // owns the window position. Keep posRef in sync with reality and drop any
      // pending target so we never snap the pet back after a manual move.
      if (pausedRef.current) {
        targetRef.current = null;
        void w
          .outerPosition()
          .then((p) => {
            posRef.current = { x: p.x, y: p.y };
          })
          .catch(() => {});
        return;
      }
      const target = targetRef.current;
      if (!target) return;
      const cur = posRef.current;
      const dx = target.x - cur.x;
      const dy = target.y - cur.y;
      const dist = Math.hypot(dx, dy);
      const speed = cfgRef.current.moveSpeed;
      if (dist <= speed) {
        posRef.current = { ...target };
        targetRef.current = null;
        void w.setPosition(new PhysicalPosition(target.x, target.y)).catch(() => {});
        // Arrived: if this was a point, fire the overlay highlight now.
        if (pointReqRef.current) {
          onPoint?.(pointReqRef.current);
          pointReqRef.current = null;
          setMode('idle');
        }
        return;
      }
      const nx = Math.round(cur.x + (dx / dist) * speed);
      const ny = Math.round(cur.y + (dy / dist) * speed);
      posRef.current = { x: nx, y: ny };
      void w.setPosition(new PhysicalPosition(nx, ny)).catch(() => {});
    }, FRAME_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Per-pixel hit-testing via cursor polling ─────────────────────────────
  useEffect(() => {
    let last = false;
    const timer = setInterval(() => {
      void (async () => {
        const cur = await getCursor();
        if (!cur) return;
        const pos = posRef.current;
        // Opaque region ≈ centered circle covering the character body.
        const cx = pos.x + petWidth / 2;
        const cy = pos.y + petHeight / 2;
        const r = Math.min(petWidth, petHeight) * 0.42;
        const inside = (cur.x - cx) ** 2 + (cur.y - cy) ** 2 <= r * r;
        if (inside !== last) {
          last = inside;
          setHovering(inside);
          // Click-through ENABLED when NOT hovering the body.
          void invoke('presence_pet_set_clickthrough', { enabled: !inside }).catch(() => {});
          if (inside) lastActivityRef.current = Date.now();
        }
      })();
    }, HOVER_POLL_MS);
    return () => clearInterval(timer);
  }, [petWidth, petHeight]);

  return { mode, hovering };
}

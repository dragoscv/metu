/**
 * useAssistantBrain — the desktop assistant's behavior engine. Runs *inside*
 * the assistant window so it can move its own window via
 * `getCurrentWindow().setPosition` without cross-window plumbing.
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
 * ── Click-through model (and the drag fix) ─────────────────────────────────
 * Tauri's `set_ignore_cursor_events` is all-or-nothing for the window, so we
 * approximate per-pixel hit-testing. The OLD implementation polled the global
 * cursor against a circle and toggled click-through from that poll — which
 * raced with `data-tauri-drag-region`: mid-press the poll could flip
 * click-through ON and the OS drag died. The new contract:
 *
 *   1. `interactive` (cursor over body/bubble/chat) is reported by the DOM
 *      via `setInteractive()` — exact, no geometry guess.
 *   2. While `interactionLocked` (dragging OR chat open OR bubble shown),
 *      click-through is FORCED OFF and the poll may not touch it.
 *   3. The cursor poll's only job is re-ENABLING interactivity: when the
 *      window is click-through, DOM events can't fire, so the poll detects
 *      the cursor entering the window bounds and turns click-through off so
 *      the DOM can take over again.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow, PhysicalPosition } from '@tauri-apps/api/window';
import { isTauri } from '../state/runtime';
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

export type AssistantMode = 'idle' | 'wander' | 'perch' | 'point' | 'follow';

export interface PointRequest {
  /** Target rect to highlight (physical px). */
  rect: { x: number; y: number; w: number; h: number };
  label?: string;
}

export interface AssistantBrainState {
  mode: AssistantMode;
  /** True when the cursor is over an interactive region (body/bubble/chat). */
  hovering: boolean;
  /** Report DOM hover over interactive elements (exact hit-testing). */
  setInteractive: (on: boolean) => void;
}

interface Options {
  personality: PersonalityId;
  /** Assistant window size in physical px (after scale). */
  width: number;
  height: number;
  /** Disable autonomous motion (e.g. while the user is dragging or talking). */
  paused?: boolean;
  /**
   * Hard-lock interaction: click-through stays OFF no matter what (dragging,
   * chat panel open, action bubble visible). Movement is also paused.
   */
  interactionLocked?: boolean;
  /** Fired when the brain decides to surface an ambient remark. */
  onRemark?: (kind: 'greeting' | 'idleNudge' | 'windowReact') => void;
  /** Fired with the overlay highlight rect when entering `point` mode. */
  onPoint?: (req: PointRequest | null) => void;
}

const FRAME_MS = 33; // ~30fps stepping
const HOVER_POLL_MS = 120;

// Module-scope so applyClickthrough can be shared without re-creation.
let clickthroughState = false;
function applyClickthrough(enabled: boolean) {
  if (clickthroughState === enabled) return;
  clickthroughState = enabled;
  void invoke('presence_assistant_set_clickthrough', { enabled }).catch(() => {});
}

export function useAssistantBrain(opts: Options): AssistantBrainState {
  const { personality, width, height, paused, interactionLocked, onRemark, onPoint } = opts;
  const [mode, setMode] = useState<AssistantMode>('idle');
  const [hovering, setHovering] = useState(false);

  // Mutable refs so the long-lived timers always see fresh values without
  // re-subscribing every render.
  const cfgRef = useRef(PERSONALITIES[personality]);
  const pausedRef = useRef(!!paused);
  const lockedRef = useRef(!!interactionLocked);
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
  useEffect(() => {
    lockedRef.current = !!interactionLocked;
    // Entering a locked state must immediately guarantee interactivity.
    if (interactionLocked) applyClickthrough(false);
  }, [interactionLocked]);

  const setInteractive = useCallback((on: boolean) => {
    setHovering(on);
    if (on) {
      lastActivityRef.current = Date.now();
      applyClickthrough(false);
    } else if (!lockedRef.current) {
      // Cursor left all interactive zones and nothing locks interaction —
      // let clicks pass through the transparent margin again.
      applyClickthrough(true);
    }
  }, []);

  // Allow external (hub) point requests via a window event.
  useEffect(() => {
    const handler = (e: Event) => {
      const req = (e as CustomEvent<PointRequest>).detail;
      if (req?.rect) {
        pointReqRef.current = req;
        setMode('point');
      }
    };
    window.addEventListener('metu:assistant-point', handler);
    return () => window.removeEventListener('metu:assistant-point', handler);
  }, []);

  // Seed current position from the actual window + load monitor layout.
  useEffect(() => {
    if (!isTauri()) return;
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
      if (!pausedRef.current && !lockedRef.current) {
        // Active point request wins.
        if (pointReqRef.current) {
          const r = pointReqRef.current.rect;
          // Park beside the target's top-right corner.
          targetRef.current = clampToMonitors(
            r.x + r.w + 8,
            r.y,
            width,
            height,
            monitorsRef.current,
          );
          setMode('point');
          onPoint?.(pointReqRef.current);
        } else {
          const fg = await getForeground().catch(() => null);
          reactToForeground(fg);
          const roll = Math.random();
          if (fg && roll < cfg.perchBias) {
            // Perch beside the active window.
            targetRef.current = clampToMonitors(
              fg.x + fg.w - width - 8,
              Math.max(fg.y - height + 24, 0),
              width,
              height,
              monitorsRef.current,
            );
            setMode('perch');
          } else {
            targetRef.current = randomWanderTarget(width, height, monitorsRef.current);
            setMode('wander');
          }
        }
      }
      // Schedule next decision with jitter.
      const base = cfgRef.current.wanderIntervalMs;
      const next = base * (0.5 + Math.random());
      timer = setTimeout(decide, next);
    };

    const reactToForeground = (fg: ForegroundWindow | null) => {
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
  }, [width, height]);

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
    if (!isTauri()) return;
    const w = getCurrentWindow();
    const timer = setInterval(() => {
      // While paused/locked (user dragging, chatting, or conversing), the user
      // — not the brain — owns the window position. Keep posRef in sync with
      // reality and drop any pending target so we never snap back after a
      // manual move.
      if (pausedRef.current || lockedRef.current) {
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

  // ── Re-entry poll: wake the window from click-through ───────────────────
  // When click-through is ON the DOM gets no events, so we poll the global
  // cursor against the window bounds and flip click-through OFF as soon as
  // the cursor enters. The DOM then owns the exact hit-testing (see
  // setInteractive) and will re-enable click-through on leave.
  useEffect(() => {
    if (!isTauri()) return;
    const timer = setInterval(() => {
      if (!clickthroughState) return; // DOM owns it right now
      void (async () => {
        const cur = await getCursor();
        if (!cur) return;
        const pos = posRef.current;
        const inside =
          cur.x >= pos.x && cur.x <= pos.x + width && cur.y >= pos.y && cur.y <= pos.y + height;
        if (inside) applyClickthrough(false);
      })();
    }, HOVER_POLL_MS);
    return () => clearInterval(timer);
  }, [width, height]);

  return { mode, hovering, setInteractive };
}

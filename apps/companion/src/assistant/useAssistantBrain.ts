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
 * approximate per-pixel hit-testing. v3 contract (native autopilot):
 *
 *   1. A Rust thread (`start_assistant_input_watcher`) is the ONLY writer of
 *      `set_ignore_cursor_events`. Every 50ms it reads the real cursor and
 *      the real window rect and decides — no IPC races, no stale JS caches,
 *      works even while the window is click-through (no DOM events needed).
 *   2. JS reports a single bit: the interactive LOCK (chat open ∨ dragging ∨
 *      pointer over body/bubble/menu) via
 *      `presence_assistant_set_interactive_lock`. While locked the watcher
 *      keeps the window interactive unconditionally.
 *   3. The lock is re-reported every ~1s so process restarts / HMR resets
 *      self-heal.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow, PhysicalPosition } from '@tauri-apps/api/window';
import { isTauri } from '../state/runtime';
import {
  clampToMonitors,
  getForeground,
  getMonitors,
  type ForegroundWindow,
  type MonitorInfo,
  type Point,
} from './spatial';
import { PERSONALITIES, type PersonalityId } from '../avatar/personality';
import { getActivityState } from './activityModel';
import { screenWorld } from './screenWorld';
import {
  cancelNav,
  createBody,
  DEFAULT_PHYSICS,
  FOOT_OFFSET,
  navigateTo,
  step,
  type LocomotionState,
  type PhysicsConfig,
} from './avatarPhysics';

/**
 * Director states (Jarvis Slice C — purposeful presence):
 *   docked   → resting at the home corner of the active monitor
 *   approach → moving beside the active window because it has something to say
 *   point    → walking toward a target then signalling the overlay highlight
 *   retreat  → user is in deep focus; tucked into the corner, small + quiet
 * 'idle' is retained as the initial/none state. Movement happens ONLY on a
 * director intent — never randomly.
 */
export type AssistantMode = 'idle' | 'docked' | 'approach' | 'point' | 'retreat';

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
  /** Avatar-world v1: physical locomotion state for the renderer. */
  locomotion: LocomotionState;
  /** Travel direction: 1 right, -1 left. */
  facing: 1 | -1;
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

// ── Click-through management (v3 — native autopilot) ───────────────────────
// HARD-LEARNED (v1, v2): every JS-driven approach to `ignore_cursor_events`
// failed. A click-through window receives no DOM events, so JS works from
// stale data; concurrent invokes land out of order on the Rust side; Vite
// HMR resets module caches; the Conductor's settings_update writes the
// window directly. The fix is structural: a single Rust thread
// (`start_assistant_input_watcher` in src-tauri/src/forms.rs) is the ONLY
// writer. It reads the real cursor + the real window rect every 50ms and
// flips click-through itself. JS's whole job is reporting the *interactive
// lock* (chat open / drag / pointer on an interactive zone) — latest-wins,
// serialized, idempotent.
let lockDesired: boolean | null = null;
let lockApplied: boolean | null = null;
let lockInflight = false;
function pumpLock() {
  if (lockInflight || lockDesired === null || lockDesired === lockApplied) return;
  const next = lockDesired;
  lockInflight = true;
  invoke('presence_assistant_set_interactive_lock', { locked: next })
    .then(() => {
      lockApplied = next;
    })
    .catch(() => {
      lockApplied = null; // unknown — retry on next report
    })
    .finally(() => {
      lockInflight = false;
      pumpLock();
    });
}
function reportInteractiveLock(locked: boolean) {
  lockDesired = locked;
  pumpLock();
}

export function useAssistantBrain(opts: Options): AssistantBrainState {
  const { personality, width, height, paused, interactionLocked, onRemark, onPoint } = opts;
  const [mode, setMode] = useState<AssistantMode>('idle');
  // Avatar-world v1: locomotion + facing surface to the 3D renderer.
  const [locomotion, setLocomotion] = useState<LocomotionState>('idle');
  const [facing, setFacing] = useState<1 | -1>(1);
  const bodyRef = useRef(createBody(200, 200));
  const physicsRef = useRef<PhysicsConfig>(DEFAULT_PHYSICS);
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
    syncLock();
  }, [interactionLocked]);

  // DOM-reported hover over interactive zones (body, bubble, chat).
  const domHoverRef = useRef(false);

  // The native watcher treats "locked" as: explicit interaction lock OR the
  // pointer being over an interactive DOM zone. Combine both signals here.
  const syncLock = () => {
    reportInteractiveLock(lockedRef.current || domHoverRef.current);
  };

  const setInteractive = useCallback((on: boolean) => {
    domHoverRef.current = on;
    setHovering(on);
    if (on) lastActivityRef.current = Date.now();
    reportInteractiveLock(lockedRef.current || on);
    // A missed pointerleave can't strand the window: the native watcher
    // also tracks the real cursor against the real window rect, so leaving
    // the window always re-enables click-through within ~50ms.
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
      if (pos) {
        posRef.current = { x: pos.x, y: pos.y };
        // Seed the physics body's feet from the real window position; it
        // starts falling so gravity settles it onto the nearest platform.
        bodyRef.current.x = pos.x + width / 2;
        bodyRef.current.y = pos.y + height - FOOT_OFFSET;
        bodyRef.current.state = 'falling';
      }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Director (Slice C): movement only with intent ────────────────────────
  // The avatar lives DOCKED at the home corner of the monitor the user is
  // working on. It moves only when:
  //   • a point request arrives (walk to the target, highlight),
  //   • the user enters deep focus (RETREAT — same dock, signals quiet), or
  //   • the active monitor changes (re-dock so it stays near the action).
  // APPROACH (walking beside the active window) is reserved for the
  // suggestion engine (Slice D) via `metu:assistant-approach` events.
  const dockTarget = useCallback(
    (fg: ForegroundWindow | null): Point => {
      // Bottom-right corner of the monitor hosting the active window (or
      // primary). 16px margin keeps it off taskbar edges.
      const mons = monitorsRef.current;
      const margin = 16;
      let mon = mons.find((m) => m.primary) ?? mons[0];
      if (fg && mons.length > 1) {
        const cx = fg.x + fg.w / 2;
        const cy = fg.y + fg.h / 2;
        mon = mons.find((m) => cx >= m.x && cx < m.x + m.w && cy >= m.y && cy < m.y + m.h) ?? mon;
      }
      if (!mon) return { x: 100, y: 100 };
      return {
        x: mon.x + mon.w - width - margin,
        y: mon.y + mon.h - height - margin,
      };
    },
    [width, height],
  );

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let lastDockKey = '';

    const decide = async () => {
      if (cancelled) return;
      if (!pausedRef.current && !lockedRef.current) {
        const act = getActivityState();
        if (pointReqRef.current) {
          const r = pointReqRef.current.rect;
          targetRef.current = clampToMonitors(
            r.x + r.w + 8,
            r.y,
            width,
            height,
            monitorsRef.current,
          );
          setMode('point');
        } else {
          const fg = await getForeground().catch(() => null);
          reactToForeground(fg);
          const dock = dockTarget(fg);
          const dockKey = `${dock.x},${dock.y}`;
          const atDock = Math.hypot(posRef.current.x - dock.x, posRef.current.y - dock.y) < 24;
          if (dockKey !== lastDockKey || !atDock) {
            // Re-dock only when the dock actually moved (monitor change)
            // or we're away from it (e.g. after a point/approach).
            lastDockKey = dockKey;
            targetRef.current = dock;
          }
          setMode(act.focusDepth === 'deep' ? 'retreat' : 'docked');
        }
      }
      timer = setTimeout(decide, 5_000);
    };

    const reactToForeground = (fg: ForegroundWindow | null) => {
      const id = fg?.id ?? null;
      if (id && id !== lastForegroundRef.current) {
        lastForegroundRef.current = id;
        lastActivityRef.current = Date.now();
        // Remark only outside deep focus, and rarely — purposeful, not chatty.
        const act = getActivityState();
        if (act.focusDepth !== 'deep' && Math.random() < cfgRef.current.chattiness * 0.4) {
          onRemark?.('windowReact');
        }
      }
    };

    timer = setTimeout(decide, 2_000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, dockTarget]);

  // Approach intents from the suggestion engine (Slice D): walk beside the
  // active window to deliver a suggestion, then the next decide() re-docks.
  useEffect(() => {
    const handler = () => {
      void getForeground()
        .then((fg) => {
          if (!fg) return;
          targetRef.current = clampToMonitors(
            fg.x + fg.w - width - 8,
            Math.max(fg.y + 48, 0),
            width,
            height,
            monitorsRef.current,
          );
          setMode('approach');
        })
        .catch(() => {});
    };
    window.addEventListener('metu:assistant-approach', handler);
    return () => window.removeEventListener('metu:assistant-approach', handler);
  }, [width, height]);

  // Explicit "go home" intent (context menu): walk to the dock corner of
  // the monitor hosting the active window.
  useEffect(() => {
    const handler = () => {
      void getForeground()
        .then((fg) => {
          targetRef.current = dockTarget(fg);
          setMode('docked');
        })
        .catch(() => {
          targetRef.current = dockTarget(null);
          setMode('docked');
        });
    };
    window.addEventListener('metu:assistant-dock', handler);
    return () => window.removeEventListener('metu:assistant-dock', handler);
  }, [dockTarget]);

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

  // ── Movement stepping (avatar-world v1: platformer physics) ─────────────
  // The window IS the body: the integrator owns feet position (bottom-center
  // of the window, FOOT_OFFSET up); we convert feet → window top-left here.
  // Targets from the director (dock/approach/point) become nav goals — the
  // character walks the floor/taskbar, hops gaps, climbs window edges, and
  // falls (with gravity) when its platform disappears.
  useEffect(() => {
    if (!isTauri()) return;
    const w = getCurrentWindow();
    screenWorld.start();
    const body = bodyRef.current;
    let lastTs = performance.now();
    let lastLoco: LocomotionState = body.state;

    const timer = setInterval(() => {
      const now = performance.now();
      const dt = (now - lastTs) / 1000;
      lastTs = now;

      if (pausedRef.current || lockedRef.current) {
        // User owns the window. Track reality; feet follow the window.
        targetRef.current = null;
        cancelNav(body);
        void w
          .outerPosition()
          .then((p) => {
            posRef.current = { x: p.x, y: p.y };
            body.x = p.x + width / 2;
            body.y = p.y + height - FOOT_OFFSET;
            // Dropped from a drag → land on whatever is below.
            if (body.state !== 'falling') {
              const ground = screenWorld.groundBelow(body.x, body.y - 1);
              body.ground = ground && Math.abs(ground.y - body.y) < 8 ? ground : null;
              if (!body.ground) body.state = 'falling';
            }
          })
          .catch(() => {});
        return;
      }

      // New director target → navigation goal at feet level.
      const target = targetRef.current;
      if (target) {
        targetRef.current = null;
        navigateTo(body, target.x + width / 2, target.y + height - FOOT_OFFSET);
      }

      const before = body.goal;
      step(body, screenWorld, physicsRef.current, dt);

      // Arrived at a point target → fire the highlight.
      if (before && !body.goal && pointReqRef.current) {
        onPoint?.(pointReqRef.current);
        pointReqRef.current = null;
        setMode('idle');
      }

      // Surface locomotion to the renderer (clip selection + facing).
      if (body.state !== lastLoco) {
        lastLoco = body.state;
        setLocomotion(body.state);
      }
      setFacing(body.facing);

      // Feet → window top-left.
      const wx = Math.round(body.x - width / 2);
      const wy = Math.round(body.y - height + FOOT_OFFSET);
      if (wx !== posRef.current.x || wy !== posRef.current.y) {
        posRef.current = { x: wx, y: wy };
        void w.setPosition(new PhysicalPosition(wx, wy)).catch(() => {});
      }
    }, FRAME_MS);
    return () => {
      clearInterval(timer);
      screenWorld.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  // ── Click-through ownership ──────────────────────────────────────────────
  // Click-through itself is owned by the NATIVE watcher
  // (start_assistant_input_watcher in src-tauri/src/forms.rs) — see the
  // module comment at the top. The JS side only keeps the lock signal fresh:
  // re-report it periodically so a Rust-side restart / HMR module reset
  // can't leave the watcher with a stale lock bit.
  useEffect(() => {
    if (!isTauri()) return;
    const timer = setInterval(() => {
      lockApplied = null; // force a re-send even if value unchanged
      reportInteractiveLock(lockedRef.current || domHoverRef.current);
    }, HOVER_POLL_MS * 8);
    return () => clearInterval(timer);
  }, []);

  return { mode, hovering, setInteractive, locomotion, facing };
}

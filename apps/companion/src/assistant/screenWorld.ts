/**
 * Screen world model — turns the desktop into a platformer level.
 *
 * Sources (all physical px):
 *   - monitors (spatial_monitors): each work-area bottom is a FLOOR
 *     (the taskbar top edge — Windows work area excludes the taskbar).
 *   - open windows (device_list_windows, polled at 1Hz): each non-minimized
 *     window's top edge is a PLATFORM; left/right edges are WALLS the
 *     character can climb.
 *
 * The physics engine asks `groundBelow(x, fromY)` ("where would I land?")
 * and `wallAt(x, y, dir)` ("can I climb here?"). Diffing between refreshes
 * lets the brain notice "the platform I stood on vanished" → fall.
 */
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../state/runtime';
import { getMonitors, type MonitorInfo } from './spatial';

export interface Platform {
  /** Top edge segment the character can stand on. */
  x1: number;
  x2: number;
  y: number;
  /** 'floor' = monitor work-area bottom; 'window' = a window top edge. */
  kind: 'floor' | 'window';
  /** Window id when kind = 'window'. */
  windowId?: string;
}

export interface Wall {
  /** Vertical segment the character can climb. */
  x: number;
  y1: number;
  y2: number;
  /** Which side of the window this wall is ('left' wall is climbed from the left). */
  side: 'left' | 'right';
  windowId: string;
}

interface RawWindow {
  id: string;
  title: string;
  app: string;
  bounds: { x: number; y: number; w: number; h: number };
  minimized: boolean;
}

const MIN_PLATFORM_WIDTH = 120; // px — too narrow to stand on looks silly
const MIN_WALL_HEIGHT = 160;

export class ScreenWorld {
  platforms: Platform[] = [];
  walls: Wall[] = [];
  monitors: MonitorInfo[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();

  start(): void {
    if (!isTauri() || this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), 1_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async refresh(): Promise<void> {
    const [mons, wins] = await Promise.all([
      getMonitors(),
      // sense_window_map is the ungated geometry read — device_list_windows
      // requires the windows_read capability (unset by default) and would
      // leave the world empty → no platforms → the character never moves.
      invoke<RawWindow[]>('sense_window_map').catch(() => [] as RawWindow[]),
    ]);
    if (mons.length) this.monitors = mons;

    const platforms: Platform[] = [];
    const walls: Wall[] = [];

    // Floors: monitor work-area bottoms. spatial_monitors returns full
    // bounds; approximate the work area as bottom minus a 48px taskbar on
    // the primary monitor (Windows default). Good enough visually — the
    // character walks ON the taskbar.
    for (const m of this.monitors) {
      const taskbar = m.primary ? Math.round(48 * (m.scale || 1)) : 0;
      platforms.push({
        x1: m.x,
        x2: m.x + m.w,
        y: m.y + m.h - taskbar,
        kind: 'floor',
      });
    }

    // Window platforms + walls. Skip our own windows and tiny/utility ones.
    for (const w of wins) {
      if (w.minimized) continue;
      if (/metu/i.test(w.app)) continue;
      const { x, y, w: ww, h } = w.bounds;
      if (ww < MIN_PLATFORM_WIDTH || h < 80) continue;
      // Skip windows whose top edge is above all monitors (offscreen) or
      // maximized windows (top edge at/over the monitor top — nothing to
      // stand on, and the window IS the screen).
      const mon = this.monitors.find(
        (m) =>
          x + ww / 2 >= m.x && x + ww / 2 < m.x + m.w && y + h / 2 >= m.y && y + h / 2 < m.y + m.h,
      );
      if (!mon) continue;
      if (y <= mon.y + 8) continue;
      platforms.push({ x1: x, x2: x + ww, y, kind: 'window', windowId: w.id });
      if (h >= MIN_WALL_HEIGHT) {
        walls.push({ x, y1: y, y2: y + h, side: 'left', windowId: w.id });
        walls.push({ x: x + ww, y1: y, y2: y + h, side: 'right', windowId: w.id });
      }
    }

    this.platforms = platforms;
    this.walls = walls;
    for (const cb of this.listeners) cb();
  }

  /**
   * The highest platform at `x` whose y is >= fromY (i.e. at or below the
   * character's feet) — where gravity would land it.
   */
  groundBelow(x: number, fromY: number): Platform | null {
    let best: Platform | null = null;
    for (const p of this.platforms) {
      if (x < p.x1 || x > p.x2) continue;
      if (p.y < fromY - 2) continue; // above us
      if (!best || p.y < best.y) best = p;
    }
    return best;
  }

  /** A climbable wall within `reach` px of x, moving in `dir`. */
  wallNear(x: number, y: number, dir: 1 | -1, reach = 24): Wall | null {
    for (const w of this.walls) {
      if (y < w.y1 - 4 || y > w.y2) continue;
      const dx = w.x - x;
      // Moving right into a window's left wall, or left into a right wall.
      if (dir === 1 && w.side === 'left' && dx > 0 && dx <= reach) return w;
      if (dir === -1 && w.side === 'right' && dx < 0 && -dx <= reach) return w;
    }
    return null;
  }

  /** True if the platform (by identity fields) still exists. */
  stillExists(p: Platform): boolean {
    return this.platforms.some(
      (q) =>
        q.kind === p.kind &&
        q.windowId === p.windowId &&
        Math.abs(q.y - p.y) < 4 &&
        q.x1 <= p.x2 &&
        q.x2 >= p.x1,
    );
  }
}

export const screenWorld = new ScreenWorld();

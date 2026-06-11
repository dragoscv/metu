/**
 * Avatar platformer physics — the character lives ON the desktop.
 *
 * The assistant WINDOW is the body: this integrator owns the window
 * position. The character's feet anchor is bottom-center of the window
 * (FOOT_OFFSET above the actual window bottom so the 3D model's feet —
 * not the canvas edge — touch the platform).
 *
 * States: idle | walking | jumping | falling | climbing
 * Navigation: `navigateTo(x, y)` walks/jumps/climbs toward a goal;
 * `wander` is gone — movement only happens with intent (director rules).
 *
 * All coordinates physical px. Step is driven by the caller's rAF-ish
 * tick (the brain's movement interval) with dt seconds.
 */
import type { Platform, ScreenWorld } from './screenWorld';

export type LocomotionState = 'idle' | 'walking' | 'jumping' | 'falling' | 'climbing' | 'sitting';

export interface PhysicsConfig {
  walkSpeed: number; // px/s
  gravity: number; // px/s²
  jumpVelocity: number; // px/s upward (positive number)
  climbSpeed: number; // px/s
  /** Max upward gap the character will jump for; higher → climb instead. */
  maxJumpHeight: number;
}

export const DEFAULT_PHYSICS: PhysicsConfig = {
  walkSpeed: 260,
  gravity: 2200,
  jumpVelocity: 950, // ~205px apex at 2200 gravity
  climbSpeed: 180,
  maxJumpHeight: 190,
};

/** Feet are this many px above the window's bottom edge (canvas padding). */
export const FOOT_OFFSET = 28;

export interface AvatarBody {
  /** Feet position, physical px (x = center). */
  x: number;
  y: number;
  vx: number;
  vy: number;
  state: LocomotionState;
  /** -1 facing left, 1 facing right. */
  facing: 1 | -1;
  /** Platform currently stood on (grounded states). */
  ground: Platform | null;
  /** Navigation goal, or null when content. */
  goal: { x: number; y: number } | null;
  /** Jumps attempted for the current goal — prevents infinite bounce
   *  when the goal height is unreachable from this platform. */
  goalJumps: number;
}

export function createBody(x: number, y: number): AvatarBody {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    state: 'falling',
    facing: 1,
    ground: null,
    goal: null,
    goalJumps: 0,
  };
}

const ARRIVE_EPS = 24;

/**
 * Advance the body by dt seconds. Mutates and returns the body.
 * The caller converts feet position → window position afterwards.
 */
export function step(
  body: AvatarBody,
  world: ScreenWorld,
  cfg: PhysicsConfig,
  dt: number,
): AvatarBody {
  dt = Math.min(dt, 0.05); // clamp spiral-of-death frames

  // World not loaded yet (first refresh is async) — don't integrate.
  // Without this the body free-falls off-screen before platforms exist.
  if (world.platforms.length === 0 || world.monitors.length === 0) return body;

  // Ground vanished beneath us (window closed/moved) → fall.
  if (body.ground && !world.stillExists(body.ground)) {
    body.ground = null;
    if (body.state !== 'jumping') body.state = 'falling';
  }

  switch (body.state) {
    case 'sitting': {
      // Sitting is stable: only a new goal or a vanished platform ends it.
      if (body.goal) {
        body.state = 'walking';
        break;
      }
      break;
    }
    case 'idle':
    case 'walking': {
      const goal = body.goal;
      if (!goal) {
        body.state = 'idle';
        body.vx = 0;
        break;
      }
      const dx = goal.x - body.x;
      const dir: 1 | -1 = dx >= 0 ? 1 : -1;
      body.facing = dir;

      // Arrived horizontally?
      if (Math.abs(dx) <= ARRIVE_EPS) {
        // Need to go UP to reach the goal (it sits on a higher platform)?
        // Only jump when a PLATFORM actually exists at goal height above
        // us, and give up after 2 attempts — jumping into empty air just
        // lands back on the same spot and loops forever (the idle-bounce
        // bug: dock targets are window-TOP coordinates, so goal.y was
        // always 'above' even when standing at the right place).
        const rise = body.y - goal.y;
        const reachable =
          rise > ARRIVE_EPS &&
          rise <= cfg.maxJumpHeight &&
          body.goalJumps < 2 &&
          world.platforms.some(
            (p) =>
              goal.x >= p.x1 &&
              goal.x <= p.x2 &&
              Math.abs(p.y - goal.y) < 40 &&
              p.y < body.y - ARRIVE_EPS,
          );
        if (reachable) {
          body.goalJumps++;
          body.vy = -cfg.jumpVelocity;
          body.state = 'jumping';
          body.ground = null;
        } else {
          // Horizontally there = arrived. Height mismatch without a real
          // platform means the goal was an approximate anchor — done.
          body.goal = null;
          body.goalJumps = 0;
          body.state = 'idle';
          body.vx = 0;
        }
        break;
      }

      body.state = 'walking';
      body.vx = dir * cfg.walkSpeed;
      const nextX = body.x + body.vx * dt;

      // A wall in the way → climb it (that's the fun part).
      const wall = world.wallNear(body.x, body.y, dir);
      if (wall && goal.y < body.y - ARRIVE_EPS) {
        body.state = 'climbing';
        body.x = wall.x; // latch to the wall
        body.vx = 0;
        break;
      }

      // Walking off the edge of the current platform → fall (gravity will
      // catch us on whatever is below; classic platformer).
      const support = world.groundBelow(nextX, body.y - 4);
      if (!support || support.y > body.y + 6) {
        // Try a hop first if the goal is roughly level/above and the gap
        // is small — feels livelier than always falling.
        if (goal.y <= body.y + 40) {
          body.vy = -cfg.jumpVelocity * 0.7;
          body.state = 'jumping';
          body.ground = null;
        } else {
          body.state = 'falling';
          body.ground = null;
        }
      }
      body.x = nextX;
      break;
    }

    case 'jumping':
    case 'falling': {
      // Air control toward the goal.
      if (body.goal) {
        const dir: 1 | -1 = body.goal.x >= body.x ? 1 : -1;
        body.facing = dir;
        body.vx = dir * cfg.walkSpeed * 0.85;
      }
      body.vy += cfg.gravity * dt;
      if (body.vy > 0) body.state = 'falling';
      body.x += body.vx * dt;
      body.y += body.vy * dt;

      // Land?
      const ground = world.groundBelow(body.x, body.y - 1);
      if (ground && body.y >= ground.y && body.vy >= 0) {
        body.y = ground.y;
        body.vy = 0;
        body.ground = ground;
        body.state = body.goal ? 'walking' : 'idle';
      }
      // Hard safety floor: never fall past the bottom of ANY monitor.
      // (Previous version used Math.max(..., body.y) — the body's own y
      // as "fallback" meant the floor FOLLOWED the body down, i.e. no
      // floor at all. That's how the avatar fell off the screen.)
      if (world.monitors.length) {
        const floorY = Math.max(...world.monitors.map((m) => m.y + m.h));
        if (body.y > floorY) {
          body.y = floorY;
          body.vy = 0;
          body.state = body.goal ? 'walking' : 'idle';
        }
      }
      // Horizontal clamp too — air control can't push past the desktop.
      if (world.monitors.length) {
        const minX = Math.min(...world.monitors.map((m) => m.x)) + 40;
        const maxX = Math.max(...world.monitors.map((m) => m.x + m.w)) - 40;
        body.x = Math.max(minX, Math.min(maxX, body.x));
      }
      break;
    }

    case 'climbing': {
      const goal = body.goal;
      body.y -= cfg.climbSpeed * dt;
      // Reached the top of the wall (a platform at this x)?
      const wall = world.walls.find(
        (w) => Math.abs(w.x - body.x) < 8 && body.y >= w.y1 - 4 && body.y <= w.y2,
      );
      if (!wall || body.y <= wall.y1) {
        // Mantle onto the platform top.
        body.y = wall ? wall.y1 : body.y;
        // Nudge onto the surface in the facing direction.
        body.x += body.facing * 18;
        const ground = world.groundBelow(body.x, body.y - 1);
        body.ground = ground;
        body.state = goal ? 'walking' : 'idle';
        body.vy = 0;
      }
      // Goal got cancelled mid-climb → let go.
      if (!goal) {
        body.state = 'falling';
        body.vy = 0;
      }
      break;
    }
  }

  return body;
}

/** Start navigating to a feet-coordinate goal. */
export function navigateTo(body: AvatarBody, x: number, y: number): void {
  // Ignore goals that are (within tolerance) where we already stand —
  // re-issued dock targets otherwise cause twitchy micro-walks.
  if (
    body.goal === null &&
    body.state === 'idle' &&
    Math.abs(x - body.x) <= 28 &&
    Math.abs(y - body.y) <= 60
  ) {
    return;
  }
  body.goal = { x, y };
  body.goalJumps = 0;
  if (body.state === 'idle') body.state = 'walking';
}

/** Cancel any navigation (e.g. user grabbed the window). */
export function cancelNav(body: AvatarBody): void {
  body.goal = null;
  if (body.state === 'walking') body.state = 'idle';
}

/** A celebratory hop (no goal change). */
export function hop(body: AvatarBody, cfg: PhysicsConfig): void {
  if (body.state === 'idle' || body.state === 'walking') {
    body.vy = -cfg.jumpVelocity * 0.6;
    body.state = 'jumping';
    body.ground = null;
  }
}

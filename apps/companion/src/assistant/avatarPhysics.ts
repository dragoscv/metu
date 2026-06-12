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

export type LocomotionState =
  | 'idle'
  | 'walking'
  | 'jumping'
  | 'falling'
  | 'climbing'
  | 'sitting'
  | 'teleporting';

/** Teleport morph timing (seconds): dissolve-out, then materialize-in. */
export const TELEPORT_OUT_S = 0.3;
export const TELEPORT_IN_S = 0.32;

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

/**
 * Legacy constant — superseded by the measured anchor in
 * `avatar/footAnchor.ts` (the stage projects the model's actual feet).
 * Kept only as the pre-measurement default documented there.
 */
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
  /** Teleport morph: destination + elapsed seconds (state==='teleporting'). */
  teleportTarget: { x: number; y: number } | null;
  teleportElapsed: number;
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
    teleportTarget: null,
    teleportElapsed: 0,
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
    case 'teleporting': {
      // Dissolve out → snap → materialize in. The window itself jumps at
      // the midpoint; the renderer carries the visual morph.
      body.teleportElapsed += dt;
      if (body.teleportTarget && body.teleportElapsed >= TELEPORT_OUT_S) {
        body.x = body.teleportTarget.x;
        body.y = body.teleportTarget.y;
        body.teleportTarget = null;
      }
      if (body.teleportElapsed >= TELEPORT_OUT_S + TELEPORT_IN_S) {
        body.teleportElapsed = 0;
        const ground = world.groundBelow(body.x, body.y - 1);
        if (ground && Math.abs(ground.y - body.y) < 12) {
          body.y = ground.y;
          body.ground = ground;
          body.state = 'idle';
        } else {
          body.ground = null;
          body.state = 'falling';
        }
        body.goal = null;
        body.goalJumps = 0;
        body.vx = 0;
        body.vy = 0;
      }
      break;
    }
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
      // Clamp to the goal — overshooting past it makes next frame's dir
      // flip and the body oscillate around the goal line (walk wobble at
      // arrival, especially at low frame rates where vx*dt is large).
      let nextX = body.x + body.vx * dt;
      if ((dir === 1 && nextX > goal.x) || (dir === -1 && nextX < goal.x)) {
        nextX = goal.x;
      }

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
        // Hop the gap ONLY when a landing platform verifiably exists at
        // roughly this height within hop range — blind edge-hops with no
        // landing looked like nervous bouncing at platform edges.
        const hopRange = 160;
        const landing = world.groundBelow(body.x + dir * hopRange, body.y + 24);
        const canHop = !!landing && Math.abs(landing.y - body.y) <= 48;
        if (canHop && goal.y <= body.y + 40) {
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
      // Air control toward the goal — WITH a deadzone. Recomputing the
      // direction every frame with `goal.x >= body.x` meant that the
      // moment the body crossed the goal line, dir (and vx, and facing)
      // flipped sign EVERY FRAME — the window vibrated left-right and
      // the model whipped its yaw ±90° at frame rate (THE jump wobble).
      if (body.goal) {
        const dx = body.goal.x - body.x;
        if (Math.abs(dx) > ARRIVE_EPS) {
          const dir: 1 | -1 = dx >= 0 ? 1 : -1;
          body.facing = dir;
          body.vx = dir * cfg.walkSpeed * 0.85;
        } else {
          // Close enough horizontally — kill lateral drive, keep facing.
          body.vx *= 0.8;
        }
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
  if (body.state === 'teleporting') return; // mid-warp — let it finish
  // Dedupe 1: settled close enough already (idle or sitting) → ignore.
  // The horizontal tolerance must be comfortably ABOVE the director's
  // re-dock hysteresis floor so the two layers never fight.
  if (
    body.goal === null &&
    (body.state === 'idle' || body.state === 'sitting') &&
    Math.abs(x - body.x) <= 48 &&
    Math.abs(y - body.y) <= 80
  ) {
    return;
  }
  // Dedupe 2: already navigating to (almost) the same place → keep the
  // current goal object; replacing it re-triggered arrival logic and
  // caused direction flips mid-walk.
  if (body.goal && Math.abs(body.goal.x - x) <= 8 && Math.abs(body.goal.y - y) <= 8) {
    return;
  }
  body.goal = { x, y };
  body.goalJumps = 0;
  if (body.state === 'idle' || body.state === 'sitting') body.state = 'walking';
}

/**
 * Teleport morph to a feet-coordinate destination — used for long hauls
 * and cross-monitor moves instead of an epic trek (or a hard jump cut).
 * The renderer plays dissolve-out/materialize-in keyed off 'teleporting'.
 */
export function teleportTo(body: AvatarBody, x: number, y: number): void {
  if (body.state === 'teleporting') return;
  if (Math.abs(x - body.x) <= 4 && Math.abs(y - body.y) <= 4) return;
  body.goal = null;
  body.goalJumps = 0;
  body.vx = 0;
  body.vy = 0;
  body.facing = x >= body.x ? 1 : -1;
  body.teleportTarget = { x, y };
  body.teleportElapsed = 0;
  body.state = 'teleporting';
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

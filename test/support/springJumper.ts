/**
 * Round 15: a scripted jumper for the spring maps (test/springIsles.test.ts). It plays
 * like a careful player with perfect aim: standing still on a route stop, it solves the
 * hop to the next stop's centre (the lowest launch speed whose arc clears the target by
 * APEX_CLEARANCE and comes down onto it), pushes the stick to that aim + deflection for a
 * few ticks and lets go. Only produces InputFrames.
 */

import { PX_PER_M } from '../../src/contracts';
import type { InputFrame } from '../../src/contracts';
import type { LevelSession } from '../../src/game/session';
import type { RouteStop } from '../../src/levels/springIsles';
import { STAND_DY } from '../../src/levels/springIsles';
import type { SpringTuning } from '../../src/physics/tuning';
import { SPRING_MIN_STICK_POWER, SPRING_STICK_DEADZONE } from '../../src/physics/vessel/spring';
import { frame, type Pilot } from './s7Harness';

/** px the arc's apex must clear the landing height by (the hull clears ledge lips). */
export const APEX_CLEARANCE = 30;
/** px the hull centre must be above its landing height when it crosses the target's near edge (lip + half a hull). */
export const EDGE_CLEARANCE = 14;

export interface Hop {
  aim: number;
  power: number;
  speed: number;
}

/**
 * The jump from (0, 0) to (dx, rise) (px, rise up = +), vessel centre to centre, under
 * gravity g (px/s²): the slowest launch whose apex is >= rise + APEX_CLEARANCE and which
 * lands on the descending branch. null when no aim / charge within the tuning does it.
 */
export function solveHop(t: Pick<SpringTuning, 'jumpSpeedMin' | 'jumpSpeedMax' | 'aimMax'>, g: number, dx: number, rise: number, nearEdge?: number): Hop | null {
  const x = Math.max(4, Math.abs(dx));
  const side = dx < 0 ? -1 : 1;
  let best: Hop | null = null;
  for (let i = 1; i <= 600; i++) {
    const th = (i / 600) * t.aimMax;
    const s = Math.sin(th);
    const c = Math.cos(th);
    const den = 2 * s * s * (x * (c / s) - rise);
    if (den <= 0) continue;
    const v = Math.sqrt((g * x * x) / den);
    // a stick charge under SPRING_MIN_STICK_POWER cancels instead of hopping
    if (v < t.jumpSpeedMin + SPRING_MIN_STICK_POWER * (t.jumpSpeedMax - t.jumpSpeedMin) || v > t.jumpSpeedMax) continue;
    const apex = (v * c) ** 2 / (2 * g);
    if (apex < rise + APEX_CLEARANCE) continue;
    if (x <= (v * v * s * c) / g) continue; // still rising when it gets there
    if (nearEdge !== undefined && nearEdge > 0 && nearEdge < x) {
      // over the target's near lip the hull must be EDGE_CLEARANCE above its landing height
      const te = nearEdge / (v * s);
      const ye = v * c * te - (g * te * te) / 2;
      if (ye < rise + EDGE_CLEARANCE) continue;
    }
    if (!best || v < best.speed) best = { aim: side * th, power: (v - t.jumpSpeedMin) / (t.jumpSpeedMax - t.jumpSpeedMin), speed: v };
  }
  return best;
}

/** The route stop the vessel stands on (null: somewhere else). */
export function standingOn(route: readonly RouteStop[], pos: { x: number; y: number }): number | null {
  const feet = pos.y + STAND_DY;
  for (let i = route.length - 1; i >= 0; i--) {
    const r = route[i]!;
    if (Math.abs(feet - r.top) <= 8 && Math.abs(pos.x - r.cx) <= r.w / 2 + 14) return i;
  }
  return null;
}

export interface JumperLog {
  hops: { from: number; to: number; t: number }[];
  /** Hops that came down somewhere other than the target. */
  misses: number;
}

export interface JumperOptions {
  /** Ticks the stick is held before letting go (default 4). */
  holdTicks?: number;
  /** Sloppy aim (audit stuck-scan): returns a radian error added to every hop's aim. */
  aimNoise?: () => number;
}

/** Route stop the feet are over (or nearest below them), for a vessel standing anywhere. */
function nearestBelow(route: readonly RouteStop[], pos: { x: number; y: number }): number {
  const feet = pos.y + STAND_DY;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < route.length; i++) {
    const r = route[i]!;
    if (r.top < feet - 8) continue; // above the feet
    const d = Math.abs(pos.x - r.cx) + (r.top - feet);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * A pilot that climbs `route` in order (from wherever it stands, to the next stop). It acts
 * whenever the legs are on the ground and still - `landed` or not (a tilted / hooked hull may
 * always charge), so it also proves that no still pose soft-locks the climb.
 */
export function springJumper(route: readonly RouteStop[], log: JumperLog = { hops: [], misses: 0 }, opts: JumperOptions | number = {}): Pilot {
  const o: JumperOptions = typeof opts === 'number' ? { holdTicks: opts } : opts;
  const holdTicks = o.holdTicks ?? 4;
  let hold = 0;
  let steer: InputFrame | null = null;
  let lastTarget = -1;
  return (s: LevelSession): InputFrame => {
    const v = s.vessel;
    const sp = v.springState?.();
    const st = s.state;
    if (hold > 0 && steer) {
      hold--;
      return steer;
    }
    steer = null;
    if (!sp || sp.phase !== 'ground' || Math.hypot(st.vel.x, st.vel.y) > 1) return frame();
    const here = standingOn(route, st.pos);
    if (lastTarget >= 0) {
      if (here !== lastTarget) log.misses++;
      lastTarget = -1;
    }
    const from = here ?? nearestBelow(route, st.pos);
    if (here === route.length - 1) return frame(); // on the summit: the exit completes on its own
    const g = Math.hypot(sp.gravity.x, sp.gravity.y) || s.spec.gravity.y * PX_PER_M;
    // the next stop; off the route (a fall, a hooked corner), the next stop it can actually reach
    let to = -1;
    let hop: ReturnType<typeof solveHop> = null;
    for (let k = Math.min(route.length - 1, from + 1); k >= 0 && !hop; k--) {
      if (here !== null && k <= from) break;
      const target = route[k]!;
      const dx = target.cx - st.pos.x;
      // the near lip: half the flat top + the outline's sloped lip + half a hull (jump-through tiers have none)
      const lip = target.kind === 'oneWay' || target.kind === 'crumble' ? undefined : Math.abs(dx) - target.w / 2 - 6 - 12;
      hop = solveHop(s.tuning.spring, g, dx, st.pos.y - (target.top - STAND_DY), lip);
      to = k;
    }
    if (!hop) return frame();
    log.hops.push({ from, to, t: s.simTime });
    lastTarget = to;
    const aim = hop.aim + (o.aimNoise?.() ?? 0);
    steer = frame({ steer: { x: Math.sin(aim), y: -Math.cos(aim) }, steerLength: SPRING_STICK_DEADZONE + hop.power * (1 - SPRING_STICK_DEADZONE) });
    hold = holdTicks - 1;
    return steer;
  };
}

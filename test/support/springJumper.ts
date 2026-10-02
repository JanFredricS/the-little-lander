/**
 * Round 15: a scripted jumper for the spring maps (test/springIsles.test.ts). It plays
 * like a careful player with perfect aim: standing still on a route stop, it solves the
 * hop to the next stop's centre (the lowest launch speed whose arc clears the target by
 * APEX_CLEARANCE and comes down onto it), pushes the stick to that aim + deflection for a
 * few ticks and lets go. Only produces InputFrames.
 *
 * Round 16 (what a player reads off the screen, no peeking at hidden state):
 *  - a vine curtain on the hop (RouteStop.curtain): aim that many px past the stop;
 *  - the crate gate (RouteStop.gate): while the crate column still stands on the target's
 *    lip, ram it - a full-charge hop whose arc meets the column's middle - then hop on;
 *  - patrolling sky-birds: before letting go, play the arc forward against every harmful
 *    creature's (periodic, visible) loop and wait while they would meet.
 * climbWithRespawns() replays checkpoint respawns after a crash, like the App does.
 */

import { PX_PER_M } from '../../src/contracts';
import type { InputFrame, LevelSpec } from '../../src/contracts';
import { LevelSession } from '../../src/game/session';
import { CREATURE_VESSEL_PAD, creatureHitRadius } from '../../src/levels/runtime/creatures';
import type { RouteStop } from '../../src/levels/springIsles';
import { CRATE, STAND_DY } from '../../src/levels/springIsles';
import { mToPx } from '../../src/physics/units';
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
    // round 16: a hull tilted on a stop's sloped lip (its centre lower than standing) is still on it
    if (feet - r.top >= -8 && feet - r.top <= 20 && Math.abs(pos.x - r.cx) <= r.w / 2 + 18) return i;
  }
  return null;
}

export interface JumperLog {
  hops: { from: number; to: number; t: number }[];
  /** Hops that came down somewhere other than the target. */
  misses: number;
  /** Round 16: ram hops into the crate column. */
  rams?: number;
  /** Round 16: ticks spent waiting for a bird to clear the arc. */
  birdWaits?: number;
}

/** Round 16: a still hull tilted past this (rad) waits up to UPRIGHT_WAIT ticks to right itself before hopping. */
export const UPRIGHT_TILT = 0.35;
export const UPRIGHT_WAIT = 90;

/** Round 16: px of extra clearance the jumper keeps from a bird's sting radius. */
export const BIRD_MARGIN = 10;

/**
 * Round 16: the crate column on a gate stop still stands (its top crate more than 2.5 crates
 * above the stop's top, over the stop's near half). A toppled pile is a step, not a wall.
 */
export function gateStanding(s: LevelSession, stop: RouteStop): boolean {
  for (const { entity, body } of s.built.props.values()) {
    if (!entity.dynamic || !s.physics.hasBody(body)) continue;
    const t = s.physics.getTransform(body);
    const x = mToPx(t.x);
    const y = mToPx(t.y);
    if (Math.abs(x - stop.cx) <= stop.w / 2 + 10 && stop.top - y > 2.5 * CRATE) return true;
  }
  return false;
}

/** Height (px) of fallen crates under a landing at x on a stop (a hull's width either side; 0 = clear). */
function pileAt(s: LevelSession, stop: RouteStop, x: number): number {
  let h = 0;
  for (const { entity, body } of s.built.props.values()) {
    if (!entity.dynamic || !s.physics.hasBody(body)) continue;
    const t = s.physics.getTransform(body);
    if (Math.abs(mToPx(t.x) - x) > CRATE * 0.71 + 12) continue;
    h = Math.max(h, stop.top - (mToPx(t.y) - CRATE * 0.71));
  }
  return Math.max(0, h);
}

/** Launch (aim, power 1) whose full-speed arc from `from` passes through `p` (the flatter of the two). */
function ramAim(t: Pick<SpringTuning, 'jumpSpeedMax' | 'aimMax'>, g: number, dx: number, rise: number): number | null {
  const v = t.jumpSpeedMax;
  const x = Math.abs(dx);
  let best: number | null = null;
  for (let i = 1; i <= 600; i++) {
    const th = (i / 600) * t.aimMax;
    const vx = v * Math.sin(th);
    const T = x / vx;
    const y = v * Math.cos(th) * T - (g * T * T) / 2;
    if (Math.abs(y - rise) < 3) best = th; // keep the flattest (largest th) that passes
  }
  return best === null ? null : Math.sign(dx || 1) * best;
}

/** Will the arc (from pos, launch vel, flying `sec`) pass within a harmful creature's sting? */
function birdOnArc(s: LevelSession, pos: { x: number; y: number }, vel: { x: number; y: number }, g: number, sec: number, delaySec: number): boolean {
  for (const c of s.runtime.creatures.ambient) {
    if (c.entity.harm === undefined || !c.active) continue;
    const reach = creatureHitRadius(c.entity) + CREATURE_VESSEL_PAD + BIRD_MARGIN;
    for (let t = 0; t <= sec; t += 1 / 30) {
      const b = c.path.at(c.travelled + c.entity.speed * (t + delaySec));
      const x = pos.x + vel.x * t;
      const y = pos.y + vel.y * t + (g * t * t) / 2;
      if (Math.hypot(x - b.x, y - b.y) < reach) return true;
    }
  }
  return false;
}

export interface JumperOptions {
  /** Ticks the stick is held before letting go (default 4). */
  holdTicks?: number;
  /** Sloppy aim (audit stuck-scan): returns a radian error added to every hop's aim. */
  aimNoise?: () => number;
  /** Round 16: sloppy charge - added to every hop's power (0..1, clamped). */
  powerNoise?: () => number;
}

/** Audit L1: px added along the hop to its aim point after 0, 1, 2 ... misses of the same hop from the same spot. */
const RETRY_NUDGE = [0, 12, -12, 24, -24, 6, -6, 18, -18];

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
  let still = 0;
  /** Off-route hops that keep failing from the same spot (an islet overhead): try another. */
  const failed = new Map<string, number>();
  /** Audit L1: misses of the same hop from the same spot (any launch) - vary the aim point after each. */
  const repeats = new Map<string, number>();
  let launchCell = '';
  let launchedOffRoute = false;
  return (s: LevelSession): InputFrame => {
    const v = s.vessel;
    const sp = v.springState?.();
    const st = s.state;
    if (hold > 0 && steer) {
      hold--;
      return steer;
    }
    steer = null;
    if (!sp || sp.phase !== 'ground' || Math.hypot(st.vel.x, st.vel.y) > 1) {
      still = 0;
      return frame();
    }
    // round 16: a hull lying tilted / on its side (a lip landing) is given a moment to spring upright, as a
    // player would wait for it; a pose that never rights still hops after UPRIGHT_WAIT ticks (no soft-lock)
    still++;
    if (Math.abs(st.angle) > UPRIGHT_TILT && still < UPRIGHT_WAIT) return frame();
    const here = standingOn(route, st.pos);
    if (lastTarget >= 0) {
      if (here !== lastTarget) {
        log.misses++;
        repeats.set(`${lastTarget}@${launchCell}`, (repeats.get(`${lastTarget}@${launchCell}`) ?? 0) + 1);
        if (launchedOffRoute) failed.set(`${lastTarget}@${launchCell}`, (failed.get(`${lastTarget}@${launchCell}`) ?? 0) + 1);
      }
      lastTarget = -1;
    }
    const from = here ?? nearestBelow(route, st.pos);
    const g = Math.hypot(sp.gravity.x, sp.gravity.y) || s.spec.gravity.y * PX_PER_M;
    if (here === route.length - 1) {
      // on the summit: the exit completes on its own - once the hull rests inside the dock
      const dock = s.spec.entities.find((e) => e.kind === 'exitDock');
      if (!dock || Math.abs(st.pos.x - dock.x) < 30) return frame();
      const hop = solveHop(s.tuning.spring, g, dock.x - st.pos.x, 0);
      if (!hop) return frame();
      steer = frame({ steer: { x: Math.sin(hop.aim), y: -Math.cos(hop.aim) }, steerLength: SPRING_STICK_DEADZONE + hop.power * (1 - SPRING_STICK_DEADZONE) });
      hold = holdTicks - 1;
      return steer;
    }
    const sv = s.tuning.spring;
    const cellNow = `${Math.round(st.pos.x / 30)},${Math.round(st.pos.y / 30)}`;
    /** The hop onto route stop k from here (a ram while its crate column stands); null: none. */
    const plan = (k: number): { hop: Hop; ram: boolean } | null => {
      const target = route[k]!;
      const side = Math.sign(target.cx - st.pos.x) || 1;
      if (target.gate && gateStanding(s, target)) {
        // the crate gate: ram the column's middle at full charge
        const colX = side > 0 ? target.cx - target.w / 2 + CRATE / 2 : target.cx + target.w / 2 - CRATE / 2;
        const aim = ramAim(sv, g, colX - side * 12 - st.pos.x, st.pos.y - (target.top - 1.5 * CRATE));
        return aim === null ? null : { hop: { aim, power: 1, speed: sv.jumpSpeedMax }, ram: true };
      }
      // a vine curtain drags the hop across the gap short: aim that far past the stop
      const across = here !== null && k === here + 1 && Math.abs(target.cx - st.pos.x) > 100;
      // fallen crates: try spots across the flat top, each raised by the pile under it
      for (const off of target.gate ? [0, 30, -30, 45, -45] : [0]) {
        const x = target.cx + off;
        const pile = target.gate ? pileAt(s, target, x) : 0;
        // audit L1: the same hop keeps missing from here (a lip hook, a swinging vine): aim a little long / short
        const nudge = RETRY_NUDGE[(repeats.get(`${k}@${cellNow}`) ?? 0) % RETRY_NUDGE.length]!;
        const dx = x + side * ((across ? (target.curtain ?? 0) : 0) + nudge) - st.pos.x;
        // the near lip: half the flat top + the outline's sloped lip + half a hull (jump-through tiers have none)
        const lip = target.kind === 'oneWay' || target.kind === 'crumble' ? undefined : Math.abs(dx) - target.w / 2 - 6 - 12;
        const rise = st.pos.y - (target.top - pile - STAND_DY);
        // right beside a target's face, the lip is passed on the way UP: drop the (descending) lip test
        const hop = solveHop(sv, g, dx, rise, lip) ?? solveHop(sv, g, dx, rise);
        if (hop) return { hop, ram: false };
      }
      return null;
    };
    let to = -1;
    let choice: { hop: Hop; ram: boolean } | null = null;
    if (here !== null) {
      to = here + 1;
      choice = plan(to);
      if (!choice) {
        // no hop from this spot (a lip pose, too far out): hop back to the middle of the stop
        const r = route[here]!;
        const hop = Math.abs(r.cx - st.pos.x) > 10 ? solveHop(sv, g, r.cx - st.pos.x, st.pos.y - (r.top - STAND_DY)) : null;
        if (hop) {
          to = here;
          choice = { hop, ram: false };
        }
      }
    } else {
      // off the route (a fall): the highest stop it can reach from here
      const cell = `${Math.round(st.pos.x / 30)},${Math.round(st.pos.y / 30)}`;
      for (let k = route.length - 1; k >= 0 && !choice; k--) {
        if ((failed.get(`${k}@${cell}`) ?? 0) >= 2) continue;
        choice = plan(k);
        to = k;
      }
      if (!choice) {
        // nothing in reach (far out on the meadow): hop along the ground toward the nearest stop
        const r = route[from]!;
        const hop = solveHop(sv, g, Math.max(-250, Math.min(250, r.cx - st.pos.x)), 0);
        if (hop) {
          to = -1;
          choice = { hop, ram: false };
        }
      }
    }
    const hop = choice?.hop ?? null;
    const ram = choice?.ram ?? false;
    if (!hop) return frame();
    const aim = hop.aim + (o.aimNoise?.() ?? 0);
    const vx = Math.sin(aim) * hop.speed;
    const vy = -Math.cos(aim) * hop.speed;
    // flight time back down to the launch height (+ a margin), the stick held holdTicks first
    if (birdOnArc(s, st.pos, { x: vx, y: vy }, g, (2 * -vy) / g + 0.3, holdTicks / 60)) {
      log.birdWaits = (log.birdWaits ?? 0) + 1;
      return frame();
    }
    log.hops.push({ from, to, t: s.simTime });
    launchedOffRoute = here === null;
    launchCell = `${Math.round(st.pos.x / 30)},${Math.round(st.pos.y / 30)}`;
    if (ram) log.rams = (log.rams ?? 0) + 1;
    lastTarget = ram || to < 0 ? -1 : to;
    const power = Math.min(1, Math.max(SPRING_MIN_STICK_POWER, hop.power + (o.powerNoise?.() ?? 0)));
    steer = frame({ steer: { x: Math.sin(aim), y: -Math.cos(aim) }, steerLength: SPRING_STICK_DEADZONE + power * (1 - SPRING_STICK_DEADZONE) });
    hold = holdTicks - 1;
    return steer;
  };
}

export interface ClimbResult {
  complete: boolean;
  /** Checkpoint respawns after a crash (and level restarts when no checkpoint was reached). */
  respawns: number;
  /** Sim seconds over every attempt. */
  timeSec: number;
  log: JumperLog;
  /** Times a sky-bird stung the hull. */
  stings: number;
  /** Worst fall (px of height lost between two standing spots). */
  worstDrop: number;
}

/**
 * Round 16: climb `spec` with a jumper, replaying a crash as the App does - a checkpoint
 * respawn (a fresh session from respawnState()), or a level restart before the first one.
 */
export async function climbWithRespawns(spec: LevelSpec, route: readonly RouteStop[], opts: JumperOptions, maxSec: number): Promise<ClimbResult> {
  const log: JumperLog = { hops: [], misses: 0 };
  let respawns = 0;
  let timeSec = 0;
  let stings = 0;
  let worstDrop = 0;
  let respawn: Awaited<ReturnType<LevelSession['respawnState']>> = null;
  for (;;) {
    const s = await LevelSession.create(spec, respawn);
    s.on((e) => {
      if (e.type === 'hullChanged' && e.reason === 'creature') stings++;
    });
    s.start();
    const pilot = springJumper(route, log, opts);
    let lastStandY = s.state.pos.y;
    const t0 = s.simTime;
    for (let i = 0; !s.outcome && timeSec + (s.simTime - t0) < maxSec; i++) {
      s.step(pilot(s, i));
      const sp = s.vessel.springState?.();
      if (sp?.phase === 'ground' && Math.hypot(s.state.vel.x, s.state.vel.y) < 1) {
        worstDrop = Math.max(worstDrop, s.state.pos.y - lastStandY);
        lastStandY = s.state.pos.y;
      }
    }
    timeSec += s.simTime - t0;
    const outcome = s.outcome;
    respawn = outcome?.kind === 'failed' ? s.respawnState() : null;
    s.destroy();
    if (outcome?.kind === 'complete') return { complete: true, respawns, timeSec, log, stings, worstDrop };
    if (!outcome || timeSec >= maxSec) return { complete: false, respawns, timeSec, log, stings, worstDrop };
    respawns++;
  }
}

/** Round 16 audit M1: one forced hop of a bird-lane sweep (launched regardless of the bird). */
export interface LaneHop {
  /** Launch delay (ticks after settling). */
  delay: number;
  stung: boolean;
  /** Route stop it came to rest on (null: off-route), and where. */
  on: number | null;
  pos: { x: number; y: number };
}

/**
 * Round 16 audit M1: stand on route stop `from`, wait `delay` ticks (one launch timing per
 * delay), then make the exact hop to the next stop WITHOUT waiting for the birds; run until
 * the hull rests (30 still ticks on the ground, max 10 s).
 */
export async function laneHop(spec: LevelSpec, route: readonly RouteStop[], from: number, delay: number): Promise<LaneHop> {
  const a = route[from]!;
  const b = route[from + 1]!;
  const s = await LevelSession.create({ ...spec, spawn: { x: a.cx, y: a.top - STAND_DY - 1 } });
  let stung = false;
  s.on((e) => {
    if (e.type === 'hullChanged' && e.reason === 'creature') stung = true;
  });
  s.start();
  for (let i = 0; i < 40 + delay; i++) s.step(frame());
  stung = false;
  const g = spec.gravity.y * s.tuning.gravity.scale * PX_PER_M;
  const hop = solveHop(s.tuning.spring, g, b.cx - s.state.pos.x, s.state.pos.y - (b.top - STAND_DY))!;
  const f = frame({ steer: { x: Math.sin(hop.aim), y: -Math.cos(hop.aim) }, steerLength: SPRING_STICK_DEADZONE + hop.power * (1 - SPRING_STICK_DEADZONE) });
  for (let i = 0; i < 4; i++) s.step(f);
  let still = 0;
  for (let i = 0; i < 600 && still < 30 && !s.outcome; i++) {
    s.step(frame());
    still = s.vessel.springState?.().phase === 'ground' && Math.hypot(s.state.vel.x, s.state.vel.y) < 1 ? still + 1 : 0;
  }
  const out = { delay, stung, on: standingOn(route, s.state.pos), pos: { ...s.state.pos } };
  s.destroy();
  return out;
}

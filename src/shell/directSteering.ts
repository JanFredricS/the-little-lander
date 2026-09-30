/**
 * DIRECT steering (Settings.steering = 'direct'): an input layer between the
 * InputMapper and the vessel controllers. Sources report only a direction
 * the player wants to thrust toward (InputFrame.steer: a finger held on the
 * play area, relative to the vessel, or WASD / arrows 8-way); once per fixed
 * step this layer rewrites the frame's flight controls into the engine
 * pulses a pilot would fire to push that way. Vessel physics, tuning, fuel
 * and brake assist are untouched: the controllers see an ordinary frame.
 *
 * No command = pure coast: every flight control off. No auto-hover, no
 * auto-upright, no velocity hold. The angle-hold logic acts only while a
 * direction is held.
 *
 * Lander (engines + S9 top thrusters):
 *  - Commands within DIRECT_TOP_CROSSOVER (100°) of world-up use the main
 *    pair: the target body angle IS the command angle (the main engines push
 *    along body-up). Further round (the downward arc) the TOP thrusters push
 *    instead - they push along body-down, so the target body angle is the
 *    command angle minus 180° and the lander stays within ~80° of upright
 *    rather than flipping over. The crossover is decided in WORLD frame, so
 *    an upward command always rights the ship on the main engines (it can
 *    land again), with ±DIRECT_CROSSOVER_HYSTERESIS so a finger resting near
 *    100° does not chatter between the sets.
 *  - Angle hold is bang-bang on a PD switching signal s = e - τ·ω (e =
 *    wrapped error to the target, ω = angular velocity). BOTH engines of the
 *    set fire (thrust along the command) only when the ship is ACTUALLY
 *    pointed there and not turning away: |e| AND |s| inside the band.
 *    Gating on s alone would thrust far off-axis mid-turn (at e = 30° with
 *    ω ≈ e/τ toward the target, s ≈ 0). Otherwise the ONE engine whose
 *    offset torque drives s toward 0 fires (main: left engine = clockwise,
 *    right = counter-clockwise; top: right = clockwise, left =
 *    counter-clockwise); the τ·ω lead brakes the turn before it overshoots.
 *    At 60 Hz the result is the usual pulse train.
 * CSM (one main engine + rotation): the same PD drives rotateCW/rotateCCW,
 *  and the main engine burns only while pointed within DIRECT_CSM_BURN_CONE of
 *  the command. The CSM has no top thrusters, so a downward command turns it
 *  over (the only way it can push down).
 * Harpoon modes keep their normal controls (their aim / fire / reel inputs
 * would collide with "hold anywhere to thrust").
 *
 * Pure and deterministic: the only state is the lander's engine set (for the
 * hysteresis), reset whenever the command is released or input is cleared.
 * Settings.swapEngineButtons does not apply: this layer drives physical
 * engines, and there are no engine buttons / keys to swap.
 */

import type { InputFrame, VesselMode } from '../contracts';

const DEG = Math.PI / 180;

/** Command angle from world-up beyond which the lander pushes with its top thrusters instead of turning over. */
export const DIRECT_TOP_CROSSOVER = 100 * DEG;
/** Half-width of the crossover's hysteresis band while a command is held. */
export const DIRECT_CROSSOVER_HYSTERESIS = 8 * DEG;
/** PD lead time (s): how far ahead the angular velocity is projected when deciding which way to torque. */
export const DIRECT_LEAD_SEC = 0.22;
/** The lander fires both engines of the set (thrusts) instead of turning while |error| and |switching signal| are both within this (rad). */
export const DIRECT_THRUST_BAND = 3 * DEG;
/** CSM: |switching signal| (rad) inside which no rotation is commanded. */
export const DIRECT_CSM_ROTATE_BAND = 3 * DEG;
/** CSM: the main engine burns only while pointed within this angle of the command. */
export const DIRECT_CSM_BURN_CONE = 25 * DEG;

/** Tolerance (rad) for the crossover comparison: commands within it of an edge count as ON the edge. */
const EDGE_EPS = 1e-9;

/** Modes DIRECT steering drives; the others keep their normal controls. */
export const DIRECT_STEER_MODES: ReadonlySet<VesselMode> = new Set<VesselMode>(['lander', 'csm']);

export function isDirectSteerMode(mode: VesselMode): boolean {
  return DIRECT_STEER_MODES.has(mode);
}

/** Wrap an angle to (-π, π]. */
export function wrapAngle(a: number): number {
  const w = Math.atan2(Math.sin(a), Math.cos(a));
  return w === -Math.PI ? Math.PI : w;
}

/** Body angle (clockwise from up, like VesselState.angle) that points body-up along world direction `d` (y-down). */
export function commandAngle(d: { x: number; y: number }): number {
  return Math.atan2(d.x, -d.y);
}

/** The vessel attitude the layer reads (a VesselState satisfies it). */
export interface SteerAttitude {
  mode: VesselMode;
  /** Radians, clockwise-positive, 0 = upright. */
  angle: number;
  angularVel: number;
}

export class DirectSteering {
  /** Lander engine set of the held command: 'top' = top thrusters (downward arc). Null = no command held. */
  private set: 'main' | 'top' | null = null;

  /** Engine set in use for the held command (tests / debugging). */
  get engineSet(): 'main' | 'top' | null {
    return this.set;
  }

  /** Forget the held command (input cleared: pause, resume, restart, new level). */
  reset(): void {
    this.set = null;
  }

  /**
   * Rewrite `frame`'s flight controls (in place; also returned) from
   * frame.steer for vessel attitude `v`. Frames for modes outside
   * DIRECT_STEER_MODES pass through untouched. Shell edges (pause, restart)
   * are never touched.
   */
  apply(frame: InputFrame, v: SteerAttitude): InputFrame {
    if (!isDirectSteerMode(v.mode)) {
      this.set = null;
      return frame;
    }
    frame.thrust = false;
    frame.engineLeft = false;
    frame.engineRight = false;
    frame.topLeft = false;
    frame.topRight = false;
    frame.rotateCW = false;
    frame.rotateCCW = false;
    const d = frame.steer;
    if (d.x === 0 && d.y === 0) {
      this.set = null; // released: coast
      return frame;
    }
    const cmd = commandAngle(d);
    if (v.mode === 'csm') {
      this.set = null;
      const e = wrapAngle(cmd - v.angle);
      const s = e - DIRECT_LEAD_SEC * v.angularVel;
      frame.rotateCW = s > DIRECT_CSM_ROTATE_BAND;
      frame.rotateCCW = s < -DIRECT_CSM_ROTATE_BAND;
      frame.thrust = Math.abs(e) < DIRECT_CSM_BURN_CONE;
      return frame;
    }
    // lander: pick the engine set (world-frame crossover, hysteresis while held)
    const off = Math.abs(cmd);
    const edge = this.set === 'top' ? DIRECT_TOP_CROSSOVER - DIRECT_CROSSOVER_HYSTERESIS : this.set === 'main' ? DIRECT_TOP_CROSSOVER + DIRECT_CROSSOVER_HYSTERESIS : DIRECT_TOP_CROSSOVER;
    // a command exactly ON an edge counts as main (EDGE_EPS absorbs float noise from the direction -> angle round trip)
    const set = off > edge + EDGE_EPS ? 'top' : 'main';
    this.set = set;
    const target = set === 'top' ? wrapAngle(cmd - Math.PI) : cmd;
    const e = wrapAngle(target - v.angle);
    const s = e - DIRECT_LEAD_SEC * v.angularVel;
    // thrust only when actually on target (e) and not about to swing off it (s); turning decisions use s
    const both = Math.abs(e) <= DIRECT_THRUST_BAND && Math.abs(s) <= DIRECT_THRUST_BAND;
    const cw = s > 0;
    if (set === 'main') {
      // left engine pushes the left side up: clockwise
      frame.engineLeft = both || cw;
      frame.engineRight = both || !cw;
    } else {
      // top-right pushes the right side down: clockwise
      frame.topRight = both || cw;
      frame.topLeft = both || !cw;
    }
    return frame;
  }
}

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
 *  - Upper-arc compression (Task 11): with the main engines the body tilt
 *    is the command angle up to DIRECT_TILT_KNEE, then grows at
 *    DIRECT_TILT_SLOPE and is capped at DIRECT_TILT_CAP, so a near-
 *    horizontal finger (75-85° from up) tilts ~57-64° and full horizontal
 *    ~67°: the ship keeps enough lift to fly level instead of sinking. The
 *    downward arc (top thrusters) is not compressed.
 *  - Angle hold is a differential burn on a PD switching signal
 *    s = e - τ·ω (e = wrapped error to the target, ω = angular velocity).
 *    The LEADING engine - the one whose offset torque drives s toward 0
 *    (main: left engine = clockwise, right = counter-clockwise; top: right
 *    = clockwise, left = counter-clockwise) - always fires; the τ·ω lead
 *    brakes the turn before it overshoots. The TRAILING engine joins with a
 *    duty that ramps from 0 at max(|e|, |s|) = DIRECT_BURN_GATE to 1 inside
 *    DIRECT_THRUST_BAND (sigma-delta pulses at 60 Hz: deterministic, and the
 *    residual torque still finishes the turn). So a held diagonal gets most
 *    of both-engine thrust as soon as the ship is within ~10° of it, while
 *    far off-axis (|e| or |s| beyond the gate, e.g. mid-turn at e = 30° with
 *    ω ≈ e/τ, where s ≈ 0) only the leading engine burns.
 * CSM (one main engine + rotation): the same PD drives rotateCW/rotateCCW,
 *  and the main engine burns only while pointed within DIRECT_CSM_BURN_CONE of
 *  the command. The CSM has no top thrusters, so a downward command turns it
 *  over (the only way it can push down).
 * Harpoon modes keep their normal controls (their aim / fire / reel inputs
 * would collide with "hold anywhere to thrust").
 *
 * Power (Task 11): the lander's main engines run at DIRECT_LANDER_THRUST_SCALE
 * (InputFrame.engineScale) - the ENGINES scheme's thrust is unchanged.
 *
 * Pure and deterministic: the only state is the lander's engine set (for the
 * hysteresis) and the trailing engine's sigma-delta accumulator, both reset
 * whenever the command is released or input is cleared.
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
/** The lander fires both engines of the set (full thrust) while |error| and |switching signal| are both within this (rad). */
export const DIRECT_THRUST_BAND = 3 * DEG;
/** Beyond this max(|error|, |switching signal|) (rad) only the leading engine burns; inside it the trailing engine's duty ramps up to 1 at DIRECT_THRUST_BAND. */
export const DIRECT_BURN_GATE = 20 * DEG;
/**
 * Lander main-engine thrust multiplier while DIRECT drives it (InputFrame.engineScale):
 * lander.thrust 0.9 -> ~1.1 per engine, so straight up nets ~1.2 g instead of
 * 0.8 g and a compressed near-horizontal tilt (~60°) roughly holds altitude.
 * DIRECT-only: the ENGINES scheme keeps lander.thrust < 1 (one engine alone
 * must not hover - maps.test), and level tunings (e.g. map 1's softer
 * thrust) scale proportionally. Top thrusters are not scaled.
 */
export const DIRECT_LANDER_THRUST_SCALE = 1.22;
/** Upper-arc compression: body tilt = command angle up to this knee (rad)... */
export const DIRECT_TILT_KNEE = 40 * DEG;
/** ...then grows at this slope (tilt per command angle)... */
export const DIRECT_TILT_SLOPE = 0.55;
/** ...capped here (rad): full horizontal ≈ 67°. */
export const DIRECT_TILT_CAP = 68 * DEG;
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

/** Main-engine target tilt for a command angle (upper-arc compression; sign kept). */
export function compressTilt(cmd: number): number {
  const a = Math.abs(cmd);
  if (a <= DIRECT_TILT_KNEE) return cmd;
  return Math.sign(cmd) * Math.min(DIRECT_TILT_CAP, DIRECT_TILT_KNEE + (a - DIRECT_TILT_KNEE) * DIRECT_TILT_SLOPE);
}

/** Trailing-engine duty (0..1) for PD magnitude m = max(|e|, |s|) (rad). */
export function trailingDuty(m: number): number {
  if (m <= DIRECT_THRUST_BAND) return 1;
  if (m >= DIRECT_BURN_GATE) return 0;
  return (DIRECT_BURN_GATE - m) / (DIRECT_BURN_GATE - DIRECT_THRUST_BAND);
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
  /** Sigma-delta accumulator for the trailing engine's duty. */
  private duty = 0;

  /** Engine set in use for the held command (tests / debugging). */
  get engineSet(): 'main' | 'top' | null {
    return this.set;
  }

  /** Forget the held command (input cleared: pause, resume, restart, new level). */
  reset(): void {
    this.set = null;
    this.duty = 0;
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
    frame.engineScale = undefined;
    const d = frame.steer;
    if (d.x === 0 && d.y === 0) {
      this.reset(); // released: coast
      return frame;
    }
    const cmd = commandAngle(d);
    if (v.mode === 'csm') {
      this.reset();
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
    if (set !== this.set) this.duty = 0;
    this.set = set;
    const target = set === 'top' ? wrapAngle(cmd - Math.PI) : compressTilt(cmd);
    const e = wrapAngle(target - v.angle);
    const s = e - DIRECT_LEAD_SEC * v.angularVel;
    // leading engine by s (turn / brake); trailing engine by duty, which needs BOTH |e| (actually
    // pointed there) and |s| (not about to swing off) small - no full thrust far off-axis mid-turn
    const cw = s > 0;
    const d0 = trailingDuty(Math.max(Math.abs(e), Math.abs(s)));
    let trail = false;
    if (d0 >= 1) {
      trail = true;
      this.duty = 0;
    } else if (d0 > 0) {
      this.duty += d0;
      if (this.duty >= 1) {
        this.duty -= 1;
        trail = true;
      }
    } else this.duty = 0;
    if (set === 'main') {
      // left engine pushes the left side up: clockwise
      frame.engineLeft = cw || trail;
      frame.engineRight = !cw || trail;
      frame.engineScale = DIRECT_LANDER_THRUST_SCALE;
    } else {
      // top-right pushes the right side down: clockwise
      frame.topRight = cw || trail;
      frame.topLeft = !cw || trail;
    }
    return frame;
  }
}

/**
 * DIRECT steering (Settings.steering = 'direct'): an input layer between the
 * InputMapper and the vessel controllers. Pointer sources report only a
 * direction the player wants to thrust toward (InputFrame.steer: a finger /
 * held mouse on the play area, relative to the vessel; keys: see KEYBOARD
 * below); once per fixed
 * step this layer rewrites the frame's flight controls into the engine
 * pulses a pilot would fire to push that way. Vessel physics, tuning, fuel
 * and brake assist are untouched: the controllers see an ordinary frame.
 *
 * No command = pure coast: every flight control off. No auto-hover, no
 * auto-upright, no velocity hold. The angle-hold logic acts only while a
 * direction is held (the lander keyboard's release stop, below, only
 * cancels the spin its own rotate key made).
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
 * KEYBOARD (round 3, user feedback): the keys do not steer by direction. A
 * steer (finger / held mouse) always wins; with no steer the layer reads the
 * keyboard's semantic flags instead:
 *  - CSM: the classic keys pass through untouched (thrust / rotateCW /
 *    rotateCCW) - Descent and the other CSM legs fly the ENGINE scheme on a
 *    keyboard whatever the steering setting.
 *  - Lander (KeyboardSource emits rotateCCW ← / A, rotateCW → / D, thrust
 *    ↑ / W / Space, topLeft + topRight ↓ / S): ROTATE + THRUST. A held
 *    rotate key is a rate command (±DIRECT_KEY_TURN_RATE), flown bang-bang
 *    on ω with DIRECT_KEY_RATE_BAND: alone it fires an RCS-like COUPLE (one
 *    main + the opposite top thruster, main at DIRECT_LANDER_COUPLE_SCALE so
 *    the two cancel along the body axis - turning costs ~no altitude); with
 *    thrust it fires only the leading main engine while the rate is short
 *    (both inside the band); with ↓ only the leading top thruster. Releasing
 *    the rotate key brakes the spin IT added (same couple, opposite way):
 *    back to the spin the vessel had when the key went down (or to 0 if
 *    that was the other way), within DIRECT_KEY_STOP_BAND, then all off. It
 *    never brakes below that baseline, so a tap during a tumble does not
 *    stop the tumble - a stop, not an attitude hold or a stabiliser: nothing
 *    ever chases an angle (no auto-upright).
 *    The couple's main-engine scale is topThrust / thrust of the level's
 *    lander tuning (setLanderTuning), so the pair cancels on every level.
 *  - InputFrame.turnIntent reports the player's own turn command (the held
 *    rotate key, or the finger's angle hold) - never the release brake - for
 *    the ground-righting assist (src/levels/systems/righting.ts).
 *    Thrust alone = both mains at DIRECT_LANDER_THRUST_SCALE; ↓ alone = both
 *    top thrusters (a downward burn; ↑ wins when both are held). No keys =
 *    coast.
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

/** Lander keyboard: turn rate (rad/s) a held rotate key flies at. */
export const DIRECT_KEY_TURN_RATE = 2.2;
/** Lander keyboard: |ω error| (rad/s) inside which the rate counts as held (no torque pulse). */
export const DIRECT_KEY_RATE_BAND = 0.25;
/** Lander keyboard: the release stop ends once |ω| (rad/s) is within this (or ω changed sign) - ~no drift left. */
export const DIRECT_KEY_STOP_BAND = 0.08;
/**
 * Lander keyboard: main-engine scale while a rotate key fires the turning
 * couple alone (main + opposite top thruster). topThrust / thrust (0.7 / 0.9):
 * the pair cancels along the body axis, so a pure turn neither climbs nor
 * sinks (brake assist aside).
 */
export const DIRECT_LANDER_COUPLE_SCALE = 0.78;

/** Main-engine scale for the lander keyboard couple: top thrust / main thrust (the axial forces cancel). */
export function landerCoupleScale(t: { thrust: number; topThrust: number }): number {
  return t.thrust > 0 ? t.topThrust / t.thrust : DIRECT_LANDER_COUPLE_SCALE;
}

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
  /** Lander keyboard: sign of the turn the rotate key last flew (0 = none); armed = brake that spin on release. */
  private keyTurn = 0;
  /** Angular velocity when the current rotate key went down: the release brake stops there, never below. */
  private keyBase = 0;
  /** Couple main-engine scale for the current level's lander tuning. */
  private coupleScale = DIRECT_LANDER_COUPLE_SCALE;

  /** Engine set in use for the held command (tests / debugging). */
  get engineSet(): 'main' | 'top' | null {
    return this.set;
  }

  /** The level's lander tuning (thrust / topThrust, after its physicsOverrides): sets the keyboard couple's balance. */
  setLanderTuning(t: { thrust: number; topThrust: number }): void {
    this.coupleScale = landerCoupleScale(t);
  }

  /** Forget the held command (input cleared: pause, resume, restart, new level). */
  reset(): void {
    this.set = null;
    this.duty = 0;
    this.keyTurn = 0;
  }

  /**
   * Rewrite `frame`'s flight controls (in place; also returned) from
   * frame.steer for vessel attitude `v`. Frames for modes outside
   * DIRECT_STEER_MODES pass through untouched. Shell edges (pause, restart)
   * are never touched.
   */
  apply(frame: InputFrame, v: SteerAttitude): InputFrame {
    if (!isDirectSteerMode(v.mode)) {
      this.reset(); // e.g. a switch to a harpoon mode: no brake carried across
      return frame;
    }
    const d = frame.steer;
    if (d.x === 0 && d.y === 0) {
      this.set = null;
      this.duty = 0;
      // no steer: keyboard flags (CSM: classic pass-through; lander: rotate + thrust)
      if (v.mode === 'csm') {
        this.keyTurn = 0;
        frame.engineLeft = frame.engineRight = frame.topLeft = frame.topRight = false;
        frame.engineScale = undefined;
        return frame;
      }
      return this.keys(frame, v);
    }
    this.keyTurn = 0;
    clearFlight(frame);
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
    frame.turnIntent = cw ? 1 : -1; // the finger's own command (righting assist)
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

  /** Lander keyboard: rotate (rate command + release stop) and thrust, from the semantic key flags. */
  private keys(frame: InputFrame, v: SteerAttitude): InputFrame {
    const up = frame.thrust;
    const down = !up && (frame.topLeft || frame.topRight);
    const turn = (frame.rotateCW ? 1 : 0) - (frame.rotateCCW ? 1 : 0);
    clearFlight(frame);
    frame.turnIntent = turn; // the held key only: the release brake below is never intent
    let target: number | null = null;
    if (turn !== 0) {
      if (turn !== this.keyTurn) this.keyBase = v.angularVel; // a new press (or reversal): remember the spin it started from
      this.keyTurn = turn;
      target = turn * DIRECT_KEY_TURN_RATE;
    } else if (this.keyTurn !== 0) {
      // released: remove only the spin the key added (down to its baseline, or 0 if that was the other way), then let go
      const base = this.keyTurn > 0 ? Math.max(this.keyBase, 0) : Math.min(this.keyBase, 0);
      if (this.keyTurn * (v.angularVel - base) <= DIRECT_KEY_STOP_BAND) this.keyTurn = 0;
      else target = base;
    }
    const err = target === null ? 0 : target - v.angularVel;
    const band = turn !== 0 ? DIRECT_KEY_RATE_BAND : 0; // stopping: brake every tick until the stop condition above
    const torque = target !== null && Math.abs(err) > band ? Math.sign(err) : 0; // +1 = clockwise
    if (up) {
      // leading main engine only while the rate is short (left engine = clockwise), else both
      frame.engineLeft = torque >= 0;
      frame.engineRight = torque <= 0;
      frame.engineScale = DIRECT_LANDER_THRUST_SCALE;
    } else if (down) {
      // top-right pushes the right side down = clockwise
      frame.topRight = torque >= 0;
      frame.topLeft = torque <= 0;
    } else if (torque !== 0) {
      // the couple: main + opposite top thruster, axial forces cancelling
      const cw = torque > 0;
      frame.engineLeft = cw;
      frame.topRight = cw;
      frame.engineRight = !cw;
      frame.topLeft = !cw;
      frame.engineScale = this.coupleScale;
    }
    return frame;
  }
}

function clearFlight(frame: InputFrame): void {
  frame.thrust = false;
  frame.engineLeft = false;
  frame.engineRight = false;
  frame.topLeft = false;
  frame.topRight = false;
  frame.rotateCW = false;
  frame.rotateCCW = false;
  frame.engineScale = undefined;
  frame.turnIntent = undefined;
}

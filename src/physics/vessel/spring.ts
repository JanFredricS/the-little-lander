/**
 * Spring mode (round 15, the post-final arc): the lander with dead thrusters, hopping on
 * spring legs from islet to islet. No engines, no fuel.
 *
 *   ground   - on the ground and still. Aim + charge are set here - in ANY still, touching
 *              pose, tilted or hooked included (never only when `landed`: no soft-lock).
 *   charging - the legs compress (power 0..1); releasing launches.
 *   air      - pure ballistics: no thrust and no air control (the Jump King commitment).
 *              Only the keyboard aim may be pre-swept for the next jump.
 *
 * Two input paths that give the SAME jump for the same (aim, power):
 *   - stick / DIRECT finger: InputFrame.steer is the jump direction (clamped to ±aimMax
 *     from straight up) and InputFrame.steerLength the charge (deflection past the stick
 *     deadzone, see stickPower). Letting go of the stick (steer absent) launches with the
 *     last held aim + charge; pulling the stick DOWN (steer.y > CANCEL_DOWN) or easing it
 *     back to the centre (charge under SPRING_MIN_STICK_POWER) cancels.
 *     Chosen over hold-time charging for the stick because the player sets and SEES the
 *     exact jump before committing (map 1: "stand still and think your way").
 *   - keys / buttons: rotateCCW / rotateCW sweep the aim at aimRate, holding `thrust`
 *     charges over chargeSec (stays full), releasing `thrust` launches, `release` cancels.
 * Input cleared by the shell (pause, auto-pause, a controls card: inputCleared()) cancels too.
 *
 * Launch sets the velocity directly (deterministic arcs: the preview dots are exact) and
 * zeroes the spin. A legs-first touchdown is soaked by the springs (velocity zeroed: no
 * slide) unless `autoBounce` (map 2). Hull damage on hard / sideways hits is the shared
 * VesselBase impact model (damageSpeed / crashSpeed, calibrated to the approach speed). On the ground a capped upright PD
 * torque (no more than the legs could give) rights a tilted touchdown; a hull whose centre
 * hangs past an edge still topples.
 *
 * Map 2 (autoBounce = 1, data only): a touchdown faster than bounceMinSpeed bounces back
 * with bounceRestitution × its normal speed; charging works in the air; a release in the
 * air ARMS the jump for bounceWindowSec, and a touchdown inside that window (or a release
 * up to bounceWindowSec after a touchdown) launches the charged jump instead of the bounce.
 */

import type { GameEventSink, InputFrame, PhysicsApi, Vec2, VesselSpawn } from '../../contracts';
import { PX_PER_M } from '../../contracts';
import type { SpringTuning, VesselOptions } from '../tuning';
import { mToPx, vMToPx, vPxToM } from '../units';
import { VesselBase } from './base';
import type { SpringState, VesselGeometry } from './types';

/** Stick deadzone (matches ui/touch STICK_DEADZONE): deflection below it is no input. */
export const SPRING_STICK_DEADZONE = 0.22;
/** A stick pointing this far down (steer.y, unit vector) is the cancel zone. */
export const SPRING_CANCEL_DOWN = 0.3;
/** Seconds after a launch before a contact may count as the touchdown (leaving the pad). */
const LIFTOFF_SEC = 0.06;
/** A legs-down contact while still rising faster than this (px/s) is a grazed corner, not a touchdown. */
const RISING = 20;
/** A slow, touching hull that is not on its legs (toppled, wedged) counts as grounded after this long (s). */
const WEDGED_SEC = 0.3;
/** Righting torque cap on the legs, as weight × legSpan × this (a hull hanging one foot past an edge still topples). */
const RIGHT_CAP_LEGS = 0.25;
/** ... and lying toppled (not on its legs): the springs kick it back over (a lander on its side needs ~0.7). */
const RIGHT_CAP_TOPPLED = 1.5;
/** Tilt (rad) past which the hull counts as toppled (a side lying on the ground passes the generic legs-down test). */
const TOPPLED_TILT = 0.6;

export function springGeometry(t: SpringTuning): VesselGeometry {
  const footW = 4;
  const footX = t.legSpan / 2 - footW / 2;
  const footY = t.height / 2 + t.legDrop / 2;
  return {
    w: t.legSpan,
    h: t.height + 2 * t.legDrop,
    boxes: [
      { x: 0, y: 0, w: t.width, h: t.height },
      { x: -footX, y: footY, w: footW, h: t.legDrop },
      { x: footX, y: footY, w: footW, h: t.legDrop },
    ],
    nozzles: [],
  };
}

/** Stick charge 0..1 from a deflection 0..1 (0 at the deadzone edge, 1 at full). */
export function stickPower(length: number): number {
  return Math.min(1, Math.max(0, (length - SPRING_STICK_DEADZONE) / (1 - SPRING_STICK_DEADZONE)));
}

/** Launch speed (px/s) for a charge 0..1. */
export function springSpeed(t: Pick<SpringTuning, 'jumpSpeedMin' | 'jumpSpeedMax'>, power: number): number {
  return t.jumpSpeedMin + Math.min(1, Math.max(0, power)) * (t.jumpSpeedMax - t.jumpSpeedMin);
}

/** Launch velocity (px/s): `aim` rad from "up" (= -down), + clockwise. */
export function springLaunchVelocity(t: Pick<SpringTuning, 'jumpSpeedMin' | 'jumpSpeedMax'>, aim: number, power: number, down: Vec2 = DOWN, out?: Vec2): Vec2 {
  const s = springSpeed(t, power);
  // up = -down; rotate it clockwise (screen, y down) by aim
  const ux = -down.x;
  const uy = -down.y;
  const c = Math.cos(aim);
  const sn = Math.sin(aim);
  const x = (ux * c - uy * sn) * s;
  const y = (ux * sn + uy * c) * s;
  if (!out) return { x, y };
  out.x = x;
  out.y = y;
  return out;
}

const DOWN: Vec2 = Object.freeze({ x: 0, y: 1 });

/**
 * Ballistic reach: the furthest horizontal distance (px) a full-charge jump can cover to
 * land `rise` px HIGHER (negative = lower) under gravity `g` (px/s², downwards), over every
 * aim within ±aimMax. -1 when the rise is out of reach.
 */
export function springReach(t: Pick<SpringTuning, 'jumpSpeedMin' | 'jumpSpeedMax' | 'aimMax'>, g: number, rise: number, power = 1): number {
  const v = springSpeed(t, power);
  let best = -1;
  for (let i = 0; i <= 400; i++) {
    const th = (i / 400) * t.aimMax; // from vertical
    const vx = v * Math.sin(th);
    const vy = v * Math.cos(th); // up
    // rise = vy·T − g T²/2, take the later (descending) root
    const disc = vy * vy - 2 * g * rise;
    if (disc < 0) continue;
    const T = (vy + Math.sqrt(disc)) / g;
    best = Math.max(best, vx * T);
  }
  return best;
}

/**
 * A stick charge under this when the stick returns to the centre is a cancel, not a feeble hop
 * (round 15 audit L3). A finger lifted / mouse released off a real charge jumps at once.
 */
export const SPRING_MIN_STICK_POWER = 0.12;

/** Calibration of the shared solver-impulse scale for the spring hull (see solverImpulseScale). */
const SPRING_IMPACT_CAL = 1.1;

/** Map 1's arc preview covers the whole flight back down to the launch height, and this much more. */
export const SPRING_PREVIEW_PAST = 1.15;

/**
 * Seconds of flight the arc preview shows (round 15 audit L4): the whole hop back down to the
 * launch height × SPRING_PREVIEW_PAST, never under 0.3 s. Velocity px/s, gravity px/s².
 */
export function springPreviewSec(vel: Vec2, gravity: Vec2): number {
  const g = Math.hypot(gravity.x, gravity.y);
  if (g <= 0) return 1;
  const up = -(vel.x * gravity.x + vel.y * gravity.y) / g;
  return Math.max(0.3, ((2 * Math.max(0, up)) / g) * SPRING_PREVIEW_PAST);
}

/** Highest rise (px) straight up at full charge. */
export function springMaxRise(t: Pick<SpringTuning, 'jumpSpeedMax'>, g: number): number {
  return (t.jumpSpeedMax * t.jumpSpeedMax) / (2 * g);
}

type Phase = SpringState['phase'];

export class SpringController extends VesselBase {
  readonly mode = 'spring' as const;

  private phase: Phase = 'ground';
  private aim = 0;
  private power = 0;
  /** What is charging: the stick (deflection) or the keys (hold time). */
  private source: 'stick' | 'keys' | null = null;
  private airSec = 0;
  private wedgedSec = 0;
  /** Velocity (px/s) before this step: the touchdown speed (the solver has eaten it by postStep). */
  private preVel: Vec2 = { x: 0, y: 0 };
  private simSec = 0;
  /** Map 2: a jump released in the air, armed until this sim time. */
  private armedUntil = -1;
  /** Map 2: sim time of the last bounce touchdown. */
  private lastBounceAt = -Infinity;

  constructor(physics: PhysicsApi, spawn: VesselSpawn, events: GameEventSink, options: VesselOptions) {
    const t = options.tuning.spring;
    super(physics, spawn, events, springGeometry(t), t, options);
    // every spawn starts 'air': the first step's contacts decide (a spawn resting on its legs is on the ground at once)
    this.phase = 'air';
    this.airSec = LIFTOFF_SEC;
  }

  private get t(): SpringTuning {
    return this.options.tuning.spring;
  }

  /**
   * The spring hull's touchdowns read ~10 % under their approach speed through the shared scale
   * (measured: 330 -> 296, 518 -> 469, 912 -> 833 px/s); SPRING_IMPACT_CAL puts damageSpeed /
   * crashSpeed back on the approach speed (round 15 audit L1).
   */
  protected override solverImpulseScale(): number {
    return super.solverImpulseScale() * SPRING_IMPACT_CAL;
  }

  /**
   * The aim / charge for the renderer (every frame). One reused object (round 15 audit L7):
   * read it, copy what you keep - the next call overwrites it.
   */
  springState(): SpringState {
    const st = this.stateScratch;
    const tr = this.physics.getTransform(this.body);
    this.posScratch.x = mToPx(tr.x);
    this.posScratch.y = mToPx(tr.y);
    const g = this.hooks.gravityAt?.(this.posScratch) ?? this.physics.getGravity();
    const m = Math.hypot(g.x, g.y);
    // the same down as downHere() (gravityDown), without its allocations
    this.downScratch.x = m < 0.05 ? 0 : g.x / m;
    this.downScratch.y = m < 0.05 ? 1 : g.y / m;
    st.phase = this.phase;
    st.aim = this.aim;
    st.power = this.power;
    springLaunchVelocity(this.t, this.aim, this.power, this.downScratch, st.launchVel);
    st.gravity.x = g.x * PX_PER_M;
    st.gravity.y = g.y * PX_PER_M;
    st.armed = this.armedUntil >= this.simSec;
    return st;
  }

  private readonly stateScratch: SpringState = { phase: 'air', aim: 0, power: 0, launchVel: { x: 0, y: 0 }, gravity: { x: 0, y: 0 }, armed: false };
  private readonly posScratch: Vec2 = { x: 0, y: 0 };
  private readonly downScratch: Vec2 = { x: 0, y: 0 };

  /** May the legs start / continue a charge now? */
  private canCharge(): boolean {
    if (this.phase === 'air') return this.t.autoBounce === 1;
    if (this.phase === 'charging') return true;
    // any still, touching pose may charge: the launch aims against gravity, not along the body, so a hull
    // hooked over a corner or planted tilted on a slope (never `landed`) can always hop free (no soft-lock)
    if (this.landed) return true;
    const v = this.physics.getLinearVelocity(this.body);
    return Math.hypot(v.x, v.y) * PX_PER_M < this.t.landSpeed && this.touchingAnything();
  }

  protected control(frame: InputFrame, dt: number): void {
    const t = this.t;
    this.preVel = vMToPx(this.physics.getLinearVelocity(this.body));
    this.simSec = this.physics.simTime;

    // keyboard aim sweep (any phase: pre-aim in the air)
    const sweep = (frame.rotateCW ? 1 : 0) - (frame.rotateCCW ? 1 : 0);
    if (sweep !== 0 && this.source !== 'stick') this.aim = clamp(this.aim + sweep * t.aimRate * dt, -t.aimMax, t.aimMax);

    // emptyFrame() carries steer {0,0}: no steer. steerLength absent (a hand-made frame) = full deflection.
    const st = frame.steer;
    const len = st && (st.x !== 0 || st.y !== 0) ? (frame.steerLength ?? 1) : 0;
    const stickOn = len >= SPRING_STICK_DEADZONE;
    const charging = this.phase === 'charging' || (this.phase === 'air' && this.power > 0 && this.source !== null);

    if (frame.release && (charging || this.power > 0)) {
      this.cancel();
    } else if (stickOn && st && this.source !== 'keys') {
      const m = Math.hypot(st.x, st.y);
      if (st.y / m > SPRING_CANCEL_DOWN) {
        if (this.source === 'stick') this.cancel();
      } else if (this.canCharge()) {
        this.aim = clamp(Math.atan2(st.x, -st.y), -t.aimMax, t.aimMax);
        this.power = stickPower(len);
        this.beginCharge('stick');
      }
    } else if (this.source === 'stick') {
      // stick let go: jump with the last held aim + charge. Eased back to the centre first (the
      // charge drained under SPRING_MIN_STICK_POWER): cancelled, like centring = coast on the lander.
      if (this.power < SPRING_MIN_STICK_POWER) this.cancel();
      else this.release();
    } else if (frame.thrust) {
      if (this.canCharge()) {
        this.beginCharge('keys');
        this.power = Math.min(1, this.power + dt / t.chargeSec);
      }
    } else if (this.source === 'keys') {
      this.release();
    }

    if (this.phase !== 'air') this.rightUp();
  }

  /** The shell dropped all held input (pause / auto-pause / controls card): cancel, never jump on resume. */
  inputCleared(): void {
    if (this.source !== null || this.power > 0) this.cancel();
  }

  private beginCharge(source: 'stick' | 'keys'): void {
    if (this.source === null) {
      this.source = source;
      this.events({ type: 'springCharging', charging: true });
    }
    if (this.phase === 'ground') this.phase = 'charging';
  }

  private cancel(): void {
    const was = this.source !== null;
    this.source = null;
    this.power = 0;
    this.armedUntil = -1;
    if (this.phase === 'charging') this.phase = 'ground';
    if (was) this.events({ type: 'springCharging', charging: false });
  }

  /** The charge was let go: jump now (ground), or arm it (map 2, in the air). */
  private release(): void {
    this.source = null;
    this.events({ type: 'springCharging', charging: false });
    if (this.phase === 'air') {
      // map 2: a release just after a bounce still counts; otherwise arm for the next touchdown
      if (this.simSec - this.lastBounceAt <= this.t.bounceWindowSec) this.launch();
      else this.armedUntil = this.simSec + this.t.bounceWindowSec;
      return;
    }
    this.launch();
  }

  private launch(): void {
    const vel = springLaunchVelocity(this.t, this.aim, this.power, this.downHere());
    this.physics.setLinearVelocity(this.body, vPxToM(vel));
    this.physics.setAngularVelocity(this.body, 0);
    this.events({ type: 'springJump', power: this.power, vel });
    this.phase = 'air';
    this.airSec = 0;
    this.power = 0;
    this.armedUntil = -1;
    this.landed = false;
  }

  /** Capped upright PD torque while on the ground. */
  private rightUp(): void {
    if (!this.touchingAnything()) return;
    const t = this.t;
    const down = this.downHere();
    const upright = Math.atan2(-down.x, down.y);
    const angle = this.physics.getTransform(this.body).angle;
    const err = wrapPi(angle - upright);
    const w = this.physics.getAngularVelocity(this.body);
    const cap = (this.weight * t.legSpan * (this.legsSupported() && Math.abs(err) < TOPPLED_TILT ? RIGHT_CAP_LEGS : RIGHT_CAP_TOPPLED)) / PX_PER_M;
    const torque = clamp(-this.inertia * (t.uprightStiffness * err + t.uprightDamping * w), -cap, cap);
    if (torque !== 0) this.physics.applyTorque(this.body, torque);
  }

  protected override postStep(dt: number): void {
    if (this.phase !== 'air') {
      // walked / crumbled off the ground: falling. Map 1 drops a charge (no jumping off thin air).
      if (!this.touchingAnything()) {
        this.phase = 'air';
        this.airSec = LIFTOFF_SEC;
        if (this.t.autoBounce !== 1 && (this.source !== null || this.power > 0)) this.cancel();
      }
      return;
    }
    this.airSec += dt;
    if (this.airSec < LIFTOFF_SEC) return;
    const t = this.t;
    const down = this.downHere();
    const vin = this.preVel;
    const into = vin.x * down.x + vin.y * down.y; // speed into the ground (px/s)
    if (!this.legsSupported() || into < -RISING) {
      // toppled / wedged on a side: once it is still, it is on the ground (righting takes over)
      const v = vMToPx(this.physics.getLinearVelocity(this.body));
      const slow = Math.hypot(v.x, v.y) < t.landSpeed && this.touchingAnything();
      this.wedgedSec = slow ? this.wedgedSec + dt : 0;
      if (this.wedgedSec >= WEDGED_SEC) {
        this.wedgedSec = 0;
        this.phase = this.source === null ? 'ground' : 'charging';
      }
      return;
    }
    this.wedgedSec = 0;
    if (t.autoBounce === 1) {
      if (this.armedUntil >= this.simSec) {
        this.launch();
        return;
      }
      if (into > t.bounceMinSpeed) {
        const e = t.bounceRestitution;
        const out = { x: vin.x - (1 + e) * into * down.x, y: vin.y - (1 + e) * into * down.y };
        this.physics.setLinearVelocity(this.body, vPxToM(out));
        this.physics.setAngularVelocity(this.body, 0);
        this.lastBounceAt = this.simSec;
        this.airSec = 0;
        this.events({ type: 'springJump', power: 0, vel: out });
        return;
      }
    }
    // the springs soak the touchdown: stand where the legs met the ground
    this.physics.setLinearVelocity(this.body, { x: 0, y: 0 });
    this.physics.setAngularVelocity(this.body, 0);
    this.phase = 'ground';
    if (this.source === null) this.power = 0;
    else this.phase = 'charging';
  }

}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function wrapPi(a: number): number {
  let x = a % (2 * Math.PI);
  if (x > Math.PI) x -= 2 * Math.PI;
  if (x < -Math.PI) x += 2 * Math.PI;
  return x;
}

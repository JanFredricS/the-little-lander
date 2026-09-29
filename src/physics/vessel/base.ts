/**
 * Shared vessel core: hull body, fuel tank, hull integrity, impact damage /
 * crash, soft-land detection, engine flags + events, attached parts (goo).
 * Mode controllers (csm / lander / harpoon / harpoonThrust) subclass it and
 * implement control() (input -> forces, BEFORE step) and optionally
 * postStep() (once per physics step, AFTER step).
 *
 * Units: PhysicsApi in metres; everything reported (VesselState, events) in
 * world px. Tuning speeds are px/s.
 */

import { FIXED_DT } from '../../contracts';
import type {
  BodyHandle,
  ContactReport,
  CrashCause,
  FuelChangeReason,
  GameEventSink,
  HullChangeReason,
  InputFrame,
  PhysicsApi,
  RopeState,
  Vec2,
  VesselMode,
  VesselSpawn,
  VesselState,
} from '../../contracts';
import { bodyContacts, type BodyContact } from '../contactData';
import { bodyUp, type Cone } from '../geom';
import { stepContacts } from '../stepEvents';
import { PASS_THROUGH_TAGS, TAG_DEBRIS_BURNING, TAG_GOO, TAG_VESSEL, isDebrisTag } from '../tags';
import type { VesselOptions } from '../tuning';
import { mToPx, pxToM, vMToPx, vPxToM } from '../units';
import type { FlightVessel, VesselGeometry, VesselHooks } from './types';

/** The hull fields every mode tuning module provides. */
export interface HullTuning {
  density: number;
  friction: number;
  restitution: number;
  angularDamping: number;
  linearDamping: number;
  damageSpeed: number;
  crashSpeed: number;
  hitDamage: number;
  landSpeed: number;
  landAngle: number;
  landSpin: number;
  landSettleSec: number;
}

export interface ExhaustTuning {
  exhaustLength: number;
  exhaustHalfAngle: number;
}

export const DEFAULT_HOOKS: VesselHooks = {
  siteAt: () => undefined,
  anchorAt: () => ({ ok: true }),
};

/** Fuel drop between two 'burn' fuelChanged events. */
const FUEL_REPORT_STEP = 0.05;

export abstract class VesselBase implements FlightVessel {
  abstract readonly mode: VesselMode;
  readonly body: BodyHandle;
  readonly parts = new Set<BodyHandle>();
  hooks: VesselHooks = DEFAULT_HOOKS;

  protected fuel: number;
  protected hull: number;
  protected crashed = false;
  protected landed = false;
  protected attachedGoo = 0;
  protected engines = { main: false, left: false, right: false };
  /** Dry hull mass (kg), dry moment of inertia (kg·m²), dry weight at reference gravity (N). */
  protected readonly dryMass: number;
  protected readonly inertia: number;
  protected readonly weight: number;

  private lastFuelReport: number;
  /** Supporting bodies currently touching a part -> contact count. */
  private readonly support = new Map<BodyHandle, number>();
  private settle = 0;
  /** This step's touching contacts (null = physics without contact data -> `support` fallback). */
  private touching: BodyContact[] | null = null;
  private processedStep = -1;
  private linearDamping: number;

  constructor(
    protected readonly physics: PhysicsApi,
    spawn: VesselSpawn,
    protected readonly events: GameEventSink,
    readonly geometry: VesselGeometry,
    private readonly hullTuning: HullTuning,
    protected readonly options: VesselOptions,
    private readonly exhaust?: ExhaustTuning,
  ) {
    const t = hullTuning;
    this.linearDamping = t.linearDamping;
    this.body = physics.createBody({
      type: 'dynamic',
      position: vPxToM(spawn.pos),
      angle: spawn.angle ?? 0,
      linearVelocity: spawn.vel ? vPxToM(spawn.vel) : undefined,
      angularDamping: t.angularDamping,
      linearDamping: t.linearDamping,
      bullet: true,
      enableSleep: false,
      tag: TAG_VESSEL,
    });
    let inertia = 0;
    for (const b of geometry.boxes) {
      physics.addBox(this.body, pxToM(b.w / 2), pxToM(b.h / 2), { density: t.density, friction: t.friction, restitution: t.restitution }, vPxToM(b));
      const m = t.density * pxToM(b.w) * pxToM(b.h);
      inertia += (m * (pxToM(b.w) ** 2 + pxToM(b.h) ** 2)) / 12 + m * (pxToM(b.x) ** 2 + pxToM(b.y) ** 2);
    }
    this.parts.add(this.body);
    this.dryMass = physics.getMass(this.body);
    this.inertia = inertia;
    this.weight = this.dryMass * options.refGravity;
    this.fuel = clamp01(spawn.fuel ?? 1);
    this.hull = clamp01(spawn.hull ?? 1);
    this.lastFuelReport = this.fuel;
  }

  // -------------------------------------------------------- contract

  applyInput(frame: InputFrame, dt: number): void {
    if (this.crashed) {
      this.setEngines(false, false, false);
      return;
    }
    this.control(frame, dt);
  }

  state(): VesselState {
    this.processStep();
    const t = this.physics.getTransform(this.body);
    const v = this.physics.getLinearVelocity(this.body);
    const rope = this.ropeState();
    const s: VesselState = {
      mode: this.mode,
      pos: { x: mToPx(t.x), y: mToPx(t.y) },
      vel: vMToPx(v),
      angle: t.angle,
      angularVel: this.physics.getAngularVelocity(this.body),
      fuel: this.fuel,
      hull: this.hull,
      landed: this.landed,
      crashed: this.crashed,
      attachedGoo: this.attachedGoo,
      engines: { ...this.engines },
    };
    if (rope) s.ropeState = rope;
    return s;
  }

  destroy(): void {
    this.destroyExtras();
    if (this.physics.hasBody(this.body)) this.physics.destroyBody(this.body);
    this.parts.clear();
  }

  // ------------------------------------------------ FlightVessel API

  addPart(h: BodyHandle): void {
    this.parts.add(h);
  }

  removePart(h: BodyHandle): void {
    if (h !== this.body) this.parts.delete(h);
    this.support.delete(h);
  }

  addDrag(delta: number): void {
    this.linearDamping = Math.max(0, this.linearDamping + delta);
    this.physics.setDamping(this.body, this.linearDamping, this.hullTuning.angularDamping);
  }

  totalMass(): number {
    let m = 0;
    for (const p of this.parts) if (this.physics.hasBody(p)) m += this.physics.getMass(p);
    return m;
  }

  addFuel(delta: number, reason: FuelChangeReason): void {
    const before = this.fuel;
    this.fuel = clamp01(this.fuel + delta);
    const d = this.fuel - before;
    this.lastFuelReport = this.fuel;
    if (d !== 0) this.events({ type: 'fuelChanged', fuel: this.fuel, delta: d, reason });
  }

  damage(amount: number, reason: HullChangeReason): void {
    if (this.crashed || !(amount > 0)) return;
    const before = this.hull;
    this.hull = Math.max(0, this.hull - amount);
    this.events({ type: 'hullChanged', hull: this.hull, delta: this.hull - before, reason });
    if (this.hull <= 0) this.crash('hullDestroyed');
  }

  crash(cause: CrashCause, speedPx = 0): void {
    if (this.crashed) return;
    this.crashed = true;
    this.landed = false;
    if (this.hull > 0) {
      const before = this.hull;
      this.hull = 0;
      this.events({ type: 'hullChanged', hull: 0, delta: -before, reason: cause === 'boss' ? 'boss' : 'impact' });
    }
    this.setEngines(false, false, false);
    const t = this.physics.getTransform(this.body);
    this.events({ type: 'crash', cause, pos: vMToPx(t), speed: speedPx });
  }

  setAttachedGoo(n: number): void {
    this.attachedGoo = n;
  }

  exhaustCones(): Cone[] {
    const ex = this.exhaust;
    if (!ex || this.crashed) return [];
    const t = this.physics.getTransform(this.body);
    const up = bodyUp(t.angle);
    const down = { x: -up.x, y: -up.y };
    const cones: Cone[] = [];
    for (const n of this.geometry.nozzles) {
      if (!this.engines[n.engine]) continue;
      // Apex on the body's centre line (so blobs stuck on the lower hull are inside the cone).
      const apex = this.physics.localToWorld(this.body, { x: pxToM(n.x), y: 0 });
      cones.push({ apex: vMToPx(apex), dir: down, length: n.y + ex.exhaustLength, halfAngle: ex.exhaustHalfAngle });
    }
    return cones;
  }

  snapshot(): VesselSpawn {
    const t = this.physics.getTransform(this.body);
    return {
      pos: { x: mToPx(t.x), y: mToPx(t.y) },
      angle: t.angle,
      vel: vMToPx(this.physics.getLinearVelocity(this.body)),
      fuel: this.fuel,
      hull: this.hull,
    };
  }

  // ------------------------------------------------ for subclasses

  /** Map this tick's input to forces (only called while not crashed). */
  protected abstract control(frame: InputFrame, dt: number): void;

  /** Once per physics step, after it (rope flight, brittle timers ...). */
  protected postStep(_dt: number): void {}

  protected ropeState(): RopeState | undefined {
    return undefined;
  }

  /** Joints / extra bodies owned by the subclass. */
  protected destroyExtras(): void {}

  protected get canBurn(): boolean {
    return !this.crashed && this.fuel > 0;
  }

  protected setEngines(main: boolean, left: boolean, right: boolean): void {
    const e = this.engines;
    if (e.main === main && e.left === left && e.right === right) return;
    this.engines = { main, left, right };
    this.events({ type: 'enginesChanged', main, left, right });
  }

  /** Burn `fraction` of the tank (a 'burn' fuelChanged event every 5 %). */
  protected burnFuel(fraction: number): void {
    if (!(fraction > 0) || this.fuel <= 0) return;
    this.fuel = Math.max(0, this.fuel - fraction);
    if (this.lastFuelReport - this.fuel >= FUEL_REPORT_STEP || this.fuel === 0) {
      this.events({ type: 'fuelChanged', fuel: this.fuel, delta: this.fuel - this.lastFuelReport, reason: 'burn' });
      this.lastFuelReport = this.fuel;
    }
  }

  /** Force (N) along the body's nose direction, at the centre of mass. */
  protected thrust(force: number): void {
    const up = bodyUp(this.physics.getTransform(this.body).angle);
    this.physics.applyForce(this.body, { x: up.x * force, y: up.y * force });
  }

  /** Force (N) along the body's nose direction, applied at a body-local px point (torque from the offset). */
  protected thrustAt(force: number, localPx: Vec2): void {
    const up = bodyUp(this.physics.getTransform(this.body).angle);
    this.physics.applyForce(this.body, { x: up.x * force, y: up.y * force }, this.worldPoint(localPx));
  }

  /** Mount point in world metres from a body-local px point. */
  protected worldPoint(localPx: Vec2): Vec2 {
    return this.physics.localToWorld(this.body, vPxToM(localPx));
  }

  // ------------------------------------------------ internals

  private processStep(): void {
    const step = this.physics.steps;
    if (this.processedStep === step) return;
    this.processedStep = step;
    if (!this.crashed) this.readContacts();
    if (!this.crashed) this.postStep(FIXED_DT);
    this.updateLanded(FIXED_DT);
  }

  private readContacts(): void {
    const report = stepContacts(this.physics);
    const other = (a: BodyHandle, b: BodyHandle): BodyHandle | null => {
      const pa = this.parts.has(a);
      const pb = this.parts.has(b);
      return pa === pb ? null : pa ? b : a;
    };
    this.touching = this.readTouching();
    if (!this.touching) this.trackSupportFallback(report, other);

    // Impact events (audio/FX) + debris chip damage from the hit reports:
    // one per other body per step (a lander touching down on both legs is
    // one impact), fastest hit wins.
    const fastest = new Map<BodyHandle, { speed: number; point: Vec2 }>();
    for (const h of report.hits) {
      const o = other(h.a, h.b);
      if (o === null) continue;
      const prev = fastest.get(o);
      if (!prev || h.approachSpeed > prev.speed) fastest.set(o, { speed: h.approachSpeed, point: h.point });
    }
    let worst = 0;
    for (const [o, h] of fastest) {
      const tag = this.physics.hasBody(o) ? this.physics.getTag(o) : undefined;
      if (tag === TAG_GOO) continue;
      const speedPx = mToPx(h.speed);
      this.events({ type: 'impact', pos: vMToPx(h.point), speed: speedPx, with: tag ?? 'unknown' });
      if (isDebrisTag(tag)) {
        const d = this.options.tuning.debris;
        if (speedPx < d.minDamageSpeed) continue;
        const k = Math.min(2, speedPx / d.refSpeed) * (tag === TAG_DEBRIS_BURNING ? d.burningMultiplier : 1);
        this.damage(d.hitDamage * k, 'debris');
        if (this.crashed) return;
      } else if (!this.touching) worst = Math.max(worst, speedPx); // fallback: approach speed
    }

    // Hull damage from the solver's contact impulse (N·s): the velocity change
    // it forces on the vessel, J / mass, in px/s against damageSpeed/crashSpeed.
    // A heavy slow crate therefore hurts; a light fast pebble barely does.
    if (this.touching) {
      const impulse = new Map<BodyHandle, number>();
      for (const c of this.touching) {
        const tag = this.physics.getTag(c.other);
        if (tag === TAG_GOO || isDebrisTag(tag) || PASS_THROUGH_TAGS.has(tag ?? '')) continue;
        let j = 0;
        for (const p of c.points) j += p.impulse;
        impulse.set(c.other, (impulse.get(c.other) ?? 0) + j);
      }
      const mass = this.totalMass();
      for (const j of impulse.values()) worst = Math.max(worst, mToPx((j * SOLVER_IMPULSE_SCALE) / mass));
    }
    const t = this.hullTuning;
    if (worst >= t.crashSpeed) this.crash('impact', worst);
    else if (worst > t.damageSpeed) this.damage((t.hitDamage * (worst - t.damageSpeed)) / (t.crashSpeed - t.damageSpeed), 'impact');
  }

  /** Touching contacts of every part against non-part bodies (null without contact data). */
  private readTouching(): BodyContact[] | null {
    const out: BodyContact[] = [];
    for (const part of this.parts) {
      if (!this.physics.hasBody(part)) continue;
      const cs = bodyContacts(this.physics, part);
      if (!cs) return null;
      for (const c of cs) if (!this.parts.has(c.other) && this.physics.hasBody(c.other)) out.push(c);
    }
    return out;
  }

  /** Begin/end bookkeeping when the physics has no contact data. */
  private trackSupportFallback(report: ContactReport, other: (a: BodyHandle, b: BodyHandle) => BodyHandle | null): void {
    for (const p of report.begin) {
      const o = other(p.a, p.b);
      if (o !== null && this.isSupport(o)) this.support.set(o, (this.support.get(o) ?? 0) + 1);
    }
    for (const p of report.end) {
      const o = other(p.a, p.b);
      if (o === null || !this.support.has(o)) continue;
      const n = (this.support.get(o) ?? 1) - 1;
      if (n <= 0) this.support.delete(o);
      else this.support.set(o, n);
    }
    for (const b of [...this.support.keys()]) if (!this.physics.hasBody(b)) this.support.delete(b);
  }

  private isSupport(h: BodyHandle): boolean {
    return this.physics.hasBody(h) && !PASS_THROUGH_TAGS.has(this.physics.getTag(h) ?? '');
  }

  /** Unit "down" (gravity direction) at the vessel; world +y when gravity is ~0. */
  private gravityDown(posPx: Vec2): Vec2 {
    const g = this.hooks.gravityAt?.(posPx) ?? this.physics.getGravity();
    const m = Math.hypot(g.x, g.y);
    return m < 0.05 ? { x: 0, y: 1 } : { x: g.x / m, y: g.y / m };
  }

  /**
   * Legs down: a solid contact whose surface is below the vessel relative to
   * gravity (normal within ~45° of "down"), touching the lower part of the hull.
   */
  private legsDown(down: Vec2): boolean {
    if (!this.touching) return this.support.size > 0;
    const lowY = (this.geometry.h / 2) * LOW_REGION;
    for (const c of this.touching) {
      if (!this.isSupport(c.other)) continue;
      if (c.normal.x * down.x + c.normal.y * down.y < SUPPORT_NORMAL_COS) continue;
      for (const p of c.points) if (mToPx(this.physics.worldToLocal(this.body, p.point).y) >= lowY) return true;
    }
    return false;
  }

  private updateLanded(dt: number): void {
    if (this.crashed) {
      this.landed = false;
      return;
    }
    const t = this.hullTuning;
    const pose = this.physics.getTransform(this.body);
    const pos = { x: mToPx(pose.x), y: mToPx(pose.y) };
    const v = this.physics.getLinearVelocity(this.body);
    const down = this.touching ? this.gravityDown(pos) : { x: 0, y: 1 };
    // Tilt from "upright against gravity": body up vs -down.
    const up = bodyUp(pose.angle);
    const tilt = Math.acos(Math.max(-1, Math.min(1, -(up.x * down.x + up.y * down.y))));
    const ok =
      this.legsDown(down) &&
      mToPx(Math.hypot(v.x, v.y)) < t.landSpeed &&
      tilt < t.landAngle &&
      Math.abs(this.physics.getAngularVelocity(this.body)) < t.landSpin;
    this.settle = ok ? this.settle + dt : 0;
    const now = this.settle >= t.landSettleSec - 1e-9;
    if (now && !this.landed) {
      const siteId = this.hooks.siteAt(pos);
      this.events(siteId ? { type: 'softLand', pos, siteId } : { type: 'softLand', pos });
    }
    this.landed = now;
  }
}

/**
 * Box2D's per-point totalNormalImpulse accumulates the solve AND relax passes
 * of every sub-step, so it over-reads the physical impulse (resting contact:
 * 2·m·g·dt; vessel touchdowns measured 2.0–2.9 × m·v, median ≈ 2.4). This
 * scale maps it back so the px/s thresholds (damageSpeed / crashSpeed) keep
 * their approach-speed feel for ordinary touchdowns.
 */
const SOLVER_IMPULSE_SCALE = 1 / 2.4;
/** Contact normals within ~45° of gravity count as "surface below". */
const SUPPORT_NORMAL_COS = 0.7;
/** Supporting contact points must lie below this fraction of the half-height (body frame, 0 = centre). */
const LOW_REGION = 0.25;

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

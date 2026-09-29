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

    const t = this.hullTuning;
    for (const h of report.hits) {
      const o = other(h.a, h.b);
      if (o === null) continue;
      const tag = this.physics.hasBody(o) ? this.physics.getTag(o) : undefined;
      if (tag === TAG_GOO) continue;
      const speedPx = mToPx(h.approachSpeed);
      const pos = vMToPx(h.point);
      this.events({ type: 'impact', pos, speed: speedPx, with: tag ?? 'unknown' });
      if (isDebrisTag(tag)) {
        const d = this.options.tuning.debris;
        if (speedPx < d.minDamageSpeed) continue;
        const k = Math.min(2, speedPx / d.refSpeed) * (tag === TAG_DEBRIS_BURNING ? d.burningMultiplier : 1);
        this.damage(d.hitDamage * k, 'debris');
      } else if (speedPx >= t.crashSpeed) {
        this.crash('impact', speedPx);
      } else if (speedPx > t.damageSpeed) {
        this.damage((t.hitDamage * (speedPx - t.damageSpeed)) / (t.crashSpeed - t.damageSpeed), 'impact');
      }
      if (this.crashed) return;
    }
  }

  private isSupport(h: BodyHandle): boolean {
    return this.physics.hasBody(h) && !PASS_THROUGH_TAGS.has(this.physics.getTag(h) ?? '');
  }

  private updateLanded(dt: number): void {
    if (this.crashed) {
      this.landed = false;
      return;
    }
    const t = this.hullTuning;
    const pose = this.physics.getTransform(this.body);
    const v = this.physics.getLinearVelocity(this.body);
    const ok =
      this.support.size > 0 &&
      mToPx(Math.hypot(v.x, v.y)) < t.landSpeed &&
      Math.abs(pose.angle) < t.landAngle &&
      Math.abs(this.physics.getAngularVelocity(this.body)) < t.landSpin;
    this.settle = ok ? this.settle + dt : 0;
    const now = this.settle >= t.landSettleSec - 1e-9;
    if (now && !this.landed) {
      const pos = { x: mToPx(pose.x), y: mToPx(pose.y) };
      const siteId = this.hooks.siteAt(pos);
      this.events(siteId ? { type: 'softLand', pos, siteId } : { type: 'softLand', pos });
    }
    this.landed = now;
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

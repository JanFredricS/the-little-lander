/**
 * S0 placeholder vessel: one rectangle body with a single main thruster
 * (thrust along the nose) and torque rotation — enough to prove the loop,
 * physics, input and camera. S1 replaces it with the real per-mode
 * controllers (same VesselController contract).
 */

import type { BodyHandle, GameEventSink, InputFrame, PhysicsApi, VesselController, VesselMode, VesselSpawn, VesselState } from '../contracts';
import { mToPx, pxToM, vMToPx, vPxToM } from '../physics/units';

export const PLACEHOLDER_VESSEL = {
  /** Body size (px). */
  w: 20,
  h: 28,
  /** Thrust as a multiple of the vessel's weight at the level's base gravity. */
  thrustToWeight: 1.8,
  /** Angular acceleration from rotate input (rad/s²). */
  rotateAccel: 9,
  angularDamping: 3,
  /** Seconds of continuous burn per full tank. */
  burnSeconds: 25,
  /** Impact speed (m/s) that crashes the vessel. */
  crashSpeed: 6,
  /** Landed: max speed (m/s) and max |angle| (rad). */
  landSpeed: 0.6,
  landAngle: 0.35,
};

export const TAG_VESSEL = 'vessel';

export class PlaceholderVessel implements VesselController {
  readonly body: BodyHandle;
  private fuel: number;
  private hull: number;
  private crashed = false;
  private landed = false;
  private touching = 0;
  private engines = { main: false, left: false, right: false };
  private lastFuelReport: number;
  private readonly mass: number;
  private readonly inertia: number;

  constructor(
    private readonly physics: PhysicsApi,
    spawn: VesselSpawn,
    private readonly events: GameEventSink,
    readonly mode: VesselMode = 'csm',
  ) {
    const c = PLACEHOLDER_VESSEL;
    this.body = physics.createBody({
      type: 'dynamic',
      position: vPxToM(spawn.pos),
      angle: spawn.angle ?? 0,
      linearVelocity: spawn.vel ? vPxToM(spawn.vel) : undefined,
      angularDamping: c.angularDamping,
      bullet: true,
      tag: TAG_VESSEL,
    });
    const hw = pxToM(c.w / 2);
    const hh = pxToM(c.h / 2);
    physics.addBox(this.body, hw, hh, { density: 1, friction: 0.7, restitution: 0.05 });
    this.mass = physics.getMass(this.body);
    this.inertia = (this.mass * ((2 * hw) ** 2 + (2 * hh) ** 2)) / 12;
    this.fuel = spawn.fuel ?? 1;
    this.hull = spawn.hull ?? 1;
    this.lastFuelReport = this.fuel;
  }

  applyInput(frame: InputFrame, dt: number): void {
    const c = PLACEHOLDER_VESSEL;
    const main = !this.crashed && this.fuel > 0 && frame.thrust;
    if (main !== this.engines.main) {
      this.engines = { main, left: false, right: false };
      this.events({ type: 'enginesChanged', main, left: false, right: false });
    }
    if (this.crashed) return;
    if (main) {
      const g = this.physics.getGravity();
      const force = this.mass * Math.hypot(g.x, g.y) * c.thrustToWeight;
      const a = this.physics.getTransform(this.body).angle;
      // body "up" (nose) in y-down, clockwise-positive coordinates
      this.physics.applyForce(this.body, { x: Math.sin(a) * force, y: -Math.cos(a) * force });
      this.fuel = Math.max(0, this.fuel - dt / c.burnSeconds);
      if (this.lastFuelReport - this.fuel >= 0.05 || this.fuel === 0) {
        this.events({ type: 'fuelChanged', fuel: this.fuel, delta: this.fuel - this.lastFuelReport, reason: 'burn' });
        this.lastFuelReport = this.fuel;
      }
    }
    const rot = (frame.rotateCW ? 1 : 0) - (frame.rotateCCW ? 1 : 0);
    if (rot !== 0) this.physics.applyTorque(this.body, rot * c.rotateAccel * this.inertia);
  }

  state(): VesselState {
    const c = PLACEHOLDER_VESSEL;
    const t = this.physics.getTransform(this.body);
    const v = this.physics.getLinearVelocity(this.body);
    if (!this.crashed) this.readContacts();
    const speed = Math.hypot(v.x, v.y);
    const landedNow = !this.crashed && this.touching > 0 && speed < c.landSpeed && Math.abs(t.angle) < c.landAngle;
    if (landedNow && !this.landed) this.events({ type: 'softLand', pos: vMToPx(t) });
    this.landed = landedNow;
    return {
      mode: this.mode,
      pos: { x: mToPx(t.x), y: mToPx(t.y) },
      vel: vMToPx(v),
      angle: t.angle,
      angularVel: this.physics.getAngularVelocity(this.body),
      fuel: this.fuel,
      hull: this.hull,
      landed: this.landed,
      crashed: this.crashed,
      attachedGoo: 0,
      engines: { ...this.engines },
    };
  }

  /** Crash from outside (out of bounds, hazards). */
  crash(cause: 'outOfBounds' | 'crushed' | 'impact', speedPx = 0): void {
    if (this.crashed) return;
    this.crashed = true;
    this.hull = 0;
    const t = this.physics.getTransform(this.body);
    this.events({ type: 'hullChanged', hull: 0, delta: -1, reason: 'impact' });
    this.events({ type: 'crash', cause, pos: vMToPx(t), speed: speedPx });
  }

  destroy(): void {
    if (this.physics.hasBody(this.body)) this.physics.destroyBody(this.body);
  }

  private readContacts(): void {
    const report = this.physics.contacts();
    const mine = (p: { a: number; b: number }) => p.a === this.body || p.b === this.body;
    for (const p of report.begin) if (mine(p)) this.touching++;
    for (const p of report.end) if (mine(p)) this.touching = Math.max(0, this.touching - 1);
    for (const h of report.hits) {
      if (!mine(h)) continue;
      const other = h.a === this.body ? h.b : h.a;
      const speedPx = mToPx(h.approachSpeed);
      this.events({ type: 'impact', pos: vMToPx(h.point), speed: speedPx, with: this.physics.getTag(other) ?? 'unknown' });
      if (h.approachSpeed >= PLACEHOLDER_VESSEL.crashSpeed) {
        this.crash('impact', speedPx);
        return;
      }
    }
  }
}

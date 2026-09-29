/**
 * Goo balls. Spawners release weightless blobs while the vessel is within
 * triggerRadius (every intervalSec, up to maxAlive per spawner). Free blobs
 * steer toward the vessel (homingAccel, with drag capping their speed). On
 * contact with the hull they weld on (soft weld: they wobble), gain weight,
 * and add mass + linear drag to the vessel — stacking per blob.
 *
 * Burn-off: a blob (free or attached) that stays inside an active engine's
 * exhaust cone for more than burnSec is destroyed. Cones start on the hull
 * centre line, so blobs stuck to the LOWER hull can be burned off by
 * thrusting; blobs on the top stay until you shed the stage (mode switch).
 */

import type { BodyHandle, EntitySpec, GameEventSink, GooSpawnerEntity, JointHandle, PhysicsApi, Vec2 } from '../../contracts';
import { coneContains, dist } from '../geom';
import { stepContacts } from '../stepEvents';
import { TAG_GOO } from '../tags';
import type { PhysicsTuning } from '../tuning';
import { pxToM, vMToPx } from '../units';
import type { FlightVessel } from '../vessel/types';

/** Goo shapes share a negative group: blobs never collide with each other. */
const GOO_GROUP = -7;

export interface GooBall {
  id: number;
  body: BodyHandle;
  spawnerId: string;
  attached: boolean;
  joint: JointHandle | null;
  /** Seconds continuously inside an exhaust cone. */
  burn: number;
}

interface Spawner {
  e: GooSpawnerEntity;
  timer: number;
}

export class GooSystem {
  balls: GooBall[] = [];
  private readonly spawners: Spawner[];
  private nextId = 1;
  private attachedCount = 0;

  constructor(
    private readonly physics: PhysicsApi,
    entities: readonly EntitySpec[],
    private readonly tuning: PhysicsTuning['goo'],
    private readonly events: GameEventSink,
  ) {
    this.spawners = entities.filter((e): e is GooSpawnerEntity => e.kind === 'gooSpawner').map((e) => ({ e, timer: e.intervalSec }));
  }

  get attached(): number {
    return this.attachedCount;
  }

  /** Before physics.step(): homing forces on free blobs. */
  steer(vesselPos: Vec2): void {
    const target = { x: pxToM(vesselPos.x), y: pxToM(vesselPos.y) };
    for (const b of this.balls) {
      if (b.attached || !this.physics.hasBody(b.body)) continue;
      const accel = this.spawners.find((s) => s.e.id === b.spawnerId)?.e.homingAccel ?? 0;
      const p = this.physics.getTransform(b.body);
      const dx = target.x - p.x;
      const dy = target.y - p.y;
      const l = Math.hypot(dx, dy);
      if (l < 1e-6) continue;
      const f = this.physics.getMass(b.body) * accel;
      this.physics.applyForce(b.body, { x: (dx / l) * f, y: (dy / l) * f });
    }
  }

  /** After physics.step(): attach on contact, burn in exhaust, spawn. */
  update(vessel: FlightVessel, vesselPos: Vec2, dt: number): void {
    this.balls = this.balls.filter((b) => this.physics.hasBody(b.body));
    this.attachOnContact(vessel);
    this.burnOff(vessel, dt);
    for (const s of this.spawners) {
      if (dist(vesselPos, s.e) > s.e.triggerRadius) continue;
      s.timer += dt;
      const alive = this.balls.filter((b) => b.spawnerId === s.e.id).length;
      if (s.timer >= s.e.intervalSec - 1e-9 && alive < s.e.maxAlive) {
        s.timer = 0;
        this.spawn(s.e);
      }
    }
  }

  /** Spawn one free blob at world px `pos` (spawners, tests, physlab). */
  spawnAt(pos: Vec2, spawnerId: string): GooBall {
    const t = this.tuning;
    const body = this.physics.createBody({
      type: 'dynamic',
      position: { x: pxToM(pos.x), y: pxToM(pos.y) },
      gravityScale: 0,
      linearDamping: t.linearDamping,
      enableSleep: false,
      tag: TAG_GOO,
    });
    this.physics.addCircle(body, { x: 0, y: 0 }, pxToM(t.radius), { density: t.density, friction: 0.9, restitution: 0, group: GOO_GROUP, sensorEvents: false });
    const ball: GooBall = { id: this.nextId++, body, spawnerId, attached: false, joint: null, burn: 0 };
    this.balls.push(ball);
    return ball;
  }

  /** Detach (destroy) every blob welded to `vessel` — e.g. before the vessel is replaced. */
  dropAttached(vessel: FlightVessel): void {
    for (const b of this.balls) if (b.attached) this.remove(b, vessel, false);
    this.balls = this.balls.filter((b) => this.physics.hasBody(b.body));
  }

  bodies(): BodyHandle[] {
    return this.balls.map((b) => b.body);
  }

  destroy(): void {
    for (const b of this.balls) if (this.physics.hasBody(b.body)) this.physics.destroyBody(b.body);
    this.balls = [];
  }

  // ------------------------------------------------------------ internals

  private spawn(e: GooSpawnerEntity): void {
    this.spawnAt({ x: e.x, y: e.y }, e.id);
  }

  private attachOnContact(vessel: FlightVessel): void {
    const report = stepContacts(this.physics);
    for (const p of report.begin) {
      const ball = this.balls.find((b) => !b.attached && (b.body === p.a || b.body === p.b));
      if (!ball) continue;
      const other = ball.body === p.a ? p.b : p.a;
      if (!vessel.parts.has(other) || this.attachedCount >= this.tuning.maxAttached) continue;
      this.attach(ball, vessel);
    }
  }

  private attach(ball: GooBall, vessel: FlightVessel): void {
    const t = this.tuning;
    const anchor = this.physics.getTransform(ball.body);
    ball.joint = this.physics.createWeldJoint({
      bodyA: vessel.body,
      bodyB: ball.body,
      anchor: { x: anchor.x, y: anchor.y },
      linearHertz: t.weldHertz,
      angularHertz: t.weldHertz,
      dampingRatio: t.weldDamping,
    });
    ball.attached = true;
    ball.burn = 0;
    this.physics.setGravityScale(ball.body, 1);
    this.physics.setDamping(ball.body, 0, 0);
    vessel.addPart(ball.body);
    vessel.addDrag(t.attachedDrag);
    this.attachedCount++;
    vessel.setAttachedGoo(this.attachedCount);
    this.events({ type: 'gooAttached', gooId: ball.id, attached: this.attachedCount });
    if (t.attachDamage > 0) vessel.damage(t.attachDamage, 'goo');
  }

  private burnOff(vessel: FlightVessel, dt: number): void {
    const cones = vessel.exhaustCones();
    for (const b of this.balls) {
      const p = this.physics.getTransform(b.body);
      const pos = vMToPx(p);
      if (cones.length && cones.some((c) => coneContains(c, pos))) {
        b.burn += dt;
        if (b.burn > this.tuning.burnSec) this.remove(b, vessel, true);
      } else b.burn = 0;
    }
    this.balls = this.balls.filter((b) => this.physics.hasBody(b.body));
  }

  private remove(b: GooBall, vessel: FlightVessel, burned: boolean): void {
    if (b.attached) {
      vessel.removePart(b.body);
      vessel.addDrag(-this.tuning.attachedDrag);
      this.attachedCount = Math.max(0, this.attachedCount - 1);
      vessel.setAttachedGoo(this.attachedCount);
    }
    if (this.physics.hasBody(b.body)) this.physics.destroyBody(b.body);
    if (burned) this.events({ type: 'gooBurned', gooId: b.id, attached: this.attachedCount });
  }
}


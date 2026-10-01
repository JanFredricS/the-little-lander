/**
 * Physics wrapper — the ONLY module that imports box2d3-wasm. Implements the
 * frozen PhysicsApi (src/contracts/physics.ts). Adapted from pineapple-run's
 * wrapper, with runtime-mutable world gravity, per-body gravity scale, weld
 * joints, rope-style distance joints, contact/hit events and ray casts.
 *
 * bodyContacts() (touching contacts + solver impulses) joined the contract
 * as an S8 amendment; the vessels' soft-landing and hull damage use it.
 *
 * World convention: METRES, y-down, fixed 1/60 s step with 4 sub-steps.
 *
 * Memory: box2d3-wasm is an Emscripten/embind build.
 *  - Objects made with `new` (b2Vec2, b2Circle, b2Transform) and defs from
 *    `b2Default*Def()` live on the wasm heap and must be `.delete()`d.
 *  - FUNCTION return values (b2Body_GetPosition, b2MakeRot, events, ...) are
 *    fresh copies: `.delete()` them.
 *  - PROPERTY getters on a value object (`shapeDef.material`, `jointDef.base`,
 *    `event.point`, ...) return REFERENCES into the parent. Mutate/read them in
 *    place and never `.delete()` them.
 *  - Ids (b2BodyId, b2ShapeId, b2JointId, ...) are plain JS objects.
 */

import Box2DFactory from '#box2d-compat';
import type { MainModule, b2BodyId, b2ContactData, b2JointDef, b2JointId, b2ShapeDef, b2ShapeId, b2Vec2, b2WorldId } from '#box2d-compat';
import { FIXED_DT, SUB_STEPS } from '../contracts';
import type {
  BodyDef,
  BodyHandle,
  BodyPair,
  BodyTag,
  ContactHit,
  ContactReport,
  DistanceJointDef,
  JointHandle,
  MaterialDef,
  PhysicsApi,
  BodyContact,
  Pose,
  RayHit,
  RevoluteJointDef,
  SensorReport,
  Vec2,
  WeldJointDef,
  WorldOptions,
} from '../contracts';
import { signedArea } from './units';

let modulePromise: Promise<MainModule> | null = null;

/** Load (once) the single-threaded compat wasm build. */
export function loadPhysics(): Promise<MainModule> {
  modulePromise ??= Box2DFactory();
  return modulePromise;
}

interface BodyRecord {
  id: b2BodyId;
  tag: BodyTag | undefined;
  dynamic: boolean;
  shapeKeys: number[];
  prev: Pose;
  curr: Pose;
  /** Box2D reported the body awake after the last step (sleeping bodies' poses are not re-read). */
  awake: boolean;
  /** Linear velocity cache (vx, vy) valid until the next step / velocity write. */
  velOk: boolean;
  vx: number;
  vy: number;
}

interface JointRecord {
  id: b2JointId;
  kind: 'distance' | 'revolute' | 'weld';
  bodyA: BodyHandle;
  bodyB: BodyHandle;
  localA: Vec2;
  localB: Vec2;
  rope: boolean;
}

const EPS_DT = 1e-9;

export class PhysicsWorld implements PhysicsApi {
  private readonly worldId: b2WorldId;
  private readonly bodies = new Map<BodyHandle, BodyRecord>();
  private readonly joints = new Map<JointHandle, JointRecord>();
  /** Every live shape (shapeKey) -> owning body handle (contacts, sensors, rays). */
  private readonly shapeOwner = new Map<number, BodyHandle>();
  private nextBody = 1;
  private nextJoint = 1;
  private _steps = 0;
  private destroyed = false;
  private readonly v1: b2Vec2;
  private readonly v2: b2Vec2;
  /**
   * World gravity as Box2D stores it (float32-rounded), mirrored in JS:
   * getGravity() is polled every step (env gravity, vessels, systems) and the
   * embind getter allocates a wasm-backed vector each call.
   */
  private readonly gravity = { x: 0, y: 0 };

  static async create(options: WorldOptions = {}): Promise<PhysicsWorld> {
    return new PhysicsWorld(await loadPhysics(), options);
  }

  private constructor(
    private readonly b2: MainModule,
    options: WorldOptions,
  ) {
    this.v1 = new b2.b2Vec2(0, 0);
    this.v2 = new b2.b2Vec2(0, 0);
    const def = b2.b2DefaultWorldDef();
    const g = options.gravity ?? { x: 0, y: 9.8 };
    def.gravity = this.vec(this.v1, g.x, g.y);
    this.gravity.x = Math.fround(g.x);
    this.gravity.y = Math.fround(g.y);
    def.enableContinuous = true;
    def.hitEventThreshold = options.hitSpeedThreshold ?? 1;
    this.worldId = b2.b2CreateWorld(def);
    def.delete();
  }

  // ------------------------------------------------------------ lifecycle

  get steps(): number {
    return this._steps;
  }

  get simTime(): number {
    return this._steps * FIXED_DT;
  }

  step(dt: number): void {
    this.assertAlive();
    if (Math.abs(dt - FIXED_DT) > EPS_DT) throw new Error(`PhysicsWorld.step: dt must be FIXED_DT (got ${dt})`);
    this.b2.b2World_Step(this.worldId, FIXED_DT, SUB_STEPS);
    this._steps++;
    for (const rec of this.bodies.values()) {
      if (!rec.dynamic) continue;
      rec.velOk = false;
      // A body asleep before AND after this step did not move: skip the two
      // embind wrappers of a pose read (stutter round 2: per-step garbage).
      const awake = this.b2.b2Body_IsAwake(rec.id);
      if (!awake && !rec.awake) {
        const p = rec.prev;
        const c = rec.curr;
        p.x = c.x;
        p.y = c.y;
        p.angle = c.angle;
        continue;
      }
      rec.awake = awake;
      const t = rec.prev;
      rec.prev = rec.curr;
      rec.curr = t;
      this.readPose(rec.id, rec.curr);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.b2.b2DestroyWorld(this.worldId);
    this.v1.delete();
    this.v2.delete();
    this.bodies.clear();
    this.joints.clear();
    this.shapeOwner.clear();
    this.destroyed = true;
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  // -------------------------------------------------------------- gravity

  getGravity(): Vec2 {
    this.assertAlive();
    return { x: this.gravity.x, y: this.gravity.y };
  }

  setGravity(g: Vec2): void {
    this.assertAlive();
    if (!Number.isFinite(g.x) || !Number.isFinite(g.y)) throw new Error('setGravity: gravity must be finite');
    this.b2.b2World_SetGravity(this.worldId, this.vec(this.v1, g.x, g.y));
    this.gravity.x = Math.fround(g.x);
    this.gravity.y = Math.fround(g.y);
    // Sleeping bodies ignore a gravity change until woken: wake them all.
    for (const rec of this.bodies.values()) if (rec.dynamic) this.b2.b2Body_SetAwake(rec.id, true);
  }

  // --------------------------------------------------------------- bodies

  createBody(def: BodyDef): BodyHandle {
    this.assertAlive();
    const b2 = this.b2;
    const bd = b2.b2DefaultBodyDef();
    bd.type =
      def.type === 'static'
        ? b2.b2BodyType.b2_staticBody
        : def.type === 'kinematic'
          ? b2.b2BodyType.b2_kinematicBody
          : b2.b2BodyType.b2_dynamicBody;
    bd.position = this.vec(this.v1, def.position.x, def.position.y);
    if (def.angle) {
      const rot = b2.b2MakeRot(def.angle);
      bd.rotation = rot;
      rot.delete();
    }
    if (def.linearVelocity) bd.linearVelocity = this.vec(this.v1, def.linearVelocity.x, def.linearVelocity.y);
    if (def.angularVelocity !== undefined) bd.angularVelocity = def.angularVelocity;
    if (def.linearDamping !== undefined) bd.linearDamping = def.linearDamping;
    if (def.angularDamping !== undefined) bd.angularDamping = def.angularDamping;
    if (def.gravityScale !== undefined) bd.gravityScale = finite(def.gravityScale, 'gravityScale');
    if (def.bullet) bd.isBullet = true;
    if (def.enableSleep !== undefined) bd.enableSleep = def.enableSleep;
    if (def.fixedRotation) {
      const locks = bd.motionLocks; // reference into bd
      locks.angularZ = true;
    }
    const id = b2.b2CreateBody(this.worldId, bd);
    bd.delete();

    const handle = this.nextBody++;
    const pose: Pose = { x: 0, y: 0, angle: 0 };
    this.readPose(id, pose);
    this.bodies.set(handle, { id, tag: def.tag, dynamic: def.type !== 'static', shapeKeys: [], prev: { ...pose }, curr: pose, awake: true, velOk: false, vx: 0, vy: 0 });
    return handle;
  }

  destroyBody(h: BodyHandle): void {
    const rec = this.body(h);
    for (const [jh, j] of this.joints) if (j.bodyA === h || j.bodyB === h) this.joints.delete(jh);
    this.b2.b2DestroyBody(rec.id);
    for (const k of rec.shapeKeys) this.shapeOwner.delete(k);
    this.bodies.delete(h);
  }

  hasBody(h: BodyHandle): boolean {
    return this.bodies.has(h);
  }

  bodyHandles(): BodyHandle[] {
    return [...this.bodies.keys()];
  }

  getTag(h: BodyHandle): BodyTag | undefined {
    return this.bodies.get(h)?.tag;
  }

  addBox(h: BodyHandle, halfW: number, halfH: number, material: MaterialDef = {}, center?: Vec2, angle = 0): void {
    const b2 = this.b2;
    const rec = this.body(h);
    if (!(halfW > 0 && halfH > 0)) throw new Error('addBox: half extents must be > 0');
    const rot = b2.b2MakeRot(angle);
    const poly = b2.b2MakeOffsetBox(halfW, halfH, this.vec(this.v1, center?.x ?? 0, center?.y ?? 0), rot);
    rot.delete();
    const sd = this.shapeDef(rec, material);
    const shapeId = b2.b2CreatePolygonShape(rec.id, sd, poly);
    sd.delete();
    poly.delete();
    this.recordShape(h, rec, shapeId);
  }

  addPolygon(h: BodyHandle, vertices: readonly Vec2[], material: MaterialDef = {}): void {
    const b2 = this.b2;
    const rec = this.body(h);
    if (vertices.length < 3 || vertices.length > 8) throw new Error('addPolygon: need 3..8 vertices');
    const pts = vertices.map((v) => new b2.b2Vec2(v.x, v.y));
    const hull = b2.b2ComputeHull(pts);
    pts.forEach((p) => p.delete());
    if (hull.count < 3) {
      hull.delete();
      throw new Error('addPolygon: degenerate polygon');
    }
    const poly = b2.b2MakePolygon(hull, 0);
    hull.delete();
    const sd = this.shapeDef(rec, material);
    const shapeId = b2.b2CreatePolygonShape(rec.id, sd, poly);
    sd.delete();
    poly.delete();
    this.recordShape(h, rec, shapeId);
  }

  addCircle(h: BodyHandle, center: Vec2, radius: number, material: MaterialDef = {}): void {
    const b2 = this.b2;
    const rec = this.body(h);
    if (!(radius > 0)) throw new Error('addCircle: radius must be > 0');
    const c = new b2.b2Circle();
    c.center = this.vec(this.v1, center.x, center.y);
    c.radius = radius;
    const sd = this.shapeDef(rec, material);
    const shapeId = b2.b2CreateCircleShape(rec.id, sd, c);
    sd.delete();
    c.delete();
    this.recordShape(h, rec, shapeId);
  }

  /**
   * See PhysicsApi.addChain. Box2D v3 open chains use their first and last
   * points as GHOST vertices only, so we append a ghost at each end
   * (continuing the end segment) and every given segment collides. Loops are
   * normalised to positive signed area so the solid side is inside.
   */
  addChain(h: BodyHandle, points: readonly Vec2[], loop: boolean, material: MaterialDef = {}): void {
    const b2 = this.b2;
    const rec = this.body(h);
    let pts: Vec2[];
    if (loop) {
      if (points.length < 3) throw new Error('addChain: a loop needs at least 3 points');
      pts = points.map((p) => ({ ...p }));
      if (signedArea(pts) < 0) pts.reverse();
      if (pts.length < 4) {
        // Box2D needs >= 4 chain points: split every edge in two.
        pts = pts.flatMap((p, i) => {
          const q = pts[(i + 1) % pts.length]!;
          return [p, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }];
        });
      }
    } else {
      if (points.length < 2) throw new Error('addChain: need at least 2 points');
      const ghost = (from: Vec2, to: Vec2): Vec2 => {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.hypot(dx, dy) || 1;
        return { x: to.x + dx / len, y: to.y + dy / len };
      };
      const n = points.length;
      pts = [ghost(points[1]!, points[0]!), ...points.map((p) => ({ ...p })), ghost(points[n - 2]!, points[n - 1]!)];
    }
    const cd = b2.b2DefaultChainDef();
    const vecs = pts.map((p) => new b2.b2Vec2(p.x, p.y));
    cd.SetPoints(vecs);
    cd.count = vecs.length;
    cd.isLoop = loop;
    const f = cd.filter; // reference into cd
    f.categoryBits = material.category ?? 0x0001;
    f.maskBits = material.mask ?? 0xffff;
    if (material.group) f.groupIndex = material.group;
    const chainId = b2.b2CreateChain(rec.id, cd);
    vecs.forEach((v) => v.delete());
    cd.delete();
    // NOTE: b2ChainDef.SetMaterials() in box2d3-wasm 5.2.0 corrupts the
    // material (friction reads as 0), so set it per segment after creation.
    const segCount = b2.b2Chain_GetSegmentCount(chainId);
    const segments = b2.b2Chain_GetSegments(chainId, segCount) as b2ShapeId[];
    for (const s of segments) {
      b2.b2Shape_SetFriction(s, material.friction ?? 0.8);
      b2.b2Shape_SetRestitution(s, material.restitution ?? 0.1);
      this.recordShape(h, rec, s);
    }
  }

  addSensorBox(h: BodyHandle, halfW: number, halfH: number, center?: Vec2): void {
    const b2 = this.b2;
    const rec = this.body(h);
    const rot = b2.b2MakeRot(0);
    const poly = b2.b2MakeOffsetBox(halfW, halfH, this.vec(this.v1, center?.x ?? 0, center?.y ?? 0), rot);
    rot.delete();
    const sd = this.sensorDef();
    const shapeId = b2.b2CreatePolygonShape(rec.id, sd, poly);
    sd.delete();
    poly.delete();
    this.recordShape(h, rec, shapeId);
  }

  addSensorCircle(h: BodyHandle, center: Vec2, radius: number): void {
    const b2 = this.b2;
    const rec = this.body(h);
    const c = new b2.b2Circle();
    c.center = this.vec(this.v1, center.x, center.y);
    c.radius = radius;
    const sd = this.sensorDef();
    const shapeId = b2.b2CreateCircleShape(rec.id, sd, c);
    sd.delete();
    c.delete();
    this.recordShape(h, rec, shapeId);
  }

  // ------------------------------------------------------------ kinematics

  /**
   * Current pose. Served from the pose cache: rec.curr is read from Box2D
   * after every step (all non-static bodies), at creation and on
   * setTransform, which are the only ways a pose changes. Reading Box2D
   * again here allocated two embind wrappers per call, and this is polled
   * several times per step (vessel state, debris cleanup, gravity zones).
   */
  getTransform(h: BodyHandle): Pose {
    const c = this.body(h).curr;
    return { x: c.x, y: c.y, angle: c.angle };
  }

  getInterpolatedTransform(h: BodyHandle, alpha: number): Pose {
    const rec = this.body(h);
    if (!rec.dynamic) return { ...rec.curr };
    return lerpPose(rec.prev, rec.curr, alpha);
  }

  setTransform(h: BodyHandle, position: Vec2, angle: number): void {
    const rec = this.body(h);
    const rot = this.b2.b2MakeRot(angle);
    this.b2.b2Body_SetTransform(rec.id, this.vec(this.v1, position.x, position.y), rot);
    rot.delete();
    // A teleport must not be interpolated across.
    this.readPose(rec.id, rec.curr);
    rec.prev = { ...rec.curr };
    rec.awake = true;
    rec.velOk = false;
  }

  /** Cached per step (each Box2D read allocates an embind wrapper; several systems poll the same body). */
  getLinearVelocity(h: BodyHandle): Vec2 {
    const rec = this.body(h);
    if (!rec.velOk) {
      const v = this.b2.b2Body_GetLinearVelocity(rec.id);
      rec.vx = v.x;
      rec.vy = v.y;
      v.delete();
      rec.velOk = true;
    }
    return { x: rec.vx, y: rec.vy };
  }

  setLinearVelocity(h: BodyHandle, v: Vec2): void {
    const rec = this.body(h);
    this.b2.b2Body_SetLinearVelocity(rec.id, this.vec(this.v1, v.x, v.y));
    rec.velOk = false;
    rec.awake = true;
  }

  getAngularVelocity(h: BodyHandle): number {
    return this.b2.b2Body_GetAngularVelocity(this.body(h).id);
  }

  setAngularVelocity(h: BodyHandle, w: number): void {
    this.b2.b2Body_SetAngularVelocity(this.body(h).id, w);
  }

  setDamping(h: BodyHandle, linear: number, angular: number): void {
    const id = this.body(h).id;
    this.b2.b2Body_SetLinearDamping(id, linear);
    this.b2.b2Body_SetAngularDamping(id, angular);
  }

  getMass(h: BodyHandle): number {
    return this.b2.b2Body_GetMass(this.body(h).id);
  }

  getGravityScale(h: BodyHandle): number {
    return this.b2.b2Body_GetGravityScale(this.body(h).id);
  }

  setGravityScale(h: BodyHandle, scale: number): void {
    const id = this.body(h).id;
    this.b2.b2Body_SetGravityScale(id, finite(scale, 'gravityScale'));
    this.b2.b2Body_SetAwake(id, true);
  }

  applyForce(h: BodyHandle, force: Vec2, point?: Vec2): void {
    const id = this.body(h).id;
    if (point) this.b2.b2Body_ApplyForce(id, this.vec(this.v1, force.x, force.y), this.vec(this.v2, point.x, point.y), true);
    else this.b2.b2Body_ApplyForceToCenter(id, this.vec(this.v1, force.x, force.y), true);
  }

  applyImpulse(h: BodyHandle, impulse: Vec2, point?: Vec2): void {
    const rec = this.body(h);
    rec.velOk = false;
    rec.awake = true;
    const id = rec.id;
    if (point) this.b2.b2Body_ApplyLinearImpulse(id, this.vec(this.v1, impulse.x, impulse.y), this.vec(this.v2, point.x, point.y), true);
    else this.b2.b2Body_ApplyLinearImpulseToCenter(id, this.vec(this.v1, impulse.x, impulse.y), true);
  }

  applyTorque(h: BodyHandle, torque: number): void {
    this.b2.b2Body_ApplyTorque(this.body(h).id, torque, true);
  }

  localToWorld(h: BodyHandle, p: Vec2): Vec2 {
    return applyPose(this.getTransform(h), p);
  }

  worldToLocal(h: BodyHandle, p: Vec2): Vec2 {
    return inversePose(this.getTransform(h), p);
  }

  // --------------------------------------------------------------- joints

  createDistanceJoint(def: DistanceJointDef): JointHandle {
    const b2 = this.b2;
    const a = this.body(def.bodyA);
    const b = this.body(def.bodyB);
    const localA = this.worldToLocal(def.bodyA, def.anchorA);
    const localB = this.worldToLocal(def.bodyB, def.anchorB);
    const jd = b2.b2DefaultDistanceJointDef();
    this.fillJointBase(jd.base, a.id, b.id, localA, localB, def.collideConnected ?? false);
    const len = Math.max(0.01, def.length ?? Math.hypot(def.anchorB.x - def.anchorA.x, def.anchorB.y - def.anchorA.y));
    jd.length = len;
    const rope = def.rope ?? false;
    if (rope) {
      const minLength = def.minLength ?? 0.05;
      const maxLength = def.maxLength ?? len;
      if (!(minLength > 0) || !(maxLength >= minLength)) throw new Error('createDistanceJoint: need 0 < minLength <= maxLength');
      jd.enableSpring = true; // 0 Hz spring = no force inside the range: slack rope
      jd.hertz = 0;
      jd.dampingRatio = 0;
      jd.enableLimit = true;
      jd.minLength = minLength;
      jd.maxLength = maxLength;
    } else if (def.hertz !== undefined && def.hertz > 0) {
      jd.enableSpring = true;
      jd.hertz = def.hertz;
      jd.dampingRatio = def.dampingRatio ?? 0;
    }
    const id = b2.b2CreateDistanceJoint(this.worldId, jd);
    jd.delete();
    return this.addJoint({ id, kind: 'distance', bodyA: def.bodyA, bodyB: def.bodyB, localA, localB, rope });
  }

  createRevoluteJoint(def: RevoluteJointDef): JointHandle {
    const b2 = this.b2;
    const a = this.body(def.bodyA);
    const b = this.body(def.bodyB);
    const localA = this.worldToLocal(def.bodyA, def.anchor);
    const localB = this.worldToLocal(def.bodyB, def.anchor);
    const jd = b2.b2DefaultRevoluteJointDef();
    this.fillJointBase(jd.base, a.id, b.id, localA, localB, def.collideConnected ?? false);
    if (def.motor) {
      jd.enableMotor = true;
      jd.motorSpeed = def.motor.speed;
      jd.maxMotorTorque = def.motor.maxTorque;
    }
    const id = b2.b2CreateRevoluteJoint(this.worldId, jd);
    jd.delete();
    return this.addJoint({ id, kind: 'revolute', bodyA: def.bodyA, bodyB: def.bodyB, localA, localB, rope: false });
  }

  createWeldJoint(def: WeldJointDef): JointHandle {
    const b2 = this.b2;
    const a = this.body(def.bodyA);
    const b = this.body(def.bodyB);
    const localA = this.worldToLocal(def.bodyA, def.anchor);
    const localB = this.worldToLocal(def.bodyB, def.anchor);
    const jd = b2.b2DefaultWeldJointDef();
    const base = jd.base;
    this.fillJointBase(base, a.id, b.id, localA, localB, false);
    // Keep the bodies' CURRENT relative angle (frames carry each body's inverse rotation).
    const angA = this.getTransform(def.bodyA).angle;
    const angB = this.getTransform(def.bodyB).angle;
    const fa = base.localFrameA;
    const qa = b2.b2MakeRot(-angA);
    fa.q = qa;
    qa.delete();
    const fb = base.localFrameB;
    const qb = b2.b2MakeRot(-angB);
    fb.q = qb;
    qb.delete();
    jd.linearHertz = def.linearHertz ?? 0;
    jd.angularHertz = def.angularHertz ?? 0;
    jd.linearDampingRatio = def.dampingRatio ?? 1;
    jd.angularDampingRatio = def.dampingRatio ?? 1;
    const id = b2.b2CreateWeldJoint(this.worldId, jd);
    jd.delete();
    return this.addJoint({ id, kind: 'weld', bodyA: def.bodyA, bodyB: def.bodyB, localA, localB, rope: false });
  }

  destroyJoint(j: JointHandle): void {
    const rec = this.joint(j);
    this.b2.b2DestroyJoint(rec.id, true);
    this.joints.delete(j);
  }

  hasJoint(j: JointHandle): boolean {
    return this.joints.has(j);
  }

  setJointLength(j: JointHandle, length: number): void {
    const rec = this.joint(j);
    if (rec.kind !== 'distance') throw new Error('setJointLength: not a distance joint');
    const len = Math.max(0.01, finite(length, 'length'));
    if (rec.rope) {
      const min = this.b2.b2DistanceJoint_GetMinLength(rec.id);
      this.b2.b2DistanceJoint_SetLengthRange(rec.id, Math.min(min, len), len);
    }
    this.b2.b2DistanceJoint_SetLength(rec.id, len);
    this.b2.b2Joint_WakeBodies(rec.id);
  }

  getJointCurrentLength(j: JointHandle): number {
    const rec = this.joint(j);
    if (rec.kind !== 'distance') throw new Error('getJointCurrentLength: not a distance joint');
    return this.b2.b2DistanceJoint_GetCurrentLength(rec.id);
  }

  getJointForce(j: JointHandle): Vec2 {
    const f = this.b2.b2Joint_GetConstraintForce(this.joint(j).id);
    const out = { x: f.x, y: f.y };
    f.delete();
    return out;
  }

  getJointAnchors(j: JointHandle): { a: Vec2; b: Vec2 } {
    const rec = this.joint(j);
    return { a: this.localToWorld(rec.bodyA, rec.localA), b: this.localToWorld(rec.bodyB, rec.localB) };
  }

  // ------------------------------------------------------ queries & events

  rayCast(from: Vec2, to: Vec2, ignore: readonly BodyHandle[] = []): RayHit | null {
    this.assertAlive();
    const b2 = this.b2;
    const total = { x: to.x - from.x, y: to.y - from.y };
    let start = 0; // fraction of the full ray already skipped
    const filter = b2.b2DefaultQueryFilter();
    try {
      for (let guard = 0; guard < 16 && start < 1; guard++) {
        const ox = from.x + total.x * start;
        const oy = from.y + total.y * start;
        const rest = 1 - start;
        const res = b2.b2World_CastRayClosest(this.worldId, this.vec(this.v1, ox, oy), this.vec(this.v2, total.x * rest, total.y * rest), filter);
        try {
          if (!res.hit) return null;
          const fraction = start + res.fraction * rest;
          const body = this.shapeOwner.get(shapeKey(res.shapeId));
          if (body === undefined || ignore.includes(body)) {
            // step just past this hit and continue
            const len = Math.hypot(total.x, total.y) || 1;
            start = fraction + 1e-4 / len;
            continue;
          }
          const p = res.point;
          const n = res.normal;
          return { body, point: { x: p.x, y: p.y }, normal: { x: n.x, y: n.y }, fraction };
        } finally {
          res.delete();
        }
      }
      return null;
    } finally {
      filter.delete();
    }
  }

  contacts(): ContactReport {
    this.assertAlive();
    const ev = this.b2.b2World_GetContactEvents(this.worldId);
    const begin: BodyPair[] = [];
    const end: BodyPair[] = [];
    const hits: ContactHit[] = [];
    try {
      for (let i = 0; i < ev.beginCount; i++) {
        const e = ev.GetBeginEvent(i);
        const p = this.pair(e.shapeIdA, e.shapeIdB);
        e.delete();
        if (p) begin.push(p);
      }
      for (let i = 0; i < ev.endCount; i++) {
        const e = ev.GetEndEvent(i); // plain value object: nothing to free
        const p = this.pair(e.shapeIdA, e.shapeIdB);
        if (p) end.push(p);
      }
      for (let i = 0; i < ev.hitCount; i++) {
        const e = ev.GetHitEvent(i);
        const p = this.pair(e.shapeIdA, e.shapeIdB);
        if (p) {
          const pt = e.point;
          const n = e.normal;
          hits.push({ ...p, point: { x: pt.x, y: pt.y }, normal: { x: n.x, y: n.y }, approachSpeed: e.approachSpeed });
        }
        e.delete();
      }
    } finally {
      ev.delete();
    }
    return { begin, end, hits };
  }

  sensorEvents(): SensorReport {
    this.assertAlive();
    const ev = this.b2.b2World_GetSensorEvents(this.worldId);
    const out: SensorReport = { begin: [], end: [] };
    try {
      for (let i = 0; i < ev.beginCount; i++) {
        const e = ev.GetBeginEvent(i); // plain value object
        const p = this.pair(e.sensorShapeId, e.visitorShapeId);
        if (p) out.begin.push({ sensor: p.a, visitor: p.b });
      }
      for (let i = 0; i < ev.endCount; i++) {
        const e = ev.GetEndEvent(i); // plain value object
        const p = this.pair(e.sensorShapeId, e.visitorShapeId);
        if (p) out.end.push({ sensor: p.a, visitor: p.b });
      }
    } finally {
      ev.delete();
    }
    return out;
  }

  /**
   * Touching contacts of `h` with the last step's solver impulses.
   */
  bodyContacts(h: BodyHandle): BodyContact[] {
    const rec = this.body(h);
    const cap = this.b2.b2Body_GetContactCapacity(rec.id);
    if (cap <= 0) return [];
    const data = this.b2.b2Body_GetContactData(rec.id, cap) as b2ContactData[];
    const out: BodyContact[] = [];
    // Ownership (embind): each array entry and each GetPoint() result is an
    // owned copy and must be deleted; `.manifold`, `.normal` and `.point` are
    // views INTO their parent and must NOT be deleted (double free).
    for (const d of data) {
      try {
        const m = d.manifold;
        const a = this.shapeOwner.get(shapeKey(d.shapeIdA));
        const b = this.shapeOwner.get(shapeKey(d.shapeIdB));
        if (a === undefined || b === undefined || m.pointCount === 0) continue;
        const selfIsA = a === h;
        const sign = selfIsA ? 1 : -1; // manifold normal points A -> B
        const nv = m.normal;
        const normal = { x: nv.x * sign, y: nv.y * sign };
        const points: BodyContact['points'] = [];
        for (let i = 0; i < m.pointCount; i++) {
          const mp = m.GetPoint(i);
          const pt = mp.point;
          points.push({ point: { x: pt.x, y: pt.y }, impulse: mp.totalNormalImpulse });
          mp.delete();
        }
        out.push({ other: selfIsA ? b : a, normal, points });
      } finally {
        d.delete();
      }
    }
    return out;
  }

  /** Bytes allocated on the wasm heap (leak checks in tests). */
  heapBytesInUse(): number {
    return this.b2.GetMemoryStats().uordblks;
  }

  // ------------------------------------------------------------ internals

  private assertAlive(): void {
    if (this.destroyed) throw new Error('PhysicsWorld used after destroy()');
  }

  private body(h: BodyHandle): BodyRecord {
    this.assertAlive();
    const rec = this.bodies.get(h);
    if (!rec) throw new Error(`unknown body handle ${h}`);
    return rec;
  }

  private joint(j: JointHandle): JointRecord {
    this.assertAlive();
    const rec = this.joints.get(j);
    if (!rec) throw new Error(`unknown joint handle ${j}`);
    return rec;
  }

  private pair(a: b2ShapeId, b: b2ShapeId): BodyPair | null {
    const ba = this.shapeOwner.get(shapeKey(a));
    const bb = this.shapeOwner.get(shapeKey(b));
    return ba === undefined || bb === undefined ? null : { a: ba, b: bb };
  }

  private recordShape(h: BodyHandle, rec: BodyRecord, shapeId: b2ShapeId): void {
    const k = shapeKey(shapeId);
    this.shapeOwner.set(k, h);
    rec.shapeKeys.push(k);
  }

  private addJoint(rec: JointRecord): JointHandle {
    const h = this.nextJoint++;
    this.joints.set(h, rec);
    return h;
  }

  private vec(v: b2Vec2, x: number, y: number): b2Vec2 {
    v.x = x;
    v.y = y;
    return v;
  }

  private readPose(id: b2BodyId, out: Pose): void {
    const p = this.b2.b2Body_GetPosition(id);
    const q = this.b2.b2Body_GetRotation(id);
    out.x = p.x;
    out.y = p.y;
    out.angle = Math.atan2(q.s, q.c);
    p.delete();
    q.delete();
  }

  private fillJointBase(base: b2JointDef, a: b2BodyId, b: b2BodyId, localA: Vec2, localB: Vec2, collideConnected: boolean): void {
    const b2 = this.b2;
    base.bodyIdA = a;
    base.bodyIdB = b;
    base.collideConnected = collideConnected;
    const identity = b2.b2MakeRot(0);
    const fa = new b2.b2Transform();
    fa.p = this.vec(this.v1, localA.x, localA.y);
    fa.q = identity;
    base.localFrameA = fa;
    const fb = new b2.b2Transform();
    fb.p = this.vec(this.v2, localB.x, localB.y);
    fb.q = identity;
    base.localFrameB = fb;
    fa.delete();
    fb.delete();
    identity.delete();
  }

  private shapeDef(rec: BodyRecord, m: MaterialDef): b2ShapeDef {
    const sd = this.b2.b2DefaultShapeDef();
    sd.density = m.density ?? 1;
    const mat = sd.material; // reference into sd
    mat.friction = m.friction ?? 0.6;
    mat.restitution = m.restitution ?? 0;
    const f = sd.filter; // reference into sd
    f.categoryBits = m.category ?? 0x0001;
    f.maskBits = m.mask ?? 0xffff;
    if (m.group) f.groupIndex = m.group;
    sd.enableContactEvents = true;
    sd.enableHitEvents = rec.dynamic;
    sd.enableSensorEvents = m.sensorEvents ?? rec.dynamic;
    return sd;
  }

  private sensorDef(): b2ShapeDef {
    const sd = this.b2.b2DefaultShapeDef();
    sd.density = 0;
    sd.isSensor = true;
    sd.enableSensorEvents = true;
    return sd;
  }
}

function finite(v: number, name: string): number {
  if (!Number.isFinite(v)) throw new Error(`${name} must be finite`);
  return v;
}

/** Map key of a live shape id (Box2D reuses an index with a new generation). */
function shapeKey(id: b2ShapeId): number {
  return id.index1 * 65536 + id.generation;
}

export function applyPose(t: Pose, p: Vec2): Vec2 {
  const c = Math.cos(t.angle);
  const s = Math.sin(t.angle);
  return { x: t.x + c * p.x - s * p.y, y: t.y + s * p.x + c * p.y };
}

export function inversePose(t: Pose, p: Vec2): Vec2 {
  const c = Math.cos(t.angle);
  const s = Math.sin(t.angle);
  const dx = p.x - t.x;
  const dy = p.y - t.y;
  return { x: c * dx + s * dy, y: -s * dx + c * dy };
}

/** Interpolate two poses (shortest-arc angle). alpha clamped to [0,1]. */
export function lerpPose(a: Pose, b: Pose, alpha: number): Pose {
  const t = Math.min(1, Math.max(0, alpha));
  let da = b.angle - a.angle;
  if (da > Math.PI) da -= 2 * Math.PI;
  else if (da < -Math.PI) da += 2 * Math.PI;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: a.angle + da * t };
}

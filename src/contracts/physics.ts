/**
 * FROZEN (S0; round 15 amendment: VesselMode 'spring', PhysicsApi.setBodyEnabled). The physics layer (implemented by src/physics/engine.ts on
 * box2d3-wasm) and the vessel-controller interface S1 implements.
 *
 * PhysicsApi units: METRES, m/s, m/s², kg, N, N·s, radians (clockwise-
 * positive, y-down). Convert with PX_PER_M at the boundary (see
 * src/physics/units.ts helpers pxToM / mToPx). Body and joint handles are
 * plain integers; nothing outside src/physics/engine.ts touches Box2D.
 *
 * Event queries (contacts(), sensorEvents()) report what happened during the
 * LAST step() only. Game logic runs once per fixed step, right after step(),
 * and must read them then (catch-up frames step several times).
 */

import type { InputFrame } from './input';
import type { Pose, Vec2 } from './common';
import type { GameEventSink } from './events';

export type BodyHandle = number;
export type JointHandle = number;

/**
 * Free-form body tag for classifying contacts (e.g. 'vessel', 'terrain',
 * 'debris', 'goo', 'orb', 'anchor', 'boss'). Convention: lowerCamel string.
 */
export type BodyTag = string;

export type BodyType = 'static' | 'kinematic' | 'dynamic';

export interface BodyDef {
  type: BodyType;
  /** Metres. */
  position: Vec2;
  angle?: number;
  linearVelocity?: Vec2;
  angularVelocity?: number;
  /** Default 0 (momentum is real; see PLAN "CSM mode"). */
  linearDamping?: number;
  angularDamping?: number;
  /** Multiplier on world gravity; 1 = normal (default), 0 = weightless, -1 = inverted. */
  gravityScale?: number;
  /** Continuous collision vs other dynamic bodies (fast debris, the vessel). */
  bullet?: boolean;
  /** Keep rotation fixed. */
  fixedRotation?: boolean;
  /** Default true. */
  enableSleep?: boolean;
  tag?: BodyTag;
}

/** Collision filter: a shape collides with another iff (catA & maskB) && (catB & maskA), unless same negative group. */
export interface CollisionFilter {
  /** Bit(s) this shape is (16-bit). Default 0x0001. */
  category?: number;
  /** Bits this shape collides with (16-bit). Default 0xffff. */
  mask?: number;
  /** Shapes sharing the same NEGATIVE group never collide. */
  group?: number;
}

export interface MaterialDef extends CollisionFilter {
  /** kg/m². Default 1. */
  density?: number;
  /** Default 0.6. */
  friction?: number;
  /** Default 0. */
  restitution?: number;
  /** Report sensor overlaps (see addSensor*). Default: true on dynamic bodies. */
  sensorEvents?: boolean;
}

export interface DistanceJointDef {
  bodyA: BodyHandle;
  bodyB: BodyHandle;
  /** World anchors (m). */
  anchorA: Vec2;
  anchorB: Vec2;
  /** Rest length (m); defaults to the anchors' current distance. */
  length?: number;
  /**
   * ROPE behaviour: slack below maxLength, taut at maxLength (spring enabled
   * with 0 Hz + limit [minLength, maxLength]). Default false = rigid rod.
   */
  rope?: boolean;
  /** Rope limits (m). Defaults: minLength 0.05, maxLength = length. */
  minLength?: number;
  maxLength?: number;
  /** Spring (rod mode only). */
  hertz?: number;
  dampingRatio?: number;
  collideConnected?: boolean;
}

export interface RevoluteJointDef {
  bodyA: BodyHandle;
  bodyB: BodyHandle;
  /** World pin point (m). */
  anchor: Vec2;
  collideConnected?: boolean;
  motor?: { speed: number; maxTorque: number };
}

export interface WeldJointDef {
  bodyA: BodyHandle;
  bodyB: BodyHandle;
  /** World weld point (m). */
  anchor: Vec2;
  /** 0 = rigid (default). Soft welds wobble (goo). */
  linearHertz?: number;
  angularHertz?: number;
  dampingRatio?: number;
}

export interface RayHit {
  body: BodyHandle;
  /** World point (m). */
  point: Vec2;
  normal: Vec2;
  /** 0..1 along the ray. */
  fraction: number;
}

export interface BodyPair {
  a: BodyHandle;
  b: BodyHandle;
}

/** A collision whose approach speed exceeded the hit threshold (crash detection). */
export interface ContactHit extends BodyPair {
  /** World point (m). */
  point: Vec2;
  /** Unit normal, from a to b. */
  normal: Vec2;
  /** Closing speed along the normal at impact (m/s, >= 0). */
  approachSpeed: number;
}

export interface ContactReport {
  /** Pairs that started touching during the last step. */
  begin: BodyPair[];
  /** Pairs that stopped touching during the last step (dead bodies dropped). */
  end: BodyPair[];
  /** Impacts faster than hitSpeedThreshold during the last step. */
  hits: ContactHit[];
}

export interface SensorReport {
  begin: { sensor: BodyHandle; visitor: BodyHandle }[];
  end: { sensor: BodyHandle; visitor: BodyHandle }[];
}

export interface WorldOptions {
  /** m/s², y-down. Default {0, 9.8}. */
  gravity?: Vec2;
  /** Min approach speed (m/s) reported in ContactReport.hits. Default 1. */
  hitSpeedThreshold?: number;
}

/**
 * A touching contact of a queried body (S8 amendment): manifold points with
 * the solver impulses of the last step. Soft-landing (legs-down normals) and
 * impulse-based hull damage are built on it.
 */
export interface BodyContactPoint {
  /** World point (m). */
  point: Vec2;
  /** Total normal impulse (N·s) the solver applied at this point during the last step (all sub-steps). */
  impulse: number;
}

export interface BodyContact {
  other: BodyHandle;
  /** Unit normal (world) pointing FROM the queried body TOWARD `other`. */
  normal: Vec2;
  points: BodyContactPoint[];
}

export interface PhysicsApi {
  /** Fixed steps taken. */
  readonly steps: number;
  /** steps × FIXED_DT (seconds). */
  readonly simTime: number;

  /**
   * Advance one fixed step with SUB_STEPS sub-steps. `dt` must be FIXED_DT;
   * it is a parameter only so call sites stay explicit (other values throw).
   */
  step(dt: number): void;
  /** Free all wasm memory. The world is unusable afterwards. */
  destroy(): void;

  // gravity — runtime-mutable (ramps, zones)
  getGravity(): Vec2;
  setGravity(g: Vec2): void;

  // bodies
  createBody(def: BodyDef): BodyHandle;
  destroyBody(h: BodyHandle): void;
  hasBody(h: BodyHandle): boolean;
  getTag(h: BodyHandle): BodyTag | undefined;
  /**
   * Round 15: take a body out of the simulation (false) or put it back (true). A disabled
   * body has no contacts and is skipped by ray casts (one-way platforms toggle per step).
   */
  setBodyEnabled(h: BodyHandle, enabled: boolean): void;
  isBodyEnabled(h: BodyHandle): boolean;
  /** Box centred at `center` (body-local m, default origin), half extents in m. */
  addBox(h: BodyHandle, halfW: number, halfH: number, material?: MaterialDef, center?: Vec2, angle?: number): void;
  /** Convex polygon, 3..8 body-local vertices (m). */
  addPolygon(h: BodyHandle, vertices: readonly Vec2[], material?: MaterialDef): void;
  addCircle(h: BodyHandle, center: Vec2, radius: number, material?: MaterialDef): void;
  /**
   * Terrain chain (body-local m), one-sided. Open chain: points run in the
   * direction such that the SOLID side is on the RIGHT of travel in y-down
   * screen space (left -> right = solid below, i.e. ground; right -> left =
   * solid above, i.e. ceiling). Loop: any convex or concave closed outline,
   * solid inside (the engine normalises winding).
   */
  addChain(h: BodyHandle, points: readonly Vec2[], loop: boolean, material?: MaterialDef): void;
  /** Non-colliding sensor box; overlaps are reported by sensorEvents(). */
  addSensorBox(h: BodyHandle, halfW: number, halfH: number, center?: Vec2): void;
  addSensorCircle(h: BodyHandle, center: Vec2, radius: number): void;

  getTransform(h: BodyHandle): Pose;
  /** Pose between the previous and the current step (alpha 0..1), for rendering. */
  getInterpolatedTransform(h: BodyHandle, alpha: number): Pose;
  setTransform(h: BodyHandle, position: Vec2, angle: number): void;
  getLinearVelocity(h: BodyHandle): Vec2;
  setLinearVelocity(h: BodyHandle, v: Vec2): void;
  getAngularVelocity(h: BodyHandle): number;
  setAngularVelocity(h: BodyHandle, w: number): void;
  setDamping(h: BodyHandle, linear: number, angular: number): void;
  getMass(h: BodyHandle): number;
  getGravityScale(h: BodyHandle): number;
  setGravityScale(h: BodyHandle, scale: number): void;
  /** Force (N) for the NEXT step only (Box2D clears forces each step). `point` = world m, default centre of mass. */
  applyForce(h: BodyHandle, force: Vec2, point?: Vec2): void;
  /** Instant impulse (N·s). `point` = world m, default centre of mass. */
  applyImpulse(h: BodyHandle, impulse: Vec2, point?: Vec2): void;
  applyTorque(h: BodyHandle, torque: number): void;
  /** Body-local point -> world (current pose). */
  localToWorld(h: BodyHandle, p: Vec2): Vec2;
  /** World point -> body-local (current pose). */
  worldToLocal(h: BodyHandle, p: Vec2): Vec2;
  /** Current touching contacts of `h` (manifold points, impulses of the last step). S8 amendment. */
  bodyContacts(h: BodyHandle): BodyContact[];

  // joints
  createDistanceJoint(def: DistanceJointDef): JointHandle;
  createRevoluteJoint(def: RevoluteJointDef): JointHandle;
  createWeldJoint(def: WeldJointDef): JointHandle;
  destroyJoint(j: JointHandle): void;
  hasJoint(j: JointHandle): boolean;
  /** Distance joints: set rest length (rod) or max length (rope). */
  setJointLength(j: JointHandle, length: number): void;
  /** Distance joints: current anchor distance (m). */
  getJointCurrentLength(j: JointHandle): number;
  /** Constraint force on body B during the last step (N). For breakage. */
  getJointForce(j: JointHandle): Vec2;
  /** World anchor positions (m) on body A and B. */
  getJointAnchors(j: JointHandle): { a: Vec2; b: Vec2 };

  // queries & events
  /** Closest hit along from -> to (world m); `ignore` bodies are skipped. */
  rayCast(from: Vec2, to: Vec2, ignore?: readonly BodyHandle[]): RayHit | null;
  contacts(): ContactReport;
  sensorEvents(): SensorReport;
}

// ------------------------------------------------------------ vessels (S1)

/**
 * 'spring' (round 15): the lander with dead thrusters, hopping on spring legs - aim +
 * charge on the ground, then pure ballistics (src/physics/vessel/spring.ts).
 */
export type VesselMode = 'csm' | 'lander' | 'harpoon' | 'harpoonThrust' | 'spring';

export const VESSEL_MODES: readonly VesselMode[] = ['csm', 'lander', 'harpoon', 'harpoonThrust', 'spring'];

export interface RopeGunState {
  /** 0 or 1 (the pod carries 1-2 guns). */
  gun: number;
  /** 'idle' = stowed, 'flying' = harpoon in the air, 'anchored' = rope attached. */
  phase: 'idle' | 'flying' | 'anchored';
  /** Harpoon head (flying) or anchor point (anchored), world px. */
  head?: Vec2;
  /** Current rope length (px) when anchored. */
  length?: number;
  maxLength: number;
  /** Seconds until a brittle anchor breaks; undefined if not brittle. */
  brittleTimeLeft?: number;
}

export interface RopeState {
  guns: readonly RopeGunState[];
}

/** Snapshot of the vessel for HUD / camera / render / objectives. WORLD PX. */
export interface VesselState {
  mode: VesselMode;
  /** Centre of mass, world px. */
  pos: Vec2;
  /** px/s. */
  vel: Vec2;
  /** Radians, clockwise-positive, 0 = upright. */
  angle: number;
  angularVel: number;
  /** 0..1 of tank. */
  fuel: number;
  /** 0..1 hull integrity. 0 = destroyed. */
  hull: number;
  /** Resting on a surface, upright and slow (soft-landed). */
  landed: boolean;
  crashed: boolean;
  /** Goo balls currently welded to the hull. */
  attachedGoo: number;
  /** Which engines fire THIS tick (for flame sprites / audio). */
  engines: { main: boolean; left: boolean; right: boolean };
  /** Harpoon modes only. */
  ropeState?: RopeState;
}

/** A vessel of one mode, owning its bodies in a PhysicsApi world. */
export interface VesselController {
  readonly mode: VesselMode;
  /** Apply one tick of input (dt = FIXED_DT) BEFORE PhysicsApi.step(). */
  applyInput(frame: InputFrame, dt: number): void;
  /** Read state AFTER PhysicsApi.step(); also where crash/landing events are emitted. */
  state(): VesselState;
  /** The main hull body (camera target, zone tests). */
  readonly body: BodyHandle;
  /** Remove all bodies/joints this controller created. */
  destroy(): void;
}

export interface VesselSpawn {
  /** World px. */
  pos: Vec2;
  angle?: number;
  /** px/s. */
  vel?: Vec2;
  /** 0..1, default 1. */
  fuel?: number;
  /** 0..1, default 1. */
  hull?: number;
}

/** How S1 exposes controllers (one factory per mode, same signature). */
export type VesselControllerFactory = (physics: PhysicsApi, spawn: VesselSpawn, events: GameEventSink) => VesselController;

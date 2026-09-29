/**
 * FROZEN (S0). Level data. A level is a plain data module exporting a
 * LevelSpec (S6/S7 write them; the level loader spawns them; S1 physics
 * interprets zones/entities; S2/S4 render them).
 *
 * Units: positions/sizes WORLD PX (y-down, origin top-left of the level);
 * accelerations m/s²; times simulation seconds. See constants.ts.
 *
 * Validation: src/levels/validate.ts (validateLevel) checks every structural
 * rule documented here; every LevelSpec must pass it (enforced by tests).
 */

import type { LevelId, Rect, Seed, Vec2 } from './common';
import type { CutsceneId } from './cutscene';
import type { SpriteName, TerrainMaterial, ThemeId } from './art';
import type { VesselMode } from './physics';

// ----------------------------------------------------------------- triggers

/** When something happens (mode switch, debris start, door close ...). */
export type TriggerSpec =
  | { kind: 'start' } // at level start
  | { kind: 'time'; atSec: number } // simulation seconds since level start
  | { kind: 'enterRegion'; rect: Rect } // vessel centre enters rect
  | { kind: 'objective'; objectiveId: string }; // an objective completes

// ------------------------------------------------------------------ terrain

/** Rendering hints for a terrain piece (S2 tiles / S4 terrain mesh). */
export interface TerrainStyle {
  material: TerrainMaterial;
  /** Draw a surface strip ('top'/'bottom'/'side' tiles) along exposed edges. Default true. */
  surface?: boolean;
  /** 0..1 density of 'decor' tiles. Default 0.2. */
  decorDensity?: number;
  /** Picks tile variants deterministically. Default: hash of the piece id. */
  variantSeed?: Seed;
}

/**
 * One collidable terrain piece.
 *  - 'ground': open polyline, points ordered left -> right (increasing x
 *    along the walk), SOLID BELOW the line. Render fills down to the world
 *    bottom.
 *  - 'ceiling': open polyline, points ordered left -> right, SOLID ABOVE.
 *    Render fills up to the world top.
 *  - 'polygon': closed outline (do NOT repeat the first point), solid
 *    inside, any winding, may be concave, must not self-intersect. Islands,
 *    rocks, pillars, beams.
 * At least 2 points for open pieces, 3 for polygons. All points inside the
 * world rect (inclusive).
 */
export interface TerrainPiece {
  id: string;
  kind: 'ground' | 'ceiling' | 'polygon';
  points: readonly Vec2[];
  style: TerrainStyle;
  /** Default 0.8. */
  friction?: number;
  /** Default 0.1. */
  restitution?: number;
}

export interface TerrainSpec {
  pieces: readonly TerrainPiece[];
}

// ----------------------------------------------------------------- entities

interface EntityBase {
  /** Unique within the level. Referenced by objectives / events. */
  id: string;
  /** World px (centre of the entity unless stated). */
  x: number;
  y: number;
}

/** Decorative or solid prop (crates, gantries, parked vessels, machinery). */
export interface StaticPropEntity extends EntityBase {
  kind: 'staticProp';
  sprite: SpriteName;
  w: number;
  h: number;
  /** Collidable box of w×h. Default false (decor only). */
  solid?: boolean;
  angle?: number;
  /** Draw in front of the vessel. Default false. */
  foreground?: boolean;
}

/** Spawns falling dynamic debris inside `area` while active. */
export interface DebrisSpawnerEntity extends EntityBase {
  kind: 'debrisSpawner';
  area: Rect;
  /** Pieces per second. */
  ratePerSec: number;
  /** Piece size range (px). */
  sizeMin: number;
  sizeMax: number;
  /** Initial velocity (px/s). Default {0, 0}. */
  velocity?: Vec2;
  /** Burning debris (Map 2 finale) — visual + extra hull damage. */
  burning?: boolean;
  /** Default { kind: 'start' }. */
  activate?: TriggerSpec;
  /** Stops spawning after this many seconds active. Default: never. */
  durationSec?: number;
  seed?: Seed;
}

/** Releases goo balls that home on the hull. */
export interface GooSpawnerEntity extends EntityBase {
  kind: 'gooSpawner';
  /** Spawns only while the vessel is within this distance (px). */
  triggerRadius: number;
  intervalSec: number;
  /** Max goo alive from this spawner. */
  maxAlive: number;
  /** Homing acceleration (m/s²). */
  homingAccel: number;
}

/** Collectible tech orb: points + fuel. */
export interface OrbEntity extends EntityBase {
  kind: 'orb';
  points: number;
  /** Fraction of tank refilled (0..1). */
  fuelRefill: number;
}

/** A marked landing zone where a beacon can be planted. (x, y) = centre of the landing surface. */
export interface BeaconSiteEntity extends EntityBase {
  kind: 'beaconSite';
  /** Landing zone width (px). */
  w: number;
  /** Seconds to hold still after touchdown to plant. */
  holdSec: number;
}

/** Kinematic floating island / platform moving along a path. */
export interface MovingIslandEntity extends EntityBase {
  kind: 'movingIsland';
  /** Outline relative to (x, y), px, same rules as a 'polygon' TerrainPiece. */
  outline: readonly Vec2[];
  style: TerrainStyle;
  /** Waypoints relative to (x, y), px; the first should be {0,0}. */
  path: readonly Vec2[];
  /** Seconds for one full traversal. */
  periodSec: number;
  motion: 'loop' | 'pingpong';
}

/** Hanging vine (chain of small bodies), anchored at (x, y) top. */
export interface VineEntity extends EntityBase {
  kind: 'vine';
  /** Total length (px). */
  length: number;
  segments: number;
}

/** A door that slides shut (hangar). (x, y) = centre of the OPEN slot. */
export interface BlastDoorEntity extends EntityBase {
  kind: 'blastDoor';
  w: number;
  h: number;
  /** Door closes from this edge. */
  from: 'top' | 'bottom' | 'left' | 'right';
  close: TriggerSpec;
  closeDurationSec: number;
}

export type CreatureSpecies = 'dragonBird' | 'skyWhale' | 'caveEel' | 'glowMoth';

/** Scripted creature. Background creatures are decor only (parallax depth). */
export interface CreatureEntity extends EntityBase {
  kind: 'creature';
  species: CreatureSpecies;
  /** Waypoints relative to (x, y), px. */
  path: readonly Vec2[];
  speed: number; // px/s
  /** 0 = in the world plane, >0 = behind (parallax factor 1 - depth). Default 0. */
  depth?: number;
  scale?: number;
  /** Scripted action for gameplay creatures (e.g. 'seizeCsm'). */
  action?: string;
  activate?: TriggerSpec;
}

/** Boss spawn point + arena. */
export interface BossSpawnEntity extends EntityBase {
  kind: 'bossSpawn';
  bossId: 'keeper';
  arena: Rect;
}

export interface FuelPickupEntity extends EntityBase {
  kind: 'fuelPickup';
  /** Fraction of tank (0..1). */
  amount: number;
}

/** Level exit. (x, y) = centre of the docking/landing surface. */
export interface ExitDockEntity extends EntityBase {
  kind: 'exitDock';
  w: number;
  h: number;
  /** Must soft-land inside it (true) or merely enter the rect (false). */
  requireLanding: boolean;
}

export type EntitySpec =
  | StaticPropEntity
  | DebrisSpawnerEntity
  | GooSpawnerEntity
  | OrbEntity
  | BeaconSiteEntity
  | MovingIslandEntity
  | VineEntity
  | BlastDoorEntity
  | CreatureEntity
  | BossSpawnEntity
  | FuelPickupEntity
  | ExitDockEntity;

export type EntityKind = EntitySpec['kind'];

export const ENTITY_KINDS: readonly EntityKind[] = [
  'staticProp',
  'debrisSpawner',
  'gooSpawner',
  'orb',
  'beaconSite',
  'movingIsland',
  'vine',
  'blastDoor',
  'creature',
  'bossSpawn',
  'fuelPickup',
  'exitDock',
];

// -------------------------------------------------------------------- zones

/** Inside `rect`, world gravity is REPLACED by `gravity` for the vessel and dynamic bodies. */
export interface GravityZone {
  kind: 'gravityZone';
  id: string;
  rect: Rect;
  /** m/s², y-down. {0,-9.8} = inverted. */
  gravity: Vec2;
}

export interface WindGust {
  atSec: number;
  durationSec: number;
  /** m/s² applied to the vessel (mass-independent). */
  accel: Vec2;
}

/** Timed lateral wind events. Applies inside `rect` (default: whole level). */
export interface WindGustSchedule {
  kind: 'windGustSchedule';
  id: string;
  rect?: Rect;
  gusts: readonly WindGust[];
  /** Repeat the schedule every N seconds. Default: no repeat. */
  repeatEverySec?: number;
}

/**
 * Radiation source (the malfunctioning sun). Pulses periodically; a pulse
 * hits the vessel if it is within `range` and the segment emitter -> vessel
 * is not blocked by terrain (line of sight).
 */
export interface RadiationEmitter {
  kind: 'radiationEmitter';
  id: string;
  x: number;
  y: number;
  range: number;
  periodSec: number;
  /** Warning (glow build-up) before each pulse. */
  warnSec: number;
  /** Fraction of CURRENT fuel lost per hit (PLAN: 0.3). */
  fuelLoss: number;
  /** First pulse time. Default periodSec. */
  firstAtSec?: number;
}

/** Harpoon anchors made inside `rect` break `breakAfterSec` after attaching. */
export interface BrittleRegion {
  kind: 'brittleRegion';
  id: string;
  rect: Rect;
  breakAfterSec: number;
}

export type ZoneSpec = GravityZone | WindGustSchedule | RadiationEmitter | BrittleRegion;

// --------------------------------------------------------------- objectives

export type ObjectiveSpec =
  | { kind: 'reachExit'; id: string; exitId: string }
  | { kind: 'plantBeacons'; id: string; count: number; siteIds: readonly string[] }
  | { kind: 'collectOrbs'; id: string; count: number }
  | { kind: 'surviveBoss'; id: string; bossEntityId: string };

// -------------------------------------------------------------------- level

/** Gravity changing with vessel progress along an axis (asteroid descent). */
export interface GravityRamp {
  axis: 'x' | 'y';
  /** World px along `axis` where the ramp starts / ends. */
  from: number;
  to: number;
  /** m/s² at `from` and at `to` (linear in between, clamped outside). Replaces LevelSpec.gravity. */
  gravityFrom: Vec2;
  gravityTo: Vec2;
}

export interface ModeSwitch {
  to: VesselMode;
  trigger: TriggerSpec;
  /** Played (game paused) when the switch happens. */
  cutscene?: CutsceneId;
}

export interface CameraHints {
  /** Scroll emphasis: 'horizontal' (default) or 'vertical' (descents / escapes). */
  bias?: 'horizontal' | 'vertical';
  /** Look ahead along velocity (px). Default 60. */
  lookAhead?: number;
}

export interface LevelSpec {
  id: LevelId;
  title: string;
  themeId: ThemeId;
  /** Mode at spawn. */
  vesselMode: VesselMode;
  /** Optional mid-level switch (Map 3 CSM -> lander). */
  modeSwitch?: ModeSwitch;
  /** World px. Everything must lie inside [0,w]×[0,h]. Real maps: 8k-24k px long. */
  worldSize: { w: number; h: number };
  /** Vessel spawn (world px, angle radians). */
  spawn: { x: number; y: number; angle?: number };
  /** Starting fuel fraction, default 1. */
  startFuel?: number;
  /** World gravity (m/s², y-down), e.g. {0, 9.8}. */
  gravity: Vec2;
  gravityRamp?: GravityRamp;
  terrain: TerrainSpec;
  entities: readonly EntitySpec[];
  zones: readonly ZoneSpec[];
  /** All must complete to finish the level (in any order unless stated by the level). */
  objectives: readonly ObjectiveSpec[];
  cutsceneBefore?: CutsceneId;
  cutsceneAfter?: CutsceneId;
  camera?: CameraHints;
  /** Parallax/tile seed. Default: hash of id. */
  seed?: Seed;
  /** Debug levels are hidden from level select. */
  debug?: boolean;
}

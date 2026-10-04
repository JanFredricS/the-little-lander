/**
 * FROZEN (S0; round 12 amendment: LevelSpec.checkpoints; round 14: CheckpointSpec 'enterRegion'; round 15: TerrainPiece.oneWay, CrumblePlatformEntity oneWay / regrowSec; round 17: ZoneSpec NoAnchorRegion). Level data. A level is a plain data module exporting a
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
  /**
   * Round 20: 'crystalSpire' = drawn as a translucent faceted crystal by the render layer
   * (src/render/crystalSpires.ts) instead of fill tiles - a 'polygon' in s7SpirePoints
   * order (base corner, one flank, the tip's two points, the other flank, base corner).
   * Visual only. Default: tiles.
   */
  look?: 'crystalSpire';
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
  /** Harpoons can anchor to this piece. Default true. */
  anchorable?: boolean;
  /**
   * Blocks radiation line of sight (casts a sun shadow). Default true. false =
   * translucent rock (e.g. The Hollow's crystal stalactites): still solid,
   * still anchorable unless `anchorable: false`, but radiation shines through.
   */
  castsShadow?: boolean;
  /**
   * Round 15: a jump-through platform ('polygon' pieces only). The vessel passes through
   * it from below / the side and stands on it from above: it collides only while the
   * vessel's lowest point is above the piece's top surface (src/levels/systems/oneWay.ts).
   * The gate switches the whole body, so loose bodies (debris) meet it only while it is on. Default false.
   */
  oneWay?: boolean;
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
  /** Solid AND simulated as a dynamic body (crates to knock around). Implies solid. Default false. */
  dynamic?: boolean;
  /** kg/m² for dynamic props. Default 1. */
  density?: number;
  angle?: number;
  /** Draw in front of the vessel. Default false. */
  foreground?: boolean;
  /**
   * Round 20: per-placement colour multiply (0xRRGGBB) and opacity (0..1) over the themed
   * sprite - a per-level look without touching the shared prop art. Visual only. Default none.
   */
  tint?: number;
  alpha?: number;
  /** Round 20: cycle the sprite's frames at this rate (frames/s); frame 0 under reduced motion. Default static. */
  animFps?: number;
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
  /**
   * Round 16: a harmful world-plane creature (depth 0, no action). Touching it stings: this
   * hull fraction (0 < harm < 1, a sting, never an instakill from full hull) plus a knock
   * away from it, at most once per CREATURE_HIT_COOLDOWN_SEC. Default: harmless (decor).
   */
  harm?: number;
  /** Round 16: contact radius (px) around the creature centre. Default 14 × |scale|. */
  hitRadius?: number;
  /** Round 16: knock-back speed (px/s) added to the vessel - horizontal, away from the creature (audit M1: a sideways swat keeps a hop's vertical arc). Default 150. */
  knock?: number;
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

/**
 * Level exit. (x, y) = centre of the docking/landing surface; the dock
 * region spans x ± w/2 horizontally and from y - h up to y (it sits ON the
 * surface). The vessel centre must be inside it.
 */
export interface ExitDockEntity extends EntityBase {
  kind: 'exitDock';
  w: number;
  h: number;
  /** Must soft-land inside it (true) or merely enter the rect (false). */
  requireLanding: boolean;
  /** Max vessel speed (px/s) that counts (docking "slowly"). Default: no limit. */
  maxSpeed?: number;
  /** Max |angle| (rad) that counts (docking "aligned"). Default: no limit. */
  maxAngle?: number;
}

/**
 * A rock hanging from the ceiling that a harpoon can anchor to; pulling on
 * the rope (or the boss hitting it) past `breakForce` drops it as a dynamic
 * body (boss arena: drop rocks on the keeper).
 */
export interface LooseRockEntity extends EntityBase {
  kind: 'looseRock';
  /** Radius (px). */
  radius: number;
  /** Rope pull (N) that breaks it loose. */
  breakForce: number;
}

/** A platform that crumbles `delaySec` after the vessel first touches it (map 8). */
export interface CrumblePlatformEntity extends EntityBase {
  kind: 'crumblePlatform';
  w: number;
  h: number;
  delaySec: number;
  style: TerrainStyle;
  /** Round 15: jump-through (see TerrainPiece.oneWay). Default false. */
  oneWay?: boolean;
  /**
   * Round 15: seconds after the collapse when it grows back (once the vessel is clear of
   * its box), so a fall never strands the climb. Default: never (it stays gone until a
   * level restart / checkpoint respawn rebuilds it).
   */
  regrowSec?: number;
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
  | ExitDockEntity
  | LooseRockEntity
  | CrumblePlatformEntity;

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
  'looseRock',
  'crumblePlatform',
];

// -------------------------------------------------------------------- zones

/**
 * Inside the zone, world gravity is REPLACED by `gravity` for the vessel and
 * dynamic bodies. The zone is `polygon` when given (world px, same rules as
 * a 'polygon' TerrainPiece; `rect` must then be its bounding box), else `rect`.
 */
export interface GravityZone {
  kind: 'gravityZone';
  id: string;
  rect: Rect;
  polygon?: readonly Vec2[];
  /** m/s², y-down. {0,-9.8} = inverted. */
  gravity: Vec2;
}

export interface WindGust {
  /** Gust starts (full force) at this time; a 'warning' event fires warnSec earlier. */
  atSec: number;
  /** Telegraph lead time. Default 1.5. */
  warnSec?: number;
  durationSec: number;
  /** m/s² applied to the vessel (mass-independent); a multiple of the vessel's max thrust accel with unit 'vesselThrust'. */
  accel: Vec2;
  /**
   * Round 10 (audit): background force only - no telegraph (no events, no
   * streaks), for the never-calm weather's in-between gusts so only the
   * strong one warns. Default false.
   */
  silent?: boolean;
}

/** Timed lateral wind events. Applies inside `rect` (default: whole level). */
export interface WindGustSchedule {
  kind: 'windGustSchedule';
  id: string;
  rect?: Rect;
  gusts: readonly WindGust[];
  /** Repeat the schedule every N seconds. Default: no repeat. */
  repeatEverySec?: number;
  /**
   * Round 10 amendment (all optional; omitted = the original behaviour).
   * 'vesselThrust': gust accel values are multiples of the flying vessel's max
   * thrust acceleration (vessel tuning × the level's reference gravity), so
   * "stronger than the engines" stays true if thrust is retuned. Default 'mps2'.
   */
  unit?: 'mps2' | 'vesselThrust';
  /** Strength ramps with altitude: 0 at world y = y0, full at y = y1 (linear, clamped; y0 !== y1). */
  fade?: { y0: number; y1: number };
  /**
   * Round 19 amendment: strength scales with the vessel's world x - × `from` at x <= x0,
   * × `to` at x >= x1, linear in between (x0 < x1; factors 0..2; the span must overlap the
   * zone's rect). Multiplies the push, the streak telegraph's size and the windGust event's
   * accel alike (legacy 'mps2' events: designed accel × ramp); gust timing and character
   * are unchanged. Allowed on any schedule, vertical ones included - it scales whatever the
   * gusts push. Default: × 1.
   */
  xRamp?: { x0: number; x1: number; from: number; to: number };
  /**
   * Irregular, deterministic turbulence on top of each gust: strength swells by
   * ±amount and a sideways kick of up to lateral × |accel| wanders, both noise
   * of (time × hz, position, seed).
   */
  turbulence?: { seed: number; amount: number; lateral: number; hz: number };
  /**
   * px/s, per axis: each axis of the push fades out (over the last WIND_CAP_SOFT
   * px/s) as the vessel's speed along that axis, in the push's direction, reaches
   * this - so it carries the craft like a real wind instead of firing it at the
   * terrain or off the map, and a fast cruise ACROSS it is still pushed. Default: no cap.
   */
  speedCap?: number;
  /** Telegraph (events, streaks) only near the zone, not level-wide. Default false. */
  local?: boolean;
  /** `local`: how far outside the rect / fade band (px) the telegraph starts. Default 150. */
  telegraphMargin?: number;
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

/**
 * Round 17 (Vaults audit M1): harpoon heads hitting rock inside `rect` find no
 * purchase (harpoonMissed). Marks spots where a rope would be a trap, e.g. the
 * blunt tip of a hanging stalactite: a short rope anchored there lets the pod
 * orbit the tip and the rope then drags it through the spire. Invisible.
 */
export interface NoAnchorRegion {
  kind: 'noAnchorRegion';
  id: string;
  rect: Rect;
}

/**
 * A moving kill line (map 8 collapse front). Starts at `start` along `axis`
 * and moves at `speed` px/s (negative = towards 0, e.g. rising up the
 * screen). The vessel crashes when on the wrong side of it.
 */
export interface KillFront {
  kind: 'killFront';
  id: string;
  axis: 'x' | 'y';
  start: number;
  speed: number;
  activate?: TriggerSpec;
}

export type ZoneSpec = GravityZone | WindGustSchedule | RadiationEmitter | BrittleRegion | NoAnchorRegion | KillFront;

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

/**
 * Round 12 amendment: a respawn point. Once captured, a crash no longer costs the
 * whole level: RETRY on the GAME OVER screen (and ↻ while the wreck plays out)
 * resumes from the latest checkpoint; RESTART (pause menu / in flight) is still a
 * full restart and re-arms it. What a checkpoint respawn keeps: see LevelSession.respawnState.
 */
export interface CheckpointSpec {
  id: string;
  /**
   * When it is captured: 'modeSwitch' = right after LevelSpec.modeSwitch fires (the new
   * vessel in place); 'beaconPlanted' (round 13) = when the beacon at `siteId` is planted.
   * The latest capture wins (a later checkpoint supersedes an earlier one).
   * 'enterRegion' (round 14) = when the vessel centre enters `rect`; FORWARD ONLY: it
   * never captures while a checkpoint listed after it is the current one (flying back
   * up a level never moves the respawn back), and it needs a `respawn` (the capture
   * happens mid-flight, so the respawn must be a chosen resting spot).
   */
  at: 'modeSwitch' | 'beaconPlanted' | 'enterRegion';
  /** at 'beaconPlanted': the beaconSite entity id. */
  siteId?: string;
  /** at 'enterRegion': the region (world px). */
  rect?: Rect;
  /**
   * Where the vessel respawns (world px, vessel centre; meant as a resting spot on a
   * surface: the respawn starts at once, with no controls card). Default: where the
   * vessel was at capture (velocity zeroed), which then holds behind the controls card.
   */
  respawn?: { x: number; y: number; angle?: number };
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
  /** Round 12: checkpoints (Map 3: after the dragon seizure). Default none. */
  checkpoints?: readonly CheckpointSpec[];
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
  /** Harpoon guns on the pod (harpoon modes). Default 1. */
  harpoonGuns?: 1 | 2;
  /**
   * Per-level physics tuning passthrough. Keys are defined and documented
   * by the physics slice's tuning module (e.g. 'lander.thrust'); unknown
   * keys are ignored by the engine and flagged by the validator only if
   * the tuning module registers its key list.
   */
  physicsOverrides?: Readonly<Record<string, number>>;
  /** Debug levels are hidden from level select. */
  debug?: boolean;
}

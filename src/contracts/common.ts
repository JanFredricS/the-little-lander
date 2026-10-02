/**
 * FROZEN (S0). Shared primitive types. See constants.ts for units.
 */

/** 2D vector. Units depend on context (px in game data, m in PhysicsApi). */
export interface Vec2 {
  x: number;
  y: number;
}

/** Axis-aligned rectangle: top-left corner (x, y) + size. World px unless stated. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A pose: position + angle (radians, clockwise-positive, y-down). */
export interface Pose {
  x: number;
  y: number;
  angle: number;
}

/** 0xRRGGBB colour. Only palettes hold raw colours (see art.ts). */
export type Rgb = number;

/** Seed for deterministic generators (any 32-bit unsigned integer). */
export type Seed = number;

/**
 * Story levels in play order, plus the S0 debug level `testpad`.
 * Level ids are also save keys, so they never change once shipped.
 */
export type LevelId =
  | 'testpad' // S0 debug level (?level=testpad)
  | 'physlab' // S1 physics playground (?level=physlab)
  | 'hangarRun' // Map 1 — lander, hangar decks
  | 'descent' // Map 2 — CSM, asteroid descent
  | 'floatingIsles' // Map 3 — CSM -> lander, 5 beacons
  | 'throat' // Map 4 — lander, narrow caves
  | 'vaults' // Map 5 — harpoon
  | 'hollow' // Map 6 — harpoon + thrust, gravity zones, radiation
  | 'keeper' // Map 7 — boss arena, harpoon + thrust
  | 'madDash' // Map 8 — lander, collapse escape
  | 'springIsles'; // Map 9 — spring legs (round 15: the post-final arc, thrusters dead)

/** Story order (testpad excluded). The level-select / unlock order. */
export const STORY_LEVELS: readonly LevelId[] = [
  'hangarRun',
  'descent',
  'floatingIsles',
  'throat',
  'vaults',
  'hollow',
  'keeper',
  'madDash',
  'springIsles',
];

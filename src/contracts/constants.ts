/**
 * FROZEN (S0). Engine-wide constants every slice builds against.
 *
 * Unit conventions used across ALL contracts (read this first):
 *
 *  - World space is y-DOWN (screen convention), origin at the level's
 *    top-left corner. +x right, +y down.
 *  - Angles are radians. Because y is down, a POSITIVE angle rotates
 *    CLOCKWISE on screen. Angle 0 = vessel upright (nose pointing -y).
 *  - Game-facing data (LevelSpec, EntitySpec, VesselState, GameEvent,
 *    camera, render) uses WORLD PIXELS (px) and px/s.
 *  - The physics layer (PhysicsApi) uses METRES and m/s. 1 m = PX_PER_M px.
 *  - ACCELERATIONS in data (gravity, wind, zone gravity) are always m/s²,
 *    because gravity numbers like 9.8 / 1.6 are what designers reason in.
 *  - Durations are SIMULATION seconds (fixed steps × FIXED_DT), never wall
 *    clock. Nothing gameplay-relevant may read performance.now()/Date.now().
 *  - Fractions (fuel, hull, volumes, refills) are 0..1.
 */

/** World pixels per physics metre. */
export const PX_PER_M = 30;

/** Fixed simulation step (seconds). The ONLY dt gameplay code ever sees. */
export const FIXED_DT = 1 / 60;

/** Box2D sub-steps per fixed step. */
export const SUB_STEPS = 4;

/**
 * Max real time fed into the accumulator per animation frame (seconds).
 * Anything beyond is dropped: slow devices run in slight slow motion
 * instead of spiralling.
 */
export const MAX_FRAME_SECONDS = 0.25;

/** Virtual render resolution (px). Integer-scaled to fit the window. */
export const VIEW_WIDTH = 640;
export const VIEW_HEIGHT = 360;

/** Terrain tile edge (px, native art resolution). */
export const TILE_SIZE = 16;

/**
 * Native size of cutscene stills (px). NOTE: 426×240 does not integer-scale
 * into the 640×360 gameplay view; the cutscene player scales stills to the
 * window on its own (largest integer factor that fits, letterboxed).
 */
export const STILL_WIDTH = 426;
export const STILL_HEIGHT = 240;

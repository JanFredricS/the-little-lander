/**
 * Map 3 — The Floating Isles (CSM, then lander; 18,000 × 3,000 px).
 * Aster's shattered crust: islands adrift over a bottomless glow (falling
 * out of the bottom of the world is a crash), hanging vines, sky-whales and
 * dragon flocks far behind.
 *
 * Layout (left -> right):
 *   0-6,300        CSM slalom between islands (over / under, vines as soft
 *                  obstacles). At x 4,700 the dragon-bird wakes up behind
 *                  you and gives chase; when it catches the CSM (or at the
 *                  x 6,300 backstop) -> 'csmSeized' cutscene -> lander.
 *   6,800-7,600    beacon 1: open pad on a broad island. No wind.
 *   8,800-9,800    beacon 2: a pocket between solid trees. Gusts 1.5 m/s²
 *                  designed, ~1.1 felt since round 19.
 *   10,300-11,200  beacon 3: pad under an overhang (110 px headroom), fly
 *                  in from the open right side. Gusts 2.2 m/s² (windB)
 *                  designed, ~1.37 felt since round 19.
 *   12,600         beacon 4: small swaying island - the site rides it
 *                  (runtime/islands.ts); peak 13.5 px/s, well
 *                  under the 24 px/s soft-land limit). Gusts 2.2 m/s²
 *                  designed, ~1.86 felt since round 19.
 *   14,300-15,000  beacon 5: a 110 px vine-hung shaft, 500 px deep; the
 *                  shaft and the hover above it are sheltered, the approach
 *                  is not (3 m/s²; since round 19 it builds 2.2 -> 3 over
 *                  x 13,900-14,580; the shaft / outpost zones unchanged).
 *   16,200-17,800  the abandoned outpost: soft-land on its pad to finish.
 *
 * Tuning notes (map 3 = the difficulty step: first precision landings).
 * Autopilot playtest (re-run round 19, ramped wind): complete in ~296 s,
 * beacons at 72 / 108 / 159 / 192 / 243 s, fuel 0.74 left, hull 1.0 (same
 * build with the ramp stripped: 296 s, 80 / 115 / 161 / 195 / 243 s, fuel
 * 0.76 - the reference autopilot is wind-tolerant, its timing is gust-phase
 * noise; the sloppy-pilot sweep in the round 19 note is the honest measure).
 * Real game (browser, csmSeized cutscene skipped by hand): same result.
 *  - gravity 0.7 g: floaty islands; the lander's 1.6x total thrust needs
 *    ~0.4 rad of tilt to hold station in a 3 m/s² gust (clamp-level for a
 *    careful pilot), so gusts step 1.5 -> 2.2 -> 3 m/s², 1.5-2.5 s long,
 *    repeating every 12-16 s, telegraphed 1.5 s ahead (default warnSec).
 *    First draft (2 / 3 / 4 m/s², 3 s) pinned the autopilot for minutes.
 *  - csm.burnSeconds 50 / lander.burnSeconds 85: fuel carries across the
 *    switch (switchMode keeps the fraction); five canisters on the line.
 *  - beacon holdSec 1.5 (open pad) -> 2 (others); site 2's zone spans the
 *    whole 108 px pocket, site 5's the whole shaft floor.
 *  - Shaft: 90 px with a centre vine wedged the lander; 110 px with two
 *    wall-side vines is tight but fair (legSpan 30).
 *  - Dragon-bird: wakes 250 px behind / above you at x 4,700 and flies
 *    230 px/s vs the CSM's ~140 cruise, so it strikes around x 5,500;
 *    the x 6,300 backstop covers a player who outruns it (first draft:
 *    190 px/s from 500 px back never caught the autopilot).
 *  - Round 19 (user: "reduce side winds - with a gradual increase later in the
 *    map"): sideways gusts scale with the vessel's x (WEATHER.sideRamp): CSM
 *    crosswinds × 0.45 -> 0.6; on the lander stretch one continuous felt curve
 *    (0.9 m/s² at x 8,000 -> 1.25 at 10,300 -> 2.2 at 13,900 -> 3 at 14,580, no
 *    step at a zone edge, never above the old strength): beacons 2 / 3 / 4 feel
 *    ~1.1 / 1.37 / 1.86 m/s² peaks (were 1.5 / 2.2 / 2.2); beacon 5's shaft and the
 *    outpost are unchanged. Sloppy-pilot sweep (48 seeds per segment, lag 7 / hold
 *    6, from each checkpoint), pre-round-19 -> now: CSM stretch 48 -> 41 s and
 *    2 -> 1 crashes; to beacon 2 64 -> 53 s; beacon 3 42 -> 48 of 48 planted
 *    (83 -> 64 s); beacon 4 37 -> 43 of 48 (80 -> 70 s); to beacon 5 48 of 48
 *    (69 s); the outpost identical (full wind there).
 */

import type { EntitySpec, LevelSpec, TerrainPiece, Vec2, ZoneSpec } from '../contracts';
import { bottomAt, island, islandPoints, P, polygon, roughen, topAt } from './kit';

const W = 18000;
const H = 3000;
const G = 0.7 * 9.8;

/** [id, x0, x1, top, depth, seed, pad] */
const ISLANDS: [string, number, number, number, number, number, number?][] = [
  // CSM slalom
  ['i0', 80, 520, 1300, 260, 1],
  ['i1', 700, 1100, 900, 300, 2],
  ['i2', 900, 1500, 1650, 350, 3],
  ['i3', 1700, 2300, 1150, 450, 4],
  ['i4', 2600, 3000, 700, 250, 5],
  ['i5', 2500, 3200, 1900, 300, 6],
  ['i6', 3500, 4300, 1300, 500, 7],
  ['i7', 4600, 5000, 900, 200, 8],
  ['i8', 4500, 5300, 2000, 300, 9],
  ['i9', 5600, 6200, 1500, 400, 10, 0.7],
  // lander: beacon islands + stepping stones
  ['b1', 6800, 7600, 1500, 420, 11, 0.7],
  ['s1', 7900, 8400, 1250, 300, 12],
  ['b2', 8800, 9800, 1400, 450, 13, 0.9],
  ['b3', 10400, 11200, 1600, 400, 14, 0.9],
  ['s2', 11700, 12100, 1500, 300, 15],
  ['s3', 13100, 13500, 1450, 300, 16],
  ['s4', 15500, 15800, 1350, 260, 17],
  ['outpost', 16200, 17800, 1500, 520, 18, 0.8],
];

const islandPieces: TerrainPiece[] = ISLANDS.map(([id, x0, x1, top, depth, seed, pad]) =>
  island(id, x0, x1, top, depth, 'soil', seed * 7, { pad: pad ?? 0.5, decorDensity: 0.35 }),
);

/**
 * Round 12 (user: "add a checkpoint after the dragon, so I don't have to restart each
 * time I crash"): checkpoint 'afterDragon', captured when the seizure hands over to the
 * lander; a crash after it resumes here with the planted beacons kept (LevelSession).
 * The respawn is a fixed resting spot, not wherever the dragon struck (that can be
 * anywhere from x 4,700 to the 6,300 backstop, at any height, in the CSM crosswinds):
 * standing on b1's pad, left of beacon 1's zone (x 7,120-7,280: the respawn never
 * plants it), in calm air.
 */
const b1 = islandPieces.find((p) => p.id === 'b1')!;
export const CHECKPOINT_RESPAWN_X = 6980;
/** Feet ~1 px above the pad (lander centre to feet: height 18 / 2 + legDrop 7 = 16 px): it sets down at once. */
export const CHECKPOINT_RESPAWN_Y = Math.floor(topAt(b1.points, CHECKPOINT_RESPAWN_X)) - 17;

/**
 * Round 13 (user: "can you add checkpoints after each flag in the floating isles"): one
 * checkpoint per beacon, captured when it is planted (the latest capture wins). Each
 * respawns resting on a STATIC pad clear of every beacon zone, on the way on:
 *  - site 1: b1's pad right of the zone (7,100-7,300 with margin), towards fuel1 / s1;
 *  - site 2: b2's pad right of the solid tree fence (tree2d at 9,450);
 *  - site 3: b3's open right side, out from under the overhang (it ends at 11,010);
 *  - site 4: the swaying islet moves (a fixed pose on it would be wrong), so stepping
 *    stone s3, the next static island towards beacon 5;
 *  - site 5: stepping stone s4 on the way to the outpost.
 * validateLevel checks every spot (open air, terrain within 40 px below, no beacon zone).
 */
const restOn = (islandId: string, x: number) => ({ x, y: Math.floor(topAt(islandPieces.find((p) => p.id === islandId)!.points, x)) - 17 });
export const BEACON_CHECKPOINTS = [
  { id: 'afterBeacon1', siteId: 'site1', respawn: restOn('b1', 7420) },
  { id: 'afterBeacon2', siteId: 'site2', respawn: restOn('b2', 9640) },
  { id: 'afterBeacon3', siteId: 'site3', respawn: restOn('b3', 11080) },
  { id: 'afterBeacon4', siteId: 'site4', respawn: restOn('s3', 13200) },
  { id: 'afterBeacon5', siteId: 'site5', respawn: restOn('s4', 15600) },
] as const;

/** Beacon 3's overhang: a slab whose flat underside leaves 110 px over the pad. */
const overhang = polygon(
  'overhang',
  [P(10330, 1330), ...roughen([P(10420, 1300), P(10900, 1290)], 40, 12, 31), P(11010, 1330), P(11000, 1490), P(10360, 1490)],
  'rock',
  { decorDensity: 0.3 },
);

/** Beacon 5's shaft: one U-shaped rock mass, a 90 px slot from its top down to the pad. */
const SHAFT_L = 14600;
const SHAFT_R = 14710;
const SHAFT_TOP = 1200;
const SHAFT_PAD = 1700;
const shaft = polygon(
  'shaft',
  [
    ...roughen([P(14300, SHAFT_TOP + 20), P(SHAFT_L, SHAFT_TOP)], 40, 10, 41),
    ...roughen([P(SHAFT_L, SHAFT_TOP + 1), P(SHAFT_L, SHAFT_PAD)], 50, 4, 42).slice(1),
    P(SHAFT_R, SHAFT_PAD),
    ...roughen([P(SHAFT_R, SHAFT_PAD - 1), P(SHAFT_R, SHAFT_TOP)], 50, 4, 43).slice(1),
    ...roughen([P(SHAFT_R + 1, SHAFT_TOP), P(15000, SHAFT_TOP + 30)], 40, 10, 44).slice(1),
    P(14960, 1900),
    P(14780, 2080),
    P(14600, 2120),
    P(14420, 2000),
    P(14320, 1800),
  ],
  'rock',
  { decorDensity: 0.3 },
);

/** Beacon 4's swaying islet (outline relative to its top-centre). */
const SWAY_X = 12600;
const SWAY_Y = 1350;
const swayOutline: Vec2[] = islandPoints(-55, 55, 0, 110, 51, { pad: 0.7, bumps: 3 });
const swayPath: Vec2[] = [P(0, 0), P(40, 16)];

const deco = (id: string, sprite: string, x: number, y: number, w: number, h: number, extra: Partial<EntitySpec> = {}): EntitySpec =>
  ({ id, kind: 'staticProp', sprite, x, y, w, h, ...extra }) as EntitySpec;

const vine = (id: string, x: number, y: number, length: number): EntitySpec => ({ id, kind: 'vine', x, y, length, segments: Math.max(4, Math.round(length / 24)) });

/** A vine hanging from the underside of island `islandId` at x. */
const hang = (id: string, islandId: string, x: number, length: number): EntitySpec => {
  const piece = islandPieces.find((p) => p.id === islandId)!;
  return vine(id, x, Math.round(bottomAt(piece.points, x)) - 4, length);
};

const entities: EntitySpec[] = [
  // ---- sky life (background, parallax)
  { id: 'whale1', kind: 'creature', species: 'skyWhale', x: 2000, y: 500, path: [P(0, 0), P(3000, 120), P(6000, 0), P(3000, -100)], speed: 40, depth: 0.75, scale: 2 },
  { id: 'whale2', kind: 'creature', species: 'skyWhale', x: 11000, y: 700, path: [P(0, 0), P(-4000, 80), P(-8000, 0), P(-4000, -60)], speed: 35, depth: 0.8, scale: 2.5 },
  { id: 'flock1', kind: 'creature', species: 'dragonBird', x: 7000, y: 600, path: [P(0, 0), P(1500, -150), P(3000, 0), P(1500, 150)], speed: 70, depth: 0.6, scale: 0.4 },
  { id: 'flock2', kind: 'creature', species: 'dragonBird', x: 14500, y: 500, path: [P(0, 0), P(-1800, 100), P(-3600, 0), P(-1800, -100)], speed: 80, depth: 0.55, scale: 0.4 },
  // ---- the dragon-bird (gameplay)
  {
    id: 'dragon',
    kind: 'creature',
    species: 'dragonBird',
    x: 4450,
    y: 850,
    path: [],
    speed: 230,
    action: 'seizeCsm',
    activate: { kind: 'enterRegion', rect: { x: 4700, y: 0, w: 200, h: H } },
  },
  // ---- CSM slalom decor + vines
  deco('tree0', 'prop.tree', 300, 1280, 32, 40),
  deco('fall1', 'prop.waterfall', 1095, 960, 10, 64),
  hang('v1', 'i3', 1900, 160),
  hang('v2', 'i3', 2050, 200),
  hang('v3', 'i3', 2200, 140),
  deco('palm3', 'prop.palm', 1850, 1130, 32, 40),
  hang('v4', 'i4', 2800, 180),
  deco('fall6', 'prop.waterfallWide', 4290, 1400, 20, 96),
  hang('v5', 'i6', 3800, 220),
  hang('v6', 'i6', 4000, 180),
  deco('tree6', 'prop.tree', 3700, 1280, 32, 40),
  hang('v7', 'i7', 4800, 160),
  { id: 'fuelC', kind: 'fuelPickup', x: 3000, y: 1350, amount: 0.3 },
  // ---- beacon 1: open pad
  { id: 'site1', kind: 'beaconSite', x: 7200, y: 1500, w: 160, holdSec: 1.5 },
  { id: 'fuel1', kind: 'fuelPickup', x: 7700, y: 1350, amount: 0.4 },
  deco('fern1', 'prop.fern', 6900, 1492, 16, 16),
  deco('tree1', 'prop.tree', 7520, 1480, 32, 40),
  // ---- beacon 2: vegetation pocket (solid trees fence a 108 px gap)
  { id: 'site2', kind: 'beaconSite', x: 9300, y: 1400, w: 100, holdSec: 2 },
  deco('tree2a', 'prop.tree', 9230, 1380, 32, 40, { solid: true }),
  deco('tree2b', 'prop.tree', 9370, 1380, 32, 40, { solid: true }),
  deco('tree2c', 'prop.palm', 9150, 1380, 32, 40, { solid: true }),
  deco('tree2d', 'prop.tree', 9450, 1380, 32, 40, { solid: true }),
  deco('fern2', 'prop.fern', 9000, 1392, 16, 16),
  deco('fern3', 'prop.fern', 9600, 1392, 16, 16),
  hang('v8', 'b2', 9100, 120),
  // ---- beacon 3: under the overhang
  { id: 'site3', kind: 'beaconSite', x: 10760, y: 1600, w: 80, holdSec: 2 },
  { id: 'fuel3', kind: 'fuelPickup', x: 11150, y: 1555, amount: 0.4 },
  vine('v9', 10500, 1490, 60),
  deco('glow3', 'prop.glowPlant', 10420, 1586, 18, 28),
  // ---- beacon 4: swaying islet
  { id: 'sway', kind: 'movingIsland', x: SWAY_X, y: SWAY_Y, outline: swayOutline, style: { material: 'soil', decorDensity: 0.3 }, path: swayPath, periodSec: 10, motion: 'pingpong' },
  // rides the islet (given at its rest pose; runtime/islands.ts moves it along)
  { id: 'site4', kind: 'beaconSite', x: SWAY_X, y: SWAY_Y, w: 110, holdSec: 2 },
  // ---- beacon 5: the vine shaft
  vine('v10', SHAFT_L + 18, SHAFT_TOP + 4, 260),
  vine('v11', SHAFT_R - 18, SHAFT_TOP + 4, 340),
  { id: 'site5', kind: 'beaconSite', x: (SHAFT_L + SHAFT_R) / 2, y: SHAFT_PAD, w: 80, holdSec: 2 },
  { id: 'fuel4', kind: 'fuelPickup', x: 13300, y: 1330, amount: 0.35 },
  { id: 'fuel5', kind: 'fuelPickup', x: 15650, y: 1250, amount: 0.35 },
  deco('tree5', 'prop.tree', 14400, SHAFT_TOP, 32, 40),
  // ---- the outpost
  deco('ruinWall1', 'prop.ruinWall', 16500, 1468, 48, 64),
  deco('ruinPillar1', 'prop.ruinPillar', 16700, 1468, 16, 64),
  deco('outpostLander', 'prop.landerLarge', 17600, 1476, 48, 48),
  deco('outpostScreen', 'prop.screen', 16950, 1492, 20, 16),
  deco('outpostConsole', 'prop.console', 17000, 1491, 24, 18),
  deco('outpostLight', 'prop.warningLight', 17230, 1440, 8, 8),
  { id: 'exit', kind: 'exitDock', x: 17300, y: 1500, w: 120, h: 60, requireLanding: true },
];

const band = (x0: number, x1: number, y0 = 0, y1 = H) => ({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });

const GUSTS_C = [
  { atSec: 4, durationSec: 2.5, accel: { x: 3, y: 0 } },
  { atSec: 10, durationSec: 2, accel: { x: -3, y: 0 } },
];

/**
 * Round 10 weather (playtest): numbers here, the mechanics in physics/env/wind.ts.
 * Gusts in 'vesselThrust' units are multiples of the flying vessel's max
 * engine acceleration (CSM 2.4 g_ref, lander 2 x 0.9 g_ref at the level's felt
 * gravity), so "stronger than the engines" stays true if thrust is retuned.
 */
export const WEATHER = {
  /**
   * Sky ceiling (user: "flying high bypasses all islands"): downward wind fading in
   * over a height band. Continuous: a strong gust above max thrust (it beats the
   * engines even with the brake assist boost, gravity on top), then a moderate one
   * that still beats thrust minus weight, so nobody can hold altitude up there.
   * CSM stretch: calm below y 930 - the wind reaches down onto the high island tops
   * (i1 ~899, i7 ~897: a CSM skimming them has its centre ~25 px higher, at half
   * force), so no calm strip is left to cruise over the slalom; full force at 860.
   * Those tops and i4's summit (696) are windy (pushed down onto them at <=
   * speedCap; no beacon in the CSM stretch). The route stays at y >= ~1,000. Lander stretch: calm below 930 (the highest rim, the shaft's,
   * is at 1,200; the reference route tops out ~1,018), full force at 710.
   * Only the strong gust telegraphs (margin 40 px above the calm line); the
   * moderate ones are silent background force.
   */
  sky: {
    strong: 1.25,
    moderate: 0.7,
    /** px/s: it carries the craft down no faster than this (under the 75 px/s lander damage speed): pushed back, not smashed. */
    speedCap: 60,
    csm: { x0: 0, x1: 6500, calmY: 930, fullY: 860, margin: 40 },
    lander: { x0: 6500, x1: W, calmY: 930, fullY: 710, margin: 40 },
  },
  /**
   * Low turbulence (user: "throwing the craft upwards, to avoid flying low past"):
   * irregular upward + sideways shoves just under the island undersides, so no
   * calm lane survives under them: calm above y 2,200 (i5, the deepest CSM-stretch
   * underside but i8, is at ~2,190; the lander stretch's deepest, the shaft, ~2,120),
   * full force from 2,280; under i8 (x 4,450-5,350, underside ~2,338) the band is
   * carved down to calm 2,345 / full 2,385 (a craft squeezing under i8 is lifted
   * against its underside at <= speedCap, below both damage speeds).
   * A craft riding it floats ~25-35 px under the band's calm line. `side` (× each shove's duration 1.2 / 2.2 / 1.6 s)
   * sums to zero over the 5 s cycle and speedCap (45 px/s, per axis) bounds what
   * the wind alone can give, so it never carries a craft off the map or into an
   * underside above the damage speeds (lander 75, CSM 90). Only the strongest
   * shove telegraphs (1 s ahead, margin 40 px).
   */
  turbulence: { calmY: 2200, fullY: 2280, i8: { x0: 4450, x1: 5350, calmY: 2345, fullY: 2385 }, margin: 40, up: [1.6, 1.15, 1.35] as const, side: [-0.175, -0.5, 0.4] as const, amount: 0.45, lateral: 0.5, hz: 1.7, seed: 1010, speedCap: 45 },
  /**
   * CSM-stretch crosswinds (user: "the csm is so powerful that it easily handles the
   * wind"): a strong gust is this fraction of the CSM's max (lateral) engine
   * acceleration, so holding against it takes a hard lean and most of the thrust.
   * Zero-mean over the 13 s cycle (0.56 × 2.5 s right = 0.7 × 2 s left) and capped
   * at 120 px/s per axis, so a drifting craft is not carried off the map.
   */
  csmGusts: { strong: 0.7, moderate: 0.56, speedCap: 120 },
  /**
   * Round 19 (user: "reduce side winds - with a gradual increase later in the map"): the
   * SIDEWAYS gusts (csmCross, windA-C) are scaled by the vessel's x (WindGustSchedule.xRamp);
   * the sky ceiling and low turbulence (vertical: the map's walls) are unchanged.
   *  - CSM stretch: × 0.45 at the start -> × 0.6 at the seizure (x 6,300). No side wind over b1.
   *  - Lander stretch: one continuous FELT curve, peak gust in designed m/s² at these x knots
   *    (each zone's ramp is the straight piece over its own span, factor = felt / its designed
   *    peak), so there is no step at a zone boundary (audit L2: the old shared × ramp kept the
   *    designed 2.2 -> 3 jump at x 13,900). It steepens as it goes: +0.15, +0.26, +1.18 m/s²
   *    per 1,000 px, and is never above the pre-round-19 strength anywhere. Felt peak:
   *    beacon 2 (x 9,300) 1.10, beacon 3 (10,760) 1.37, beacon 4 (12,620) 1.86, x 13,900 2.2
   *    (windB's full designed strength), full 3.0 over beacon 5's approach from x 14,580;
   *    windC2 / windD (beacon 5's shaft, the outpost) are not ramped at all - exactly as
   *    before round 19.
   * Gust timing, telegraphs and character unchanged. Picked from sloppy-pilot sweeps (numbers
   * in the header) over a one-slope 0.45 -> 1.0 ramp (x 2,000-13,000), which left beacons 2-3
   * barely gentler.
   */
  sideRamp: {
    csm: { x0: 0, x1: 6300, from: 0.45, to: 0.6 },
    landerFelt: [
      [8000, 0.9],
      [10300, 1.25],
      [13900, 2.2],
      [14580, 3],
    ],
  },
} as const;

/** Round 19: zone `i`'s piece of the lander felt curve as an xRamp on a zone whose designed peak is `peak` m/s². */
export function landerRamp(i: number, peak: number): { x0: number; x1: number; from: number; to: number } {
  const K = WEATHER.sideRamp.landerFelt;
  return { x0: K[i]![0], x1: K[i + 1]![0], from: K[i]![1] / peak, to: K[i + 1]![1] / peak };
}

const SKY = WEATHER.sky;
/** 7 s cycle, never calm: moderate, a strong gust for 3 s (telegraphed 1.5 s ahead), moderate again. */
const skyGusts = [
  { atSec: 0, warnSec: 0, durationSec: 2, accel: { x: 0, y: SKY.moderate }, silent: true },
  { atSec: 2, durationSec: 3, accel: { x: 0, y: SKY.strong } },
  { atSec: 5, warnSec: 0, durationSec: 2, accel: { x: 0, y: SKY.moderate }, silent: true },
];
const sky = (id: string, z: { x0: number; x1: number; calmY: number; fullY: number; margin: number }): ZoneSpec => ({
  kind: 'windGustSchedule',
  id,
  rect: band(z.x0, z.x1, 0, z.calmY),
  gusts: skyGusts,
  repeatEverySec: 7,
  unit: 'vesselThrust',
  fade: { y0: z.calmY, y1: z.fullY },
  speedCap: SKY.speedCap,
  local: true,
  telegraphMargin: z.margin,
});

const TB = WEATHER.turbulence;
const low = (id: string, x0: number, x1: number, calmY: number, fullY: number): ZoneSpec => ({
  kind: 'windGustSchedule',
  id,
  rect: band(x0, x1, calmY, H),
  // back-to-back shoves (5 s cycle, never calm), only the strongest one telegraphed
  // (10 s: the second 5 s mirrors the sideways parts, so even capped / clipped shoves cancel out)
  gusts: [1, -1].flatMap((m, i) => [
    { atSec: 5 * i, warnSec: 0, durationSec: 1.2, accel: { x: m * TB.side[1], y: -TB.up[1] }, silent: true },
    { atSec: 5 * i + 1.2, warnSec: 0, durationSec: 2.2, accel: { x: m * TB.side[2], y: -TB.up[2] }, silent: true },
    { atSec: 5 * i + 3.4, warnSec: 1, durationSec: 1.6, accel: { x: m * TB.side[0], y: -TB.up[0] } },
  ]),
  repeatEverySec: 10,
  unit: 'vesselThrust',
  fade: { y0: calmY, y1: fullY },
  // world-x kick: perpendicular to these (vertical) shoves
  turbulence: { seed: TB.seed, amount: TB.amount, lateral: TB.lateral, hz: TB.hz },
  speedCap: TB.speedCap,
  local: true,
  telegraphMargin: TB.margin,
});

const zones: ZoneSpec[] = [
  sky('skyCsm', SKY.csm),
  sky('skyLander', SKY.lander),
  low('lowTurbulence', 0, TB.i8.x0, TB.calmY, TB.fullY),
  low('lowTurbulenceI8', TB.i8.x0, TB.i8.x1, TB.i8.calmY, TB.i8.fullY),
  low('lowTurbulenceE', TB.i8.x1, W, TB.calmY, TB.fullY),
  {
    kind: 'windGustSchedule',
    id: 'csmCross',
    // down to the turbulence: below it the shoves rule alone (their lateral part is zero-mean and capped)
    rect: band(0, 6300, 0, TB.calmY),
    gusts: [
      { atSec: 4, durationSec: 2.5, accel: { x: WEATHER.csmGusts.moderate, y: 0 } },
      { atSec: 9.5, durationSec: 2, accel: { x: -WEATHER.csmGusts.strong, y: 0 } },
    ],
    repeatEverySec: 13,
    unit: 'vesselThrust',
    speedCap: WEATHER.csmGusts.speedCap,
    local: true,
    xRamp: { ...WEATHER.sideRamp.csm },
  },
  {
    kind: 'windGustSchedule',
    id: 'windA',
    rect: band(8000, 10300, 0, TB.calmY),
    gusts: [
      { atSec: 6, durationSec: 2, accel: { x: 1.5, y: 0 } },
      { atSec: 14, durationSec: 1.5, accel: { x: -1.5, y: 0 } },
    ],
    repeatEverySec: 16,
    local: true,
    xRamp: landerRamp(0, 1.5),
  },
  {
    kind: 'windGustSchedule',
    id: 'windB',
    rect: band(10300, 13900, 0, TB.calmY),
    gusts: [
      { atSec: 5, durationSec: 2, accel: { x: 2.2, y: 0 } },
      { atSec: 11, durationSec: 2, accel: { x: -2.2, y: -0.4 } },
    ],
    repeatEverySec: 14,
    local: true,
    xRamp: landerRamp(1, 2.2),
  },
  // the shaft (x 14,580-14,710 below y 1,180) is sheltered. Round 10 audit: the lander-stretch
  // gusts stop at the turbulence band (y 2,200): their small net drift (e.g. windD +1.5 m/s·s per
  // cycle) carried a craft riding the turbulence off the map
  { kind: 'windGustSchedule', id: 'windC', rect: band(13900, 14580, 0, TB.calmY), gusts: GUSTS_C, repeatEverySec: 12, local: true, xRamp: landerRamp(2, 3) },
  { kind: 'windGustSchedule', id: 'windC2', rect: band(14580, 14730, 0, 1000), gusts: GUSTS_C, repeatEverySec: 12, local: true },
  { kind: 'windGustSchedule', id: 'windD', rect: band(14730, W, 0, TB.calmY), gusts: GUSTS_C, repeatEverySec: 12, local: true },
];

export const floatingIsles: LevelSpec = {
  id: 'floatingIsles',
  title: 'The Floating Isles',
  themeId: 'islands',
  vesselMode: 'csm',
  modeSwitch: { to: 'lander', trigger: { kind: 'enterRegion', rect: band(6300, 6500) }, cutscene: 'csmSeized' },
  checkpoints: [
    { id: 'afterDragon', at: 'modeSwitch', respawn: { x: CHECKPOINT_RESPAWN_X, y: CHECKPOINT_RESPAWN_Y } },
    ...BEACON_CHECKPOINTS.map((c) => ({ id: c.id, at: 'beaconPlanted' as const, siteId: c.siteId, respawn: { ...c.respawn } })),
  ],
  worldSize: { w: W, h: H },
  spawn: { x: 250, y: 1100 },
  gravity: { x: 0, y: G },
  terrain: { pieces: [...islandPieces, overhang, shaft] },
  entities,
  zones,
  objectives: [
    { kind: 'plantBeacons', id: 'beacons', count: 5, siteIds: ['site1', 'site2', 'site3', 'site4', 'site5'] },
    { kind: 'reachExit', id: 'outpost', exitId: 'exit' },
  ],
  camera: { bias: 'horizontal', lookAhead: 90 },
  physicsOverrides: {
    'csm.burnSeconds': 50,
    'lander.burnSeconds': 85,
  },
};

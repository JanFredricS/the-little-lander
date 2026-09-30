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
 *   8,800-9,800    beacon 2: a pocket between solid trees. Gusts 1.5 m/s².
 *   10,300-11,200  beacon 3: pad under an overhang (110 px headroom), fly
 *                  in from the open right side. Gusts 3 m/s².
 *   12,600         beacon 4: small swaying island (peak 13.5 px/s, well
 *                  under the 24 px/s soft-land limit). Gusts 2.2 m/s².
 *   14,300-15,000  beacon 5: a 110 px vine-hung shaft, 500 px deep; the
 *                  shaft and the hover above it are sheltered, the approach
 *                  is not (3 m/s²).
 *   16,200-17,800  the abandoned outpost: soft-land on its pad to finish.
 *
 * Tuning notes (map 3 = the difficulty step: first precision landings).
 * Autopilot playtest: complete in ~290 s (seized at x 5,320 / 42 s,
 * beacons at 68 / 102 / 147 / 199 / 241 s), fuel 0.54 left, hull 1.0.
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
 */

import type { EntitySpec, LevelSpec, TerrainPiece, Vec2, ZoneSpec } from '../contracts';
import { bottomAt, island, islandPoints, P, polygon, roughen } from './kit';

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
  { id: 'site4', kind: 'beaconSite', x: SWAY_X + 20, y: SWAY_Y + 8, w: 90, holdSec: 2 },
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

const zones: ZoneSpec[] = [
  {
    kind: 'windGustSchedule',
    id: 'windA',
    rect: band(8000, 10300),
    gusts: [
      { atSec: 6, durationSec: 2, accel: { x: 1.5, y: 0 } },
      { atSec: 14, durationSec: 1.5, accel: { x: -1.5, y: 0 } },
    ],
    repeatEverySec: 16,
  },
  {
    kind: 'windGustSchedule',
    id: 'windB',
    rect: band(10300, 13900),
    gusts: [
      { atSec: 5, durationSec: 2, accel: { x: 2.2, y: 0 } },
      { atSec: 11, durationSec: 2, accel: { x: -2.2, y: -0.4 } },
    ],
    repeatEverySec: 14,
  },
  // the shaft (x 14,580-14,710 below y 1,180) is sheltered
  { kind: 'windGustSchedule', id: 'windC', rect: band(13900, 14580), gusts: GUSTS_C, repeatEverySec: 12 },
  { kind: 'windGustSchedule', id: 'windC2', rect: band(14580, 14730, 0, 1000), gusts: GUSTS_C, repeatEverySec: 12 },
  { kind: 'windGustSchedule', id: 'windD', rect: band(14730, W), gusts: GUSTS_C, repeatEverySec: 12 },
];

export const floatingIsles: LevelSpec = {
  id: 'floatingIsles',
  title: 'The Floating Isles',
  themeId: 'islands',
  vesselMode: 'csm',
  modeSwitch: { to: 'lander', trigger: { kind: 'enterRegion', rect: band(6300, 6500) }, cutscene: 'csmSeized' },
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

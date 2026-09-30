/**
 * Map 6 — The Hollow (harpoonThrust: the pod with its thruster stage
 * re-attached — rope guns + main engine + rotation). ~16,000 px across the
 * planet's hollow interior: a jungle floor far below, the crust above, an
 * artificial sun hanging from the crust in the middle, waterfalls pouring
 * from the crust, floating rocks everywhere.
 *
 *  - Alternating gravity zones: down / UP / down / sideways (against you) /
 *    down / UP / sideways (with you — brake!) / down. The zone boundaries are
 *    announced by gravityChanged (HUD arrow). Thrust in every direction.
 *  - 30 tech orbs (22 needed): fuel refills + points, strung along the
 *    natural flight line; four bonus orbs sit off the line.
 *  - The sun pulses every 13 s with a 3.5 s glow telegraph. A hit costs 30%
 *    of CURRENT fuel. Cover = get a floating rock (or terrain) between you
 *    and the sun; there is a sheltered spot within ~300 px of the flight line
 *    everywhere (HOLLOW_SHELTERS, tested).
 *  - Exit: the dark tunnel mouth in the east wall (towards the Keeper).
 *
 * Playtest notes (S7, headless autopilots in test/s7.playtest.test.ts —
 * thrust-only waypoint pilots, no rope use, so a floor for a real player):
 *  - "careful" line (hides behind rock on every sun telegraph): complete in
 *    ~360 s, 27/30 orbs, 0 radiation hits, fuel never below 0.65.
 *  - "lazy" line (ignores the sun): complete in ~200 s, 25 orbs, 7 hits,
 *    hull 0.58; at other cruise speeds it runs dry 1 in 2 times — ignoring the
 *    telegraph is meant to hurt.
 *  - Tuning from it: burnSeconds 25 -> 70 (hovering costs ~2/3 duty; the
 *    default tank lasted ~2,500 px), orbs refill 14% (26 on the line),
 *    first pulse at 16 s (learn to fly first), 3.5 s telegraph (reach a
 *    shelter at a careful 110 px/s), a normal-gravity band >= 500 px between
 *    zones (time to re-trim), zone gravity <= 0.8 x thrust. Extra cover rocks
 *    were hand-placed where the generated ones left a gap (start, under the
 *    sun, x 7000, tunnel approach). Harpoon ropes (ropeBreakAccel 600, as in
 *    map 5) let a player hang in the shade for free.
 */

import { rectPoints, surfaceY } from './kit';
import type { EntitySpec, LevelSpec, TerrainPiece, Vec2, ZoneSpec } from '../contracts';
import { rng, hashString } from '../physics/geom';
import { s7Band, s7Blob, s7Noise, s7Piece, s7Profile, s7Prop, s7Scatter } from './s7Helpers';

const W = 16000;
const H = 2400;
export const HOLLOW_SUN = { x: 8000, y: 420 };
const G = 4;

// ------------------------------------------------------------------ gravity

/** Gravity bands (x ranges, full height). Outside them: level gravity (down). */
export const HOLLOW_GRAVITY: readonly { x0: number; x1: number; g: Vec2; id: string }[] = [
  { id: 'up1', x0: 2600, x1: 4400, g: { x: 0, y: -G } },
  { id: 'west1', x0: 5800, x1: 7300, g: { x: -3.5, y: 1.5 } },
  { id: 'up2', x0: 9300, x1: 11200, g: { x: 0, y: -G } },
  { id: 'east1', x0: 12100, x1: 13500, g: { x: 3.5, y: 1.5 } },
];

// ------------------------------------------------------------------ route

/** The natural flight line (px): key points west -> east. */
const routeY = s7Profile([
  [0, 1470],
  [300, 1470],
  [1400, 1250],
  [2500, 1350],
  [3500, 900], // up zone: hug the crust side
  [4400, 1000],
  [5400, 1350],
  [6500, 1200],
  [7500, 1350],
  [8500, 1200],
  [9400, 1100],
  [10300, 850], // up zone
  [11200, 950],
  [12200, 1250],
  [13400, 1150],
  [14400, 1400],
  [15300, 1500],
  [W, 1500],
]);
export const HOLLOW_ROUTE: Vec2[] = Array.from({ length: Math.floor((15700 - 250) / 150) + 1 }, (_, i) => {
  const x = 250 + i * 150;
  return { x, y: Math.round(routeY(x)) };
});
export const hollowRouteY = routeY;

// ------------------------------------------------------------------ terrain

const ceilNoise = s7Noise('hollow.ceil', 260);
const groundNoise = s7Noise('hollow.ground', 300);
const CEILING = s7Band(0, W, 100, s7Profile([[0, 300], [5000, 240], [8000, 200], [11000, 240], [W, 300]]), 45, ceilNoise);
const GROUND = s7Band(0, W, 100, s7Profile([[0, 1700], [700, 1740], [2000, 2050], [8000, 2150], [14000, 2050], [15200, 1700], [W, 1700]]), 60, groundNoise);

/** Floating rocks: {x, y, r}. Placed off the flight line, alternating above / below. */
export const HOLLOW_ROCKS: { id: string; x: number; y: number; r: number }[] = (() => {
  const out: { id: string; x: number; y: number; r: number }[] = [];
  const rand = rng(hashString('hollow.rocks'));
  let i = 0;
  for (let x = 700; x < 15200; x += 430 + rand() * 160) {
    const r = 55 + rand() * 45;
    const side = i % 2 === 0 ? -1 : 1;
    const y = routeY(x) + side * (r + 95 + rand() * 60);
    out.push({ id: `isle${i}`, x: Math.round(x), y: Math.round(y), r: Math.round(r) });
    i++;
  }
  // hand-placed extra cover: the launch ledge, under the sun, the tunnel approach
  out.push({ id: 'isleStart', x: 480, y: 1290, r: 50 }, { id: 'isleSun', x: 8620, y: 1010, r: 60 }, { id: 'isleMid', x: 7060, y: 1470, r: 55 }, { id: 'isleEnd', x: 15420, y: 1250, r: 70 });
  return out;
})();

/** Sheltered spots: in each rock's shadow, as seen from the sun. */
export const HOLLOW_SHELTERS: Vec2[] = HOLLOW_ROCKS.map((k) => {
  const d = { x: k.x - HOLLOW_SUN.x, y: k.y - HOLLOW_SUN.y };
  const l = Math.hypot(d.x, d.y);
  const off = k.r * 1.25 + 45; // blobs are 1.25 r wide
  return { x: Math.round(k.x + (d.x / l) * off), y: Math.round(k.y + (d.y / l) * off) };
});

const terrain: TerrainPiece[] = [
  s7Piece('crust', 'ceiling', CEILING, { material: 'rock', decorDensity: 0.3 }),
  s7Piece('jungle', 'ground', GROUND, { material: 'organic', decorDensity: 0.5 }),
  s7Piece('wallWest', 'polygon', rectPoints(0, 200, 40, 1600), { material: 'rock' }),
  // east wall with the tunnel mouth (a gap between y 1300 and 1560)
  s7Piece('wallEastTop', 'polygon', rectPoints(W - 40, 150, 40, 1150), { material: 'rock' }),
  s7Piece('wallEastBottom', 'polygon', rectPoints(W - 40, 1560, 40, 300), { material: 'rock' }),
  s7Piece('tunnelRoof', 'polygon', rectPoints(W - 260, 1260, 220, 40), { material: 'rock' }),
  s7Piece('tunnelFloor', 'polygon', rectPoints(W - 260, 1560, 220, 40), { material: 'rock' }),
  // launch ledge at the spawn
  s7Piece('ledge', 'polygon', rectPoints(40, 1500, 340, 40), { material: 'rock' }),
  // the sun's mount: a rock stalk from the crust
  s7Piece('sunStalk', 'polygon', [{ x: 7960, y: 190 }, { x: 8040, y: 190 }, { x: 8020, y: 360 }, { x: 7980, y: 360 }], { material: 'rock' }),
  ...HOLLOW_ROCKS.map((k) => s7Piece(k.id, 'polygon', s7Blob(k.id, k.x, k.y, k.r * 1.25, k.r, 12, 0.14), { material: 'organic' })),
];

// ------------------------------------------------------------------ entities

/** Orbs: 26 on the flight line, 4 bonus ones tucked beside rocks. */
export const HOLLOW_ORBS: EntitySpec[] = (() => {
  const out: EntitySpec[] = [];
  const n = 26;
  for (let i = 0; i < n; i++) {
    const x = Math.round(600 + (i * (15000 - 600)) / (n - 1));
    out.push({ id: `orb${i + 1}`, kind: 'orb', x, y: Math.round(routeY(x)), points: 100, fuelRefill: 0.14 });
  }
  const bonus = [4, 11, 19, 27];
  bonus.forEach((ri, j) => {
    const k = HOLLOW_ROCKS[ri]!;
    const below = k.y > routeY(k.x);
    out.push({ id: `orbBonus${j + 1}`, kind: 'orb', x: k.x + k.r * 1.25 + 30, y: k.y + (below ? 1 : -1) * 10, points: 250, fuelRefill: 0.15 });
  });
  return out;
})();

const floorY = (x: number) => surfaceY(GROUND, x);
const ceilY = (x: number) => surfaceY(CEILING, x);

const decor: EntitySpec[] = [
  s7Prop('sun', 'prop.sunLarge', HOLLOW_SUN.x, HOLLOW_SUN.y, 128, 128),
  // waterfalls pouring from the crust (drawn behind; not solid)
  ...[1200, 3900, 6100, 9900, 12800, 14700].map((x, i) => s7Prop(`falls${i}`, 'prop.waterfallWide', x, ceilY(x) + 300, 48, 600)),
  ...s7Scatter('palm', 'prop.palm', 300, 15600, () => 7, (x) => ({ y: floorY(x) - 30, w: 40, h: 60 })),
  ...s7Scatter('fern', 'prop.fern', 300, 15600, () => 10, (x) => ({ y: floorY(x) - 8, w: 20, h: 16 })),
  ...s7Scatter('stalactite', 'prop.stalactite', 300, 15600, () => 4, (x) => ({ y: ceilY(x) + 14, w: 12, h: 28 })),
  // small decorative floating rocks far behind (not solid)
  ...s7Scatter('farRock', 'prop.floatingRock', 400, 15600, () => 3, (x, r) => ({ y: 500 + r() * 1200, w: 32, h: 20 })),
];

const zones: ZoneSpec[] = [
  ...HOLLOW_GRAVITY.map((z): ZoneSpec => ({ kind: 'gravityZone', id: z.id, rect: { x: z.x0, y: 0, w: z.x1 - z.x0, h: H }, gravity: z.g })),
  { kind: 'radiationEmitter', id: 'sunPulse', x: HOLLOW_SUN.x, y: HOLLOW_SUN.y, range: 9000, periodSec: 13, warnSec: 3.5, fuelLoss: 0.3, firstAtSec: 16 },
];

export const hollow: LevelSpec = {
  id: 'hollow',
  title: 'The Hollow',
  themeId: 'core',
  vesselMode: 'harpoonThrust',
  worldSize: { w: W, h: H },
  spawn: { x: 250, y: 1500 - 11 },
  gravity: { x: 0, y: G },
  harpoonGuns: 1,
  terrain: { pieces: terrain },
  entities: [
    ...decor,
    s7Prop('ledgeCrate', 'prop.crate', 90, 1500 - 10, 20, 20),
    ...HOLLOW_ORBS,
    { id: 'tunnel', kind: 'exitDock', x: W - 150, y: 1560, w: 200, h: 290, requireLanding: false },
  ],
  zones,
  objectives: [
    { kind: 'collectOrbs', id: 'orbs', count: 22 },
    { kind: 'reachExit', id: 'tunnel', exitId: 'tunnel' },
  ],
  camera: { bias: 'horizontal', lookAhead: 100 },
  physicsOverrides: {
    'harpoonThrust.burnSeconds': 70,
    'harpoonThrust.ropeBreakAccel': 600,
    'harpoonThrust.damageSpeed': 110,
    'harpoonThrust.crashSpeed': 230,
    'harpoonThrust.reelOutSpeed': 85,
  },
};

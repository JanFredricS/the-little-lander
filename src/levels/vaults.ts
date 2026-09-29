/**
 * Map 5 — The Vaults (harpoon mode: the ascent-stage pod, rope guns only,
 * no thrusters). ~14,000 px of cave in two chained sections.
 *
 *  A. Swing school (x 0-6600): generous rock roof ~280 px above the floor,
 *     three god-ray holes to the surface (you must swing past them — no
 *     anchor in the light shaft), alien glow-vegetation, three gentle pits
 *     whose roof dips so a pod that drops in can always rope back out.
 *  B. Mastery (x 6600-13300): four chasms (a fall is fatal), three brittle
 *     roof stretches (anchors crack after 1.4 s: keep re-anchoring), two
 *     roof collapses that rain debris while you cross, a higher roof in
 *     places (longer ropes), darkness deepening while bioluminescent spores
 *     thicken.
 *  End: the research team's camp (x ~13650) — lower yourself onto the pad
 *  (soft landing inside the camp dock).
 *
 * Design rules (tested in test/s7.levels.test.ts): anchorable roof within
 * harpoon range (ropeRange - margin) of the swing line along the whole
 * route; in section A also from every floor point (no soft-lock in a pit);
 * the roof is never out of reach over a chasm except at god-ray holes,
 * which are narrower than a rope swing.
 *
 * Playtest notes (S7): played headless by the reference autopilot
 * (test/s7.playtest.test.ts: ray-cast "what's on screen" anchor picks,
 * hand-over-hand, re-fire while swinging forward, lower onto the pad) —
 * completes in ~92 s with hull 0.79; 8 pilot variants (reel timing, reach,
 * switch length) all cross all four chasms with no crash, 6/8 also finish
 * the landing (the other two dangle over the pad). Tuning that came out of it:
 *  - harpoon.ropeBreakAccel 600 (S1 default 150 snapped the rope on every
 *    slack -> taut catch above ~75 px/s, i.e. on every real swing);
 *  - harpoon.damageSpeed 110 / crashSpeed 240: a mistimed swing into the roof
 *    costs hull instead of the run;
 *  - reelOutSpeed 85 px/s < damageSpeed: holding "reel out" lowers you onto a
 *    floor without damage (the camp landing, pit recoveries);
 *  - pit roof dips widened (the pod could wedge against a steep dip wall);
 *  - camp dock 520 px wide: an overshooting swing still lands in camp;
 *  - brittle anchors 1.4 s (1.0 s left no time to pick the next anchor).
 * Two harpoon-rig bugs were found and fixed here (roped pods fell through
 * terrain; the winch crushed pods into rock) — see src/physics/vessel/harpoonRig.ts.
 */

import type { EntitySpec, LevelSpec, TerrainPiece, ZoneSpec } from '../contracts';
import { s7Band, s7Notch, s7Noise, s7Piece, s7Profile, s7Prop, s7Rect, s7Scatter, s7YAt } from './s7Helpers';

const W = 14000;
const H = 1400;
/** Section B starts here. */
export const VAULTS_SECTION_B = 6600;
/** Harpoon anchor coverage is required along this route band (x range, y of the swing line). */
export const VAULTS_ROUTE = { x0: 260, x1: 13500 };

// ------------------------------------------------------------------ profiles

const ceilNoise = s7Noise('vaults.ceil', 180);
const groundNoise = s7Noise('vaults.ground', 240);

/** Roof: ~340 in A, rising to ~300 in parts of B; dips (to ~390) over A's gentle pits. */
const ceilProfile = s7Profile([
  [0, 330],
  [1950, 345],
  [2250, 390],
  [2550, 390],
  [2850, 340],
  [3700, 340],
  [3950, 390],
  [4250, 390],
  [4500, 340],
  [5450, 345],
  [5700, 390],
  [6000, 390],
  [6250, 340],
  [6600, 330],
  [7300, 320],
  [8000, 300],
  [8900, 310],
  [9800, 290],
  [10600, 320],
  [11500, 300],
  [12400, 320],
  [13300, 340],
  [W, 340],
]);

/** Floor: ~620 in A (+80 in the pits), ~660 in B between chasms, camp flat 620. */
const groundProfile = s7Profile([
  [0, 572],
  [420, 572],
  [520, 620],
  [2100, 620],
  [2250, 690],
  [2550, 690],
  [2700, 620],
  [3850, 620],
  [3950, 690],
  [4250, 690],
  [4350, 620],
  [5600, 625],
  [5700, 690],
  [6000, 690],
  [6100, 625],
  [6600, 640],
  [13200, 660],
  [13300, 620],
  [W, 620],
]);

/** God-ray holes (section A): roof opens to the surface. */
export const VAULTS_HOLES: readonly [number, number][] = [
  [1480, 1640],
  [3060, 3240],
  [4760, 4960],
];
/** Chasms (section B): floor drops to the world bottom. */
export const VAULTS_CHASMS: readonly [number, number][] = [
  [7350, 7900],
  [8950, 9700],
  [10750, 11350],
  [12250, 12800],
];
/** Brittle roof stretches (section B). */
export const VAULTS_BRITTLE: readonly [number, number][] = [
  [8150, 8900],
  [9950, 10650],
  [11550, 12250],
];
/** Roof collapses: debris rain over these x ranges while you cross. */
const COLLAPSES: readonly [number, number][] = [
  [9150, 9700],
  [12000, 12600],
];

function ceilingPoints() {
  let pts = s7Band(0, W, 60, ceilProfile, 16, ceilNoise);
  for (const [a, b] of VAULTS_HOLES) pts = s7Notch(pts, a, b, 24, 12);
  return pts;
}

function groundPoints() {
  let pts = s7Band(0, W, 80, groundProfile, 10, groundNoise);
  // keep the spawn shelf and the camp pad flat
  pts = pts.map((p) => (p.x <= 420 ? { x: p.x, y: 572 } : p.x >= 13400 ? { x: p.x, y: 620 } : p));
  for (const [a, b] of VAULTS_CHASMS) pts = s7Notch(pts, a, b, H, 14);
  return pts;
}

export const VAULTS_CEILING = ceilingPoints();
export const VAULTS_GROUND = groundPoints();

const terrain: TerrainPiece[] = [
  s7Piece('roof', 'ceiling', VAULTS_CEILING, { material: 'rock', decorDensity: 0.3 }),
  s7Piece('floor', 'ground', VAULTS_GROUND, { material: 'rock', decorDensity: 0.35 }),
  s7Piece('wallWest', 'polygon', s7Rect(0, 200, 30, 380), { material: 'rock' }),
  s7Piece('wallEast', 'polygon', s7Rect(W - 30, 200, 30, 430), { material: 'rock' }),
  // crystal outcrops on the chasm lips (visual landmarks; solid, anchorable)
  s7Piece('lip1', 'polygon', [{ x: 7270, y: 700 }, { x: 7350, y: 640 }, { x: 7360, y: 760 }], { material: 'crystal' }),
  s7Piece('lip2', 'polygon', [{ x: 9700, y: 660 }, { x: 9780, y: 700 }, { x: 9700, y: 760 }], { material: 'crystal' }),
];

// ------------------------------------------------------------------ entities

const floorY = (x: number) => s7YAt(VAULTS_GROUND, x);
const roofY = (x: number) => s7YAt(VAULTS_CEILING, x);
const inChasm = (x: number) => VAULTS_CHASMS.some(([a, b]) => x > a - 30 && x < b + 30);
const inHole = (x: number) => VAULTS_HOLES.some(([a, b]) => x > a - 20 && x < b + 20);

const decor: EntitySpec[] = [
  // god rays down each hole
  ...VAULTS_HOLES.map(([a, b], i) => s7Prop(`godRay${i}`, 'prop.godRay', (a + b) / 2, 330, b - a + 40, 560, { foreground: true })),
  // glow vegetation on the floor: lush in A, sparse in B
  ...s7Scatter('glowPlant', 'prop.glowPlant', 500, 13300, (x) => (x < VAULTS_SECTION_B ? 9 : 3), (x) => (inChasm(x) ? null : { y: floorY(x) - 10, w: 16, h: 20 })),
  ...s7Scatter('glowShroom', 'prop.glowMushroom', 600, 13300, (x) => (x < VAULTS_SECTION_B ? 6 : 4), (x) => (inChasm(x) ? null : { y: floorY(x) - 7, w: 14, h: 14 })),
  // stalactites (decor) hanging from the roof
  ...s7Scatter('stalactite', 'prop.stalactite', 300, 13400, () => 5, (x) => (inHole(x) ? null : { y: roofY(x) + 14, w: 12, h: 28 })),
  // crystal clusters in B
  ...s7Scatter('crystal', 'prop.crystalCluster', VAULTS_SECTION_B, 13300, () => 3, (x) => (inChasm(x) ? null : { y: floorY(x) - 10, w: 20, h: 20 })),
  // bioluminescent spores thicken with depth
  ...s7Scatter('spore', 'prop.bioParticle', 400, 13600, (x) => 4 + 30 * (x / W) ** 1.5, (x, r) => {
    const top = roofY(x) + 30;
    const bottom = Math.min(floorY(x), 900) - 20;
    return bottom > top ? { y: top + r() * (bottom - top), w: 6, h: 6, foreground: r() < 0.25 } : null;
  }),
  // brittle rock markers on the brittle roof stretches
  ...VAULTS_BRITTLE.flatMap(([a, b], i) =>
    Array.from({ length: Math.floor((b - a) / 90) }, (_, k) => s7Prop(`brittleMark${i}_${k}`, 'prop.brittleRock', a + 45 + k * 90, roofY(a + 45 + k * 90) + 6, 16, 12)),
  ),
  // the camp
  s7Prop('campLander', 'prop.parkedLander', 13820, 620 - 22, 48, 44),
  s7Prop('campCrate1', 'prop.crate', 13520, 620 - 10, 20, 20),
  s7Prop('campCrate2', 'prop.box', 13545, 620 - 8, 16, 16),
  s7Prop('campScreen', 'prop.screen', 13740, 620 - 14, 24, 28),
  s7Prop('campLight', 'prop.warningLight', 13600, 620 - 6, 10, 12),
];

const entities: EntitySpec[] = [
  ...decor,
  ...COLLAPSES.map(
    ([a, b], i): EntitySpec => ({
      id: `collapse${i + 1}`,
      kind: 'debrisSpawner',
      x: (a + b) / 2,
      y: roofY((a + b) / 2) + 20,
      area: { x: a, y: Math.max(...[a, (a + b) / 2, b].map(roofY)) + 12, w: b - a, h: 16 },
      ratePerSec: 2.6,
      sizeMin: 5,
      sizeMax: 13,
      velocity: { x: 0, y: 30 },
      activate: { kind: 'enterRegion', rect: { x: a - 350, y: 0, w: 120, h: H } },
      durationSec: 12,
    }),
  ),
  { id: 'camp', kind: 'exitDock', x: 13700, y: 620, w: 520, h: 70, requireLanding: true },
];

const zones: ZoneSpec[] = VAULTS_BRITTLE.map(([a, b], i) => ({
  kind: 'brittleRegion' as const,
  id: `brittle${i + 1}`,
  rect: { x: a, y: 0, w: b - a, h: 500 },
  breakAfterSec: 1.4,
}));

export const vaults: LevelSpec = {
  id: 'vaults',
  title: 'The Vaults',
  themeId: 'caves',
  vesselMode: 'harpoon',
  worldSize: { w: W, h: H },
  spawn: { x: 220, y: 572 - 9 },
  gravity: { x: 0, y: 5.5 },
  harpoonGuns: 1,
  terrain: { pieces: terrain },
  entities,
  zones,
  objectives: [{ kind: 'reachExit', id: 'camp', exitId: 'camp' }],
  camera: { bias: 'horizontal', lookAhead: 80 },
  physicsOverrides: {
    'harpoon.reelOutSpeed': 85,
    'harpoon.damageSpeed': 110,
    'harpoon.crashSpeed': 240,
    // S1 default (150) snaps a rope on any slack->taut catch above ~75 px/s (one-step force spike)
    'harpoon.ropeBreakAccel': 600,
  },
};

/**
 * Map 4 — The Throat (lander, 1,600 × 12,000 px, vertical). A narrow cave
 * descent through Aster's crust toward the hollow: chambers lit by god-rays
 * from cracks far above, alien glow-plants, and five squeezes where the
 * passage closes to 100-125 px (the lander's legs span 30 px).
 *
 * Layout (top -> bottom), one kit.tube passage (THROAT_TUBE). Every chamber has
 * its own job (round 14, user: "too difficult, and also boring - repetitive, the
 * lights just looks like they are thrown in randomly"):
 *   0-1,300        the mouth: a wide funnel, easing in.
 *   1,400-1,600    squeeze 1 (120 px), straight - the lesson.
 *   1,900-2,400    chamber A, THE CATHEDRAL: god-rays, a pillar with a flat top
 *                  (checkpoint A rests on it), glow-moths.
 *   3,500-3,700    squeeze 2 (110 px), straight.
 *   4,000-5,000    chamber B, THE FOSSIL BED: a gravel trickle pours from the
 *                  crack that opened it; skeletons in the walls; pillar (checkpoint B).
 *   5,850-6,100    squeeze 3 (110 px), leaning (shortened from 400 px to 250).
 *   6,450-7,600    chamber C, THE DARK: no god-rays - the glow-life along the safe
 *                  lane is the only light (S7_DARKNESS band); eels; pillar (checkpoint C).
 *   8,300-8,600    squeeze 4 (108 px, was 85): a gentle UPDRAFT breathes up through
 *                  it (net fall ~0.55 g instead of 0.8 g; capped at 30 px/s up).
 *   8,700-9,750    chamber D, THE FORK: a rock fin splits it - the open main lane
 *                  under the second gravel trickle, or the narrow side branch behind
 *                  the fin with a fuel canister and an orb (sheltered from the gravel).
 *                  Checkpoint D rests on the fin.
 *   10,150-10,450  squeeze 5 (125 px): an S-BEND (a 35 px swing each way).
 *   ~9,800-11,000  the approach: ancient reliefs line the walls, a mural above the
 *                  pad - whoever built the landing pad below left them.
 *   11,000-11,700  the landing chamber: soft-land on the pad to finish.
 *
 * Light grammar (round 14, tested in test/throat.test.ts): god-rays mark chamber
 * entries and exits (never mid-squeeze, never in chamber C); every squeeze has a
 * glow-plant pair on its upper lip (runway lights marking the gap) and a glow-
 * mushroom pair on its lower lip; in the chambers the glow-plants cluster on the
 * wall of the safe lane round the pillar; chamber C is dark on purpose.
 *
 * Checkpoints (round 14, CheckpointSpec 'enterRegion', forward only): entering
 * chambers A, B, C and D; each respawns resting on that chamber's pillar / fin top.
 *
 * Tuning notes (map 4 = demanding; the difficulty step is map 3).
 *  Round 14 (difficulty): three levers, judged against a scripted mid-skill pilot
 *  (test/support/sloppyPilot.ts MID_SKILL: inputs 9 frames late, engine duty held
 *  over 7-frame windows, 15 % fast, 16 px off-centre, random held / dropped pulses):
 *   1. Geometry: squeezes 108-125 px (85-110 before; measured min clearance after
 *      the +-5 px jitter is ~100), squeeze 3 250 px long (was 400), the S-bend's
 *      swing only 35 px. While tuning, this alone barely helped the pilot: it
 *      crashed on SCRAPES (a leg catching the wall and flipping it), not on gaps.
 *   2. Wall friction 0.3 (default 0.8): a scrape now slides along the wall instead
 *      of grabbing and flipping the lander - the lever that mattered, and the
 *      squeezes look exactly as tight.
 *   3. Checkpoints (the main valve): a crash costs one squeeze + one chamber, not
 *      the whole 12 km.
 *  Reproducible (the last test in test/throat.test.ts, seeds 1-24): single life
 *  11/24 complete; with the checkpoints 23/24 (17 respawns; the one miss crashes
 *  in squeeze 1, before checkpoint A - a ~15 s restart). Squeeze 5's S-bend is the
 *  main killer after checkpoint D, a cheap ~1,200 px retry.
 *  Balance: single life stays under half for this pilot, so the squeezes remain a
 *  real test and the checkpoints carry the forgiveness; hence the small stat
 *  nerfs - damageSpeed 65 -> 70 (below the 75 default), burnSeconds 80 -> 90,
 *  crashSpeed stays 140.
 *  Autopilot (test/throat.test.ts): complete in ~184 s, fuel 0.66 at the pad,
 *  hull 0.74 (four gravel hits from the trickles).
 *  - gravity 0.8 g; lander defaults for thrust / rotation (differential
 *    pulses are the whole game here).
 *  - lander.crashSpeed 140 / damageSpeed 70 (defaults 150 / 75): hard wall
 *    hits in a squeeze still cost hull.
 *  - lander.burnSeconds 90 + canisters in chambers A, B, C (+ the fork's side
 *    branch): hovering eats ~0.55 %/s, so a careful 4-5 minute descent needs them.
 *  - Trickles: 1.0-1.2 small (5-10 px) cold pieces/s for 8 s as you enter
 *    the chamber; wait beside the stream or dash through. At 25 s the
 *    pieces kept pouring down the one passage ahead of you and pelted the
 *    landing (the autopilot lost the hull at the pad).
 *  - Pillar lanes (left / right): A 113 / 97, B 100 / 127, C 118 / 82 px - the
 *    glow-lit left lane is the roomier one in A and C; the fork's side branch
 *    is >= 85 px between wall and fin.
 */

import type { EntitySpec, LevelSpec, Rect, TerrainPiece, Vec2, ZoneSpec } from '../contracts';
import { blob, ground, P, topAt, tube, tubeAt, tubeWalls, type TubeNode } from './kit';

const W = 1600;
const H = 12000;
const G = 0.8 * 9.8;
const FLOOR = 11700;

export const THROAT_TUBE: TubeNode[] = [
  { x: 800, y: 0, w: 420 },
  { x: 800, y: 300, w: 380 },
  { x: 760, y: 700, w: 260 },
  { x: 900, y: 1100, w: 200 },
  // squeeze 1: straight
  { x: 980, y: 1400, w: 120 },
  { x: 960, y: 1600, w: 120 },
  // chamber A
  { x: 850, y: 1900, w: 300 },
  { x: 800, y: 2400, w: 340 },
  { x: 700, y: 2800, w: 180 },
  { x: 620, y: 3200, w: 160 },
  // squeeze 2: straight
  { x: 650, y: 3500, w: 110 },
  { x: 700, y: 3700, w: 110 },
  // chamber B
  { x: 800, y: 4000, w: 260 },
  { x: 900, y: 4500, w: 340 },
  { x: 1000, y: 5000, w: 200 },
  { x: 1050, y: 5400, w: 160 },
  // squeeze 3: leaning, 250 px
  { x: 985, y: 5760, w: 130 },
  { x: 960, y: 5850, w: 110 },
  { x: 885, y: 6100, w: 110 },
  // chamber C (dark)
  { x: 800, y: 6450, w: 240 },
  { x: 700, y: 7000, w: 320 },
  { x: 750, y: 7500, w: 200 },
  { x: 900, y: 7900, w: 130 },
  // squeeze 4: the updraft
  { x: 1000, y: 8300, w: 108 },
  { x: 960, y: 8600, w: 108 },
  // chamber D: the fork
  { x: 840, y: 8900, w: 300 },
  { x: 800, y: 9200, w: 500 },
  { x: 820, y: 9450, w: 400 },
  { x: 870, y: 9700, w: 250 },
  { x: 910, y: 9920, w: 170 },
  // squeeze 5: the S-bend
  { x: 950, y: 10150, w: 125 },
  { x: 915, y: 10300, w: 125 },
  { x: 950, y: 10450, w: 125 },
  { x: 920, y: 10650, w: 240 },
  // the landing chamber
  { x: 800, y: 11000, w: 520 },
  { x: 800, y: H, w: 600 },
];

/** The squeezes: their tight stretch (y range), for the lip lights and the tests. */
export const THROAT_SQUEEZES: readonly { id: string; y0: number; y1: number }[] = [
  { id: 'squeeze1', y0: 1400, y1: 1600 },
  { id: 'squeeze2', y0: 3500, y1: 3700 },
  { id: 'squeeze3', y0: 5850, y1: 6100 },
  { id: 'squeeze4', y0: 8300, y1: 8600 },
  { id: 'squeeze5', y0: 10150, y1: 10450 },
];

/** Chamber C's dark band (y): mirrors S7_DARKNESS.throat (render), checked by test/throat.test.ts. */
export const THROAT_DARK = { y0: 6150, y1: 6550, out0: 7700, out1: 8250 } as const;

/** Wall polylines exactly as tube() builds them (same seed / step / roughness). */
const TUBE_SEED = 4;
const TUBE_STEP = 30;
const TUBE_ROUGH = 5;
export const THROAT_WALLS = tubeWalls(THROAT_TUBE, TUBE_SEED, TUBE_STEP, TUBE_ROUGH);

/** x of a (y-monotone) wall polyline at y. */
export function wallX(side: 'left' | 'right', y: number): number {
  const pts = THROAT_WALLS[side];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (y <= b.y) return a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y || 1);
  }
  return pts[pts.length - 1]!.x;
}

/** Unit normal of the wall at y pointing INTO the passage. */
function wallNormal(side: 'left' | 'right', y: number): Vec2 {
  const dy = 12;
  const dx = wallX(side, y + dy) - wallX(side, y - dy);
  const l = Math.hypot(dx, 2 * dy) || 1;
  // tangent (dx, 2dy) going down; the left wall's inward normal is (2dy, -dx) / l
  return side === 'left' ? { x: (2 * dy) / l, y: -dx / l } : { x: -(2 * dy) / l, y: dx / l };
}

/**
 * Rock pillars / the fin: [id, x, y, rx, ry, seed]. Flat tops (flatTop 0.7, 20
 * vertices): a checkpoint respawn rests on each.
 */
const PILLARS: [string, number, number, number, number, number][] = [
  ['pillarA', 830, 2150, 55, 90, 61],
  ['pillarB', 900, 4550, 52, 110, 62],
  ['pillarC', 720, 7050, 52, 70, 63],
  // chamber D's fin: main lane to its right, the side branch to its left
  ['finD', 700, 9210, 44, 175, 64],
];

const pillarPieces: TerrainPiece[] = PILLARS.map(([id, x, y, rx, ry, seed]) => blob(id, x, y, rx, ry, 'rock', seed, { n: 20, rough: 0.1, flatTop: 0.7, decorDensity: 0.4 }));

/** Resting respawn on top of pillar `id` at x (feet ~1 px above the rock: centre to feet = 16 px). */
function restOnPillar(id: string, dx = 0): { x: number; y: number } {
  const p = pillarPieces.find((q) => q.id === id)!;
  const x = PILLARS.find((q) => q[0] === id)![1] + dx;
  return { x, y: Math.floor(topAt(p.points, x)) - 17 };
}

/** Cave-wall friction (default 0.8). Low so a scrape slides the lander along the
 *  wall instead of catching a leg and flipping it - the round-14 difficulty lever
 *  that mattered most (tuning notes in the header). */
const WALL_FRICTION = 0.3;
const floorPts = [P(0, FLOOR), P(700, FLOOR), P(740, FLOOR - 10), P(860, FLOOR - 10), P(900, FLOOR), P(W, FLOOR)];

const terrain: TerrainPiece[] = [
  ...tube('throat', THROAT_TUBE, W, 'rock', TUBE_SEED, { step: TUBE_STEP, rough: TUBE_ROUGH, decorDensity: 0.3, friction: WALL_FRICTION }),
  ...pillarPieces,
  ground('landing', floorPts, 'crystal', { decorDensity: 0.4 }),
];

const deco = (id: string, sprite: string, x: number, y: number, w: number, h: number, angle?: number): EntitySpec =>
  ({ id, kind: 'staticProp', sprite, x: Math.round(x), y: Math.round(y), w, h, ...(angle !== undefined ? { angle: Math.round(angle * 1000) / 1000 } : {}) }) as EntitySpec;

/** A plant growing OUT of the wall at y (its base on the rock, pointing into the passage). */
function growOnWall(id: string, sprite: string, side: 'left' | 'right', y: number, w: number, h: number): EntitySpec {
  const n = wallNormal(side, y);
  const x = wallX(side, y);
  // the sprite's "up" (0,-1) rotated by angle a is (sin a, -cos a): point it along n
  const a = Math.atan2(n.x, -n.y);
  return deco(id, sprite, x + n.x * (h / 2 - 3), y + n.y * (h / 2 - 3), w, h, a);
}

/** A carving / fossil set INTO the wall at y: upright, wholly inside the rock, its inner edge `inset` px behind the wall face. */
function setInWall(id: string, sprite: string, side: 'left' | 'right', y: number, w: number, h: number, inset = 4): EntitySpec {
  // the wall face nearest the passage over the prop's height
  const xs = [y - h / 2, y, y + h / 2].map((yy) => wallX(side, yy));
  const face = side === 'left' ? Math.min(...xs) : Math.max(...xs);
  const x = side === 'left' ? face - inset - w / 2 : face + inset + w / 2;
  return deco(id, sprite, x, y, w, h);
}

/** A prop standing on top of pillar `id` (bottom of the prop on the rock). */
const onPillar = (id: string, pillar: string, sprite: string, dx: number, w: number, h: number): EntitySpec => {
  const p = pillarPieces.find((q) => q.id === pillar)!;
  const px = PILLARS.find((q) => q[0] === pillar)![1] + dx;
  return deco(id, sprite, px, Math.round(topAt(p.points, px)) - h / 2 + 2, w, h);
};

/** A god-ray shaft whose top sits at y (the sprite hangs 160 px down from a crack above). */
const ray = (id: string, x: number, yTop: number): EntitySpec => deco(id, 'prop.godRay', x, yTop + 80, 48, 160);

/** The runway lights of a squeeze: a glow-plant pair on the upper lip, a glow-mushroom pair on the lower lip. */
function lipLights(sq: { id: string; y0: number; y1: number }): EntitySpec[] {
  return [
    growOnWall(`${sq.id}LipL`, 'prop.glowPlant', 'left', sq.y0 - 10, 18, 28),
    growOnWall(`${sq.id}LipR`, 'prop.glowPlant', 'right', sq.y0 - 10, 18, 28),
    growOnWall(`${sq.id}ExitL`, 'prop.glowMushroom', 'left', sq.y1 + 10, 16, 16),
    growOnWall(`${sq.id}ExitR`, 'prop.glowMushroom', 'right', sq.y1 + 10, 16, 16),
  ];
}

const trickle = (id: string, y: number, activateY: number, rate: number, seed: number, dx = -40): EntitySpec => {
  const t = tubeAt(THROAT_TUBE, y);
  return {
    id,
    kind: 'debrisSpawner',
    x: Math.round(t.x + dx),
    y,
    area: { x: Math.round(t.x + dx - 20), y, w: 40, h: 10 },
    ratePerSec: rate,
    sizeMin: 5,
    sizeMax: 10,
    activate: { kind: 'enterRegion', rect: { x: 0, y: activateY, w: W, h: 80 } },
    durationSec: 8,
    seed,
  };
};

const entities: EntitySpec[] = [
  // the mouth: light from the surface, a ray above the first squeeze
  ray('rayMouth', 790, 380),
  ray('rayS1', 880, 1120),
  ...THROAT_SQUEEZES.flatMap(lipLights),

  // chamber A - the cathedral: rays at the entry and over the exit, glow on the safe (left) lane
  ray('rayA1', 800, 1700),
  ray('rayA2', 900, 1780),
  ray('rayAexit', 650, 3000),
  onPillar('mushA', 'pillarA', 'prop.glowMushroom', -30, 16, 16),
  growOnWall('glowA1', 'prop.glowPlant', 'left', 2060, 18, 28),
  growOnWall('glowA2', 'prop.glowPlant', 'left', 2200, 18, 28),
  growOnWall('glowA3', 'prop.glowMushroom', 'left', 2290, 16, 16),
  { id: 'fuelA', kind: 'fuelPickup', x: 740, y: 2300, amount: 0.35 },
  { id: 'mothA', kind: 'creature', species: 'glowMoth', x: 800, y: 2100, path: [P(0, 0), P(80, -60), P(140, 20), P(40, 80)], speed: 30, depth: 0.2 },

  // chamber B - the fossil bed the gravel crack opened: skeletons in both walls
  ray('rayB1', 820, 3800),
  ray('rayBexit', 1010, 5150),
  trickle('trickle1', 4020, 3950, 1.0, 71),
  onPillar('crystalB', 'pillarB', 'prop.crystalCluster', 26, 24, 24),
  growOnWall('glowB1', 'prop.glowPlant', 'left', 4420, 18, 28),
  growOnWall('glowB2', 'prop.glowPlant', 'left', 4600, 18, 28),
  setInWall('fossilB1', 'prop.fossilSkeleton', 'right', 4250, 64, 28),
  setInWall('fossilB2', 'prop.fossilSkeleton', 'left', 4720, 64, 28),
  setInWall('skullB1', 'prop.fossilSkull', 'left', 4180, 24, 20),
  setInWall('skullB2', 'prop.fossilSkull', 'right', 4560, 24, 20, 10),
  setInWall('skullB3', 'prop.fossilSkull', 'right', 4880, 24, 20),
  { id: 'fuelB', kind: 'fuelPickup', x: 915, y: 4845, amount: 0.35 },

  // chamber C - the dark: no rays; the glow-life lines the safe (left) lane and is the only light
  growOnWall('glowC1', 'prop.glowPlant', 'left', 6560, 18, 28),
  growOnWall('glowC2', 'prop.glowMushroom', 'left', 6720, 16, 16),
  growOnWall('glowC3', 'prop.glowPlant', 'left', 6880, 18, 28),
  growOnWall('glowC4', 'prop.glowPlant', 'left', 7040, 18, 28),
  growOnWall('glowC5', 'prop.glowMushroom', 'left', 7190, 16, 16),
  growOnWall('glowC6', 'prop.glowPlant', 'left', 7340, 18, 28),
  growOnWall('glowC7', 'prop.glowPlant', 'right', 7560, 18, 28),
  growOnWall('glowC8', 'prop.glowMushroom', 'right', 7760, 16, 16),
  onPillar('crystalC', 'pillarC', 'prop.crystalCluster', -30, 24, 24),
  { id: 'fuelC', kind: 'fuelPickup', x: 690, y: 7330, amount: 0.35 },
  { id: 'eels', kind: 'creature', species: 'caveEel', x: 700, y: 6900, path: [P(0, 0), P(120, 80), P(-60, 200), P(-100, 60)], speed: 45, depth: 0.5 },
  { id: 'mothC', kind: 'creature', species: 'glowMoth', x: 760, y: 7300, path: [P(0, 0), P(-50, 40), P(30, 90), P(60, 20)], speed: 25, depth: 0.2 },
  // light again past the dark: the ray over squeeze 4 is the way out
  ray('rayS4', 940, 8050),

  // chamber D - the fork: rays at the entry and the exit, gravel down the main lane,
  // the side branch (left of the fin) glows and holds a canister + an orb
  ray('rayD1', 860, 8680),
  ray('rayDexit', 860, 9600),
  trickle('trickle2', 8950, 8880, 1.2, 72, 70),
  growOnWall('glowD1', 'prop.glowPlant', 'left', 9080, 18, 28),
  growOnWall('glowD2', 'prop.glowPlant', 'left', 9300, 18, 28),
  growOnWall('glowD3', 'prop.glowMushroom', 'left', 9400, 16, 16),
  { id: 'fuelD', kind: 'fuelPickup', x: 610, y: 9150, amount: 0.3 },
  { id: 'orbD', kind: 'orb', x: 615, y: 9300, points: 250, fuelRefill: 0.1 },

  // the approach - ancient reliefs line the walls down to the pad
  setInWall('reliefD1', 'prop.ancientRelief', 'right', 9700, 32, 48),
  setInWall('reliefD2', 'prop.ancientRelief', 'left', 9900, 32, 48),
  setInWall('reliefS5a', 'prop.ancientRelief', 'right', 10080, 32, 48),
  setInWall('reliefS5b', 'prop.ancientRelief', 'left', 10560, 32, 48),
  setInWall('reliefE1', 'prop.ancientRelief', 'right', 10760, 32, 48),
  setInWall('reliefE2', 'prop.ancientRelief', 'left', 10900, 32, 48),

  // the landing chamber: rays over the pad, a mural of the builders, glow round the pad
  ray('rayE1', 700, 11050),
  ray('rayE2', 880, 11150),
  setInWall('muralE', 'prop.ancientMural', 'left', 11250, 96, 40),
  deco('glowE1', 'prop.glowPlant', 640, FLOOR - 14, 18, 28),
  deco('glowE2', 'prop.glowPlant', 960, FLOOR - 14, 18, 28),
  deco('mushE', 'prop.glowMushroom', 1000, FLOOR - 8, 16, 16),
  deco('crystalE', 'prop.crystalCluster', 600, FLOOR - 12, 24, 24),
  { id: 'mothE', kind: 'creature', species: 'glowMoth', x: 820, y: 11400, path: [P(0, 0), P(100, -40), P(160, 40), P(60, 90)], speed: 30, depth: 0.2 },
  { id: 'exit', kind: 'exitDock', x: 800, y: FLOOR - 10, w: 120, h: 60, requireLanding: true },
];

/**
 * Squeeze 4's updraft: a steady upward push (m/s², scaled with gravity like the
 * level's) while inside, fading out as the lander rises at 30 px/s. A local
 * schedule of back-to-back 2 s instances: the telegraph (HUD arrow, streaks, one
 * whoosh) runs only near it and ends within 2 s of leaving.
 */
export const THROAT_UPDRAFT = { rect: { x: 820, y: 8200, w: 340, h: 480 } as Rect, accel: 2.6, speedCap: 30 };

const zones: ZoneSpec[] = [
  {
    kind: 'windGustSchedule',
    id: 'updraft4',
    rect: THROAT_UPDRAFT.rect,
    gusts: [{ atSec: 0, warnSec: 0, durationSec: 2, accel: { x: 0, y: -THROAT_UPDRAFT.accel } }],
    repeatEverySec: 2,
    local: true,
    telegraphMargin: 60,
    speedCap: THROAT_UPDRAFT.speedCap,
  },
];

/** Round 14: entering chambers A-D; each respawns resting on its pillar / fin. */
export const THROAT_CHECKPOINTS = [
  { id: 'chamberA', rect: { x: 0, y: 1720, w: W, h: 300 }, respawn: restOnPillar('pillarA') },
  { id: 'chamberB', rect: { x: 0, y: 3820, w: W, h: 400 }, respawn: restOnPillar('pillarB') },
  { id: 'chamberC', rect: { x: 0, y: 6250, w: W, h: 450 }, respawn: restOnPillar('pillarC') },
  { id: 'chamberD', rect: { x: 0, y: 8700, w: W, h: 280 }, respawn: restOnPillar('finD') },
] as const;

export const theThroat: LevelSpec = {
  id: 'throat',
  title: 'The Throat',
  themeId: 'caves',
  vesselMode: 'lander',
  worldSize: { w: W, h: H },
  spawn: { x: 800, y: 120 },
  gravity: { x: 0, y: G },
  terrain: { pieces: terrain },
  entities,
  zones,
  objectives: [{ kind: 'reachExit', id: 'pad', exitId: 'exit' }],
  checkpoints: THROAT_CHECKPOINTS.map((c) => ({ id: c.id, at: 'enterRegion' as const, rect: { ...c.rect }, respawn: { ...c.respawn } })),
  camera: { bias: 'vertical', lookAhead: 70 },
  physicsOverrides: {
    'lander.burnSeconds': 90,
    'lander.crashSpeed': 140,
    'lander.damageSpeed': 70,
  },
};

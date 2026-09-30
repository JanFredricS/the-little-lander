/**
 * Map 4 — The Throat (lander, 1,600 × 12,000 px, vertical). A narrow cave
 * descent through Aster's crust toward the hollow: chambers lit by god-rays
 * from cracks far above, alien glow-plants, and five squeezes where the
 * passage closes to 85-110 px (the lander's legs span 30 px).
 *
 * Layout (top -> bottom), one kit.tube passage (THROAT_TUBE):
 *   0-1,300        the mouth: a wide funnel, easing in.
 *   1,400-1,600    squeeze 1 (110 px).
 *   1,900-2,400    chamber A: god-rays, a rock pillar splits the way.
 *   3,500-3,700    squeeze 2 (95 px).
 *   4,000-5,000    chamber B: a gravel trickle pours from a crack; pillar.
 *   5,800-6,200    squeeze 3 (90 px, 400 px long, leaning).
 *   6,500-7,500    chamber C: eels in the dark, fuel.
 *   8,300-8,600    squeeze 4 (85 px) - the tightest.
 *   9,400          a second trickle over the approach to squeeze 5 (100 px).
 *   11,000-11,700  the landing chamber: soft-land on the pad to finish.
 *
 * Tuning notes (map 4 = demanding). Autopilot playtest (headless and the
 * real game): complete in ~198 s, fuel 0.41 left, hull 0.90 (two gravel
 * hits, no wall contact) - the autopilot threads squeezes centred at
 * 35-45 px/s; players scrape, overcorrect and hover far more.
 *  - gravity 0.8 g; lander defaults for thrust / rotation (differential
 *    pulses are the whole game here).
 *  - lander.crashSpeed 140 / damageSpeed 65 (defaults 150 / 75): wall
 *    scrapes in a squeeze cost hull.
 *  - lander.burnSeconds 80 + canisters in chambers A, B, C: hovering eats
 *    ~0.6 %/s, so a careful 4-5 minute descent needs the canisters.
 *  - Trickles: 1.0-1.2 small (5-10 px) cold pieces/s for 8 s as you enter
 *    the chamber; wait beside the stream or dash through. At 25 s the
 *    pieces kept pouring down the one passage ahead of you and pelted the
 *    landing (the autopilot lost the hull at the pad).
 *  - Pillars in chambers A-C leave 100-130 px lanes.
 */

import type { EntitySpec, LevelSpec, TerrainPiece } from '../contracts';
import { blob, ground, P, topAt, tube, tubeAt, type TubeNode } from './kit';

const W = 1600;
const H = 12000;
const G = 0.8 * 9.8;
const FLOOR = 11700;

export const THROAT_TUBE: TubeNode[] = [
  { x: 800, y: 0, w: 420 },
  { x: 800, y: 300, w: 380 },
  { x: 760, y: 700, w: 260 },
  { x: 900, y: 1100, w: 200 },
  { x: 1000, y: 1400, w: 110 },
  { x: 960, y: 1600, w: 110 },
  { x: 850, y: 1900, w: 300 },
  { x: 800, y: 2400, w: 340 },
  { x: 700, y: 2800, w: 180 },
  { x: 620, y: 3200, w: 160 },
  { x: 650, y: 3500, w: 95 },
  { x: 700, y: 3700, w: 95 },
  { x: 800, y: 4000, w: 260 },
  { x: 900, y: 4500, w: 320 },
  { x: 1000, y: 5000, w: 200 },
  { x: 1050, y: 5400, w: 140 },
  { x: 960, y: 5800, w: 90 },
  { x: 860, y: 6200, w: 90 },
  { x: 800, y: 6500, w: 240 },
  { x: 700, y: 7000, w: 320 },
  { x: 750, y: 7500, w: 200 },
  { x: 900, y: 7900, w: 130 },
  { x: 1000, y: 8300, w: 85 },
  { x: 960, y: 8600, w: 85 },
  { x: 850, y: 8900, w: 220 },
  { x: 800, y: 9400, w: 280 },
  { x: 900, y: 9900, w: 160 },
  { x: 950, y: 10300, w: 100 },
  { x: 920, y: 10600, w: 240 },
  { x: 800, y: 11000, w: 520 },
  { x: 800, y: H, w: 600 },
];

/** Rock pillars in chambers A and B (the passage splits around them). */
const PILLARS: [string, number, number, number, number, number][] = [
  ['pillarA', 830, 2150, 55, 90, 61],
  ['pillarB', 900, 4550, 45, 110, 62],
  ['pillarC', 720, 7050, 50, 70, 63],
];

const pillarPieces: TerrainPiece[] = PILLARS.map(([id, x, y, rx, ry, seed]) => blob(id, x, y, rx, ry, 'rock', seed, { rough: 0.15, decorDensity: 0.4 }));

const floorPts = [P(0, FLOOR), P(700, FLOOR), P(740, FLOOR - 10), P(860, FLOOR - 10), P(900, FLOOR), P(W, FLOOR)];

const terrain: TerrainPiece[] = [
  ...tube('throat', THROAT_TUBE, W, 'rock', 4, { step: 30, rough: 5, decorDensity: 0.3 }),
  ...pillarPieces,
  ground('landing', floorPts, 'crystal', { decorDensity: 0.4 }),
];

const deco = (id: string, sprite: string, x: number, y: number, w: number, h: number): EntitySpec => ({ id, kind: 'staticProp', sprite, x, y, w, h }) as EntitySpec;

/** A prop standing on top of pillar `id` (bottom of the prop on the rock). */
const onPillar = (id: string, pillar: string, sprite: string, dx: number, w: number, h: number): EntitySpec => {
  const p = pillarPieces.find((q) => q.id === pillar)!;
  const px = PILLARS.find((q) => q[0] === pillar)![1] + dx;
  return deco(id, sprite, px, Math.round(topAt(p.points, px)) - h / 2 + 2, w, h);
};

const trickle = (id: string, y: number, activateY: number, rate: number, seed: number): EntitySpec => {
  const t = tubeAt(THROAT_TUBE, y);
  return {
    id,
    kind: 'debrisSpawner',
    x: Math.round(t.x - 40),
    y,
    area: { x: Math.round(t.x - 60), y, w: 40, h: 10 },
    ratePerSec: rate,
    sizeMin: 5,
    sizeMax: 10,
    activate: { kind: 'enterRegion', rect: { x: 0, y: activateY, w: W, h: 80 } },
    durationSec: 8,
    seed,
  };
};

const entities: EntitySpec[] = [
  // chamber A
  deco('rayA1', 'prop.godRay', 780, 1980, 48, 160),
  deco('rayA2', 'prop.godRay', 900, 2060, 48, 160),
  onPillar('glowA', 'pillarA', 'prop.glowPlant', 0, 18, 28),
  { id: 'fuelA', kind: 'fuelPickup', x: 740, y: 2300, amount: 0.35 },
  { id: 'mothA', kind: 'creature', species: 'glowMoth', x: 800, y: 2100, path: [P(0, 0), P(80, -60), P(140, 20), P(40, 80)], speed: 30, depth: 0.2 },
  // chamber B
  deco('rayB1', 'prop.godRay', 860, 4150, 48, 160),
  onPillar('mushB', 'pillarB', 'prop.glowMushroom', -10, 16, 16),
  onPillar('crystalB', 'pillarB', 'prop.crystalCluster', 22, 24, 24),
  trickle('trickle1', 4020, 3950, 1.0, 71),
  { id: 'fuelB', kind: 'fuelPickup', x: 915, y: 4845, amount: 0.35 },
  // chamber C
  deco('rayC1', 'prop.godRay', 660, 6620, 48, 160),
  onPillar('glowC', 'pillarC', 'prop.glowPlant', 0, 18, 28),
  { id: 'fuelC', kind: 'fuelPickup', x: 690, y: 7330, amount: 0.35 },
  { id: 'eels', kind: 'creature', species: 'caveEel', x: 700, y: 6900, path: [P(0, 0), P(120, 80), P(-60, 200), P(-100, 60)], speed: 45, depth: 0.5 },
  { id: 'mothC', kind: 'creature', species: 'glowMoth', x: 760, y: 7300, path: [P(0, 0), P(-50, 40), P(30, 90), P(60, 20)], speed: 25, depth: 0.2 },
  // the second trickle
  trickle('trickle2', 9180, 9150, 1.2, 72),
  deco('rayD1', 'prop.godRay', 800, 9300, 48, 160),
  // landing chamber
  deco('rayE1', 'prop.godRay', 700, 11200, 48, 160),
  deco('rayE2', 'prop.godRay', 880, 11300, 48, 160),
  deco('glowE1', 'prop.glowPlant', 640, FLOOR - 14, 18, 28),
  deco('glowE2', 'prop.glowPlant', 960, FLOOR - 14, 18, 28),
  deco('mushE', 'prop.glowMushroom', 1000, FLOOR - 8, 16, 16),
  deco('crystalE', 'prop.crystalCluster', 600, FLOOR - 12, 24, 24),
  { id: 'mothE', kind: 'creature', species: 'glowMoth', x: 820, y: 11400, path: [P(0, 0), P(100, -40), P(160, 40), P(60, 90)], speed: 30, depth: 0.2 },
  { id: 'exit', kind: 'exitDock', x: 800, y: FLOOR - 10, w: 120, h: 60, requireLanding: true },
];

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
  zones: [],
  objectives: [{ kind: 'reachExit', id: 'pad', exitId: 'exit' }],
  camera: { bias: 'vertical', lookAhead: 70 },
  physicsOverrides: {
    'lander.burnSeconds': 80,
    'lander.crashSpeed': 140,
    'lander.damageSpeed': 65,
  },
};

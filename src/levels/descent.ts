/**
 * Map 2 — Descent (CSM, 2,400 × 14,000 px, vertical). Drop through the
 * asteroid belt into Aster's gravity well.
 *
 * Layout (top -> bottom), one winding passage (kit.tube) through the belt:
 *   0-3,200       the belt: big slow asteroids, 0.15 g. Learn to rotate and
 *                 retro-burn with room to spare.
 *   3,300-6,400   boulder field: the passage narrows and snakes; a dense
 *                 seeded rock field with one guaranteed line (DESCENT_LINE).
 *   6,600-9,300   goo nests: crystal rocks, four goo spawners of rising
 *                 aggression (1 -> 3 blobs). Pulse the main engine at them
 *                 to burn them off (teach: the exhaust cone kills goo).
 *   9,400-13,300  ember fall: gravity past 0.9 g, lanes of burning debris
 *                 streaming down; the last 2,000 px are a full-width ember
 *                 rain - keep moving.
 *   13,300-14,000 the floor of the belt: dive through the exit gate
 *                 (< 120 px/s, |angle| < 0.6) above the rock shelf.
 *
 * Tuning notes (map 2 = gentle-to-moderate). Autopilot playtest (flies the
 * line, burns goo that comes at the nozzle, never dodges embers): complete
 * in ~95 s, fuel 0.63 left, hull 0.41 (7 ember hits); one goo latched and
 * was burned off. A player who dodges the vents keeps most of the hull.
 *  - gravityRamp 0.15 g -> 1.2 g over y 400..12,800; spec.gravity (the
 *    engine's reference) is 1 g, so the CSM's 1.8x thrust is a punchy 12x
 *    weight at the top and a real fight (1.5x) at the bottom.
 *  - csm.burnSeconds 32 (default 30) + three fuel canisters on the line:
 *    the descent is mostly braking; players burn 2-3x what the autopilot does.
 *  - debris.hitDamage 0.04 (default 0.06), burningMultiplier 1.5 (default
 *    2): an ember hit costs 2-12 % hull. Vents fire ACROSS the passage
 *    (arcing down-slope) at 0.7 -> 1.1 pieces/s; the finale adds a sparse
 *    rain from above. Earlier drafts rained straight down at 4/s: undodgeable.
 *  - Goo nests sit just off the line below you, so blobs rise into the
 *    retro-burn (burn-off taught by doing). Nests placed to the side let
 *    blobs trail you for kilometres and swarm you at the gate - avoid.
 *  - Passage 620-720 px wide below the belt so the walls stay on the
 *    640 px screen; rock fields are seeded (scatterRocks) with a >= 75 px
 *    clear radius around DESCENT_LINE; tweak `tries` to change density.
 */

import type { EntitySpec, LevelSpec, TerrainPiece, Vec2 } from '../contracts';
import { blob, ground, P, scatterRocks, tube, tubeAt, type TubeNode } from './kit';

const W = 2400;
const H = 14000;
const G = 9.8;

/** The passage centre line and widths. */
export const DESCENT_TUBE: TubeNode[] = [
  { x: 1200, y: 0, w: 2000 },
  { x: 1200, y: 600, w: 1800 },
  { x: 1100, y: 1800, w: 1600 },
  { x: 1250, y: 3000, w: 1300 },
  { x: 1300, y: 3400, w: 880 },
  { x: 900, y: 4400, w: 720 },
  { x: 1400, y: 5600, w: 720 },
  { x: 1100, y: 6500, w: 640 },
  { x: 1300, y: 7400, w: 620 },
  { x: 1000, y: 8400, w: 620 },
  { x: 1200, y: 9400, w: 640 },
  { x: 1200, y: 10200, w: 680 },
  { x: 1150, y: 11500, w: 680 },
  { x: 1250, y: 12600, w: 660 },
  { x: 1200, y: 13400, w: 800 },
  { x: 1200, y: H, w: 1000 },
];

/** The designed flight line: always clear of rocks (the autopilot's route). */
export const DESCENT_LINE: Vec2[] = [
  P(1200, 150),
  P(1150, 900),
  P(1250, 1500),
  P(1050, 2200),
  P(1250, 2900),
  P(1300, 3400),
  P(1100, 3900),
  P(900, 4400),
  P(1100, 5000),
  P(1400, 5600),
  P(1250, 6100),
  P(1100, 6500),
  P(1250, 7000),
  P(1300, 7400),
  P(1150, 7900),
  P(1000, 8400),
  P(1100, 8900),
  P(1200, 9400),
  P(1200, 10200),
  P(1100, 10800),
  P(1250, 11500),
  P(1150, 12100),
  P(1250, 12600),
  P(1200, 13300),
  P(1200, 13780),
];

const FLOOR = 13900;

const fuel: EntitySpec[] = [
  { id: 'fuel1', kind: 'fuelPickup', x: 1100, y: 5000, amount: 0.3 },
  { id: 'fuel2', kind: 'fuelPickup', x: 1200, y: 9400, amount: 0.3 },
  { id: 'fuel3', kind: 'fuelPickup', x: 1150, y: 12100, amount: 0.25 },
];

// Nests sit just off the line BELOW you: the blobs rise into your retro-burn.
const goo: EntitySpec[] = [
  { id: 'goo1', kind: 'gooSpawner', x: 1330, y: 7200, triggerRadius: 520, intervalSec: 3.5, maxAlive: 1, homingAccel: 3.5 },
  { id: 'goo2', kind: 'gooSpawner', x: 1130, y: 7800, triggerRadius: 520, intervalSec: 3, maxAlive: 2, homingAccel: 4 },
  { id: 'goo3', kind: 'gooSpawner', x: 1090, y: 8520, triggerRadius: 520, intervalSec: 3, maxAlive: 2, homingAccel: 4.5 },
  { id: 'goo4', kind: 'gooSpawner', x: 1070, y: 9050, triggerRadius: 520, intervalSec: 3, maxAlive: 2, homingAccel: 5 },
];

const band = (y: number, h = 80) => ({ kind: 'enterRegion' as const, rect: { x: 0, y, w: W, h } });

/** A side vent spitting burning debris across the passage (arcs down-slope). */
function vent(id: string, y: number, side: 'L' | 'R', ratePerSec: number, seed: number, activateY: number): EntitySpec {
  const t = tubeAt(DESCENT_TUBE, y);
  const x = side === 'L' ? t.x - t.w / 2 + 30 : t.x + t.w / 2 - 50;
  const vx = side === 'L' ? 300 : -300;
  return { id, kind: 'debrisSpawner', x: x + 10, y: y + 25, area: { x, y, w: 20, h: 50 }, ratePerSec, sizeMin: 7, sizeMax: 14, velocity: { x: vx, y: -120 }, burning: true, activate: band(activateY), seed };
}

const embers: EntitySpec[] = [
  vent('vent1', 9500, 'L', 0.7, 21, 9300),
  vent('vent2', 10200, 'R', 0.9, 22, 9900),
  vent('vent3', 10900, 'L', 1, 23, 10600),
  vent('vent4', 11500, 'R', 1.1, 24, 11200),
  // finale: vents on both sides plus a sparse ember rain from above
  vent('vent5', 12100, 'L', 1.1, 25, 11800),
  vent('vent6', 12500, 'R', 1.1, 26, 11800),
  { id: 'rain', kind: 'debrisSpawner', x: 1160, y: 11715, area: { x: 860, y: 11700, w: 600, h: 30 }, ratePerSec: 0.6, sizeMin: 6, sizeMax: 12, velocity: { x: 0, y: 40 }, burning: true, activate: band(11900), seed: 27 },
];

/** Free space kept around entities so the rock fields never bury them. */
const keepClear = [
  ...[...fuel, ...goo].map((e) => ({ x: e.x, y: e.y, r: 70 })),
  ...embers.flatMap((e) => (e.kind === 'debrisSpawner' && e.area.w < 100 ? [{ x: e.area.x + 10, y: e.area.y + 25, r: 90 }] : [])),
];

function field(prefix: string, material: TerrainPiece['style']['material'], seed: number, o: Parameters<typeof scatterRocks>[2]): TerrainPiece[] {
  return scatterRocks(DESCENT_TUBE, seed, { line: DESCENT_LINE, avoid: keepClear, ...o }).map((r, i) =>
    blob(`${prefix}${i}`, r.x, r.y, r.rx, r.ry, material, seed * 131 + i, { decorDensity: 0.15 }),
  );
}

const terrain: TerrainPiece[] = [
  ...tube('belt', DESCENT_TUBE, W, 'rock', 2, { step: 48, rough: 14, decorDensity: 0.1 }),
  ...field('belt', 'rock', 11, { y0: 500, y1: 3200, rMin: 60, rMax: 170, tries: 160, gap: 70, lineClear: 120 }),
  ...field('field', 'rock', 12, { y0: 3300, y1: 6400, rMin: 20, rMax: 55, tries: 900, gap: 40, lineClear: 75 }),
  ...field('nest', 'crystal', 13, { y0: 6600, y1: 9300, rMin: 45, rMax: 110, tries: 160, gap: 70, lineClear: 100 }),
  ...field('embers', 'rock', 14, { y0: 9500, y1: 13200, rMin: 30, rMax: 80, tries: 160, gap: 90, lineClear: 110 }),
  ground('shelf', [P(0, FLOOR), P(900, FLOOR), P(1000, FLOOR - 20), P(1400, FLOOR - 20), P(1500, FLOOR), P(W, FLOOR)], 'rock', { decorDensity: 0.3 }),
];

export const descent: LevelSpec = {
  id: 'descent',
  title: 'Descent',
  themeId: 'asteroid',
  vesselMode: 'csm',
  worldSize: { w: W, h: H },
  spawn: { x: 1200, y: 150 },
  gravity: { x: 0, y: G },
  gravityRamp: { axis: 'y', from: 400, to: 12800, gravityFrom: { x: 0, y: 0.15 * G }, gravityTo: { x: 0, y: 1.2 * G } },
  terrain: { pieces: terrain },
  entities: [
    ...fuel,
    ...goo,
    ...embers,
    { id: 'exit', kind: 'exitDock', x: 1200, y: FLOOR - 20, w: 400, h: 240, requireLanding: false, maxSpeed: 120, maxAngle: 0.6 },
  ],
  zones: [],
  objectives: [{ kind: 'reachExit', id: 'gate', exitId: 'exit' }],
  camera: { bias: 'vertical', lookAhead: 110 },
  physicsOverrides: {
    'csm.burnSeconds': 32,
    'debris.hitDamage': 0.04,
    'debris.burningMultiplier': 1.5,
  },
};

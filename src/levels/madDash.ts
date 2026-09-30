/**
 * Map 8 — The Mad Dash (lander). The hollow collapses: fly flat-out UP
 * ~10,000 px through the crumbling alien city and out through a hole in the
 * crust. y-down: the start is at the bottom (y ~10,250), the exit at the top.
 *
 *  1. The hall (y 10,250-9,300): a wide collapsing hall; the collapse front
 *     (a rising kill line, KillFront zone) starts below the floor 4 s in.
 *  2. Shaft A (9,300-7,500): a zig-zag shaft with crumbling ledges jutting
 *     from alternating walls.
 *  3. The city (7,500-5,500): a wide cavern of ruined towers and crumbling
 *     bridges, debris raining from the roof.
 *  4. The gates (5,500-3,700): a straight shaft closed by three sliding
 *     gates (blastDoor "closing gaps") that start shutting as you approach —
 *     take the side that stays open, and do not dawdle.
 *  5. The chimney (3,700-400): a narrow winding chimney under a debris rain,
 *     then the crust and the hole to the sky (exitDock, no landing needed).
 *
 * The front rises at 80 px/s from the moment you lift off (120 px above the
 * floor; reading the controls card is safe) and never trails more than 600 px
 * behind you (LEVEL_SYSTEM_OPTIONS.madDash maxLag: stopping always costs),
 * so the whole climb must average better than 80 px/s. Crumbling ledges
 * (perches in the bend pockets, never across the line) collapse 0.8 s after
 * you touch them, and whatever the front overtakes crumbles too. Rubble
 * falls in narrow visible streams beside the line (see MADDASH_STREAMS).
 * Gates close over 7 / 6.5 / 6 s from 300 px below them; each closes FROM
 * one side, so the line switches sides between them. Late at a gate you
 * wait for the 2.5 s interlock to re-open it — while the front gains.
 * The closing gates run on levels/systems/s7Doors.ts (S8: S6's doors).
 *
 * Playtest notes (S7; headless reference pilot test/support/s7Pilots.ts
 * landerDashPilot: engineLeft/engineRight taps only, a velocity + tilt loop
 * along MADDASH_ROUTE, no knowledge of the gates beyond the line):
 *  - Final tuning: climbs at 88-125 px/s all finish, in 81-115 s, hull
 *    intact, the front never closer than ~210 px (the tightest moment is
 *    the lift-off; afterwards the lead grows to the 600 px cap), 0.7-0.8
 *    tank left. Browser check: the level loads, the front appears on
 *    lift-off and swallows a lander that sits in the hall. A pilot barely faster than the front is caught
 *    (test/s7.levels.test.ts), and a very aggressive lateral gain slams the
 *    wall on a gate side-switch and is caught — the intended failure mode.
 *  - What the pass changed (first cut: 0 of 6 pilot variants finished):
 *     - the wide chimney/city rains fell ~3,000 px and hit at 650 px/s —
 *       undodgeable at a 100 px/s climb, each hit tumbling the lander -> narrow
 *       streams beside the line, debris.lifetimeSec 6;
 *     - zig-zags of ±150-190 px every 400 px needed the lander's full side
 *       thrust -> ±120-145 px every 450-500 px;
 *     - shaft ledges sat across the diagonals -> moved into the bend pockets,
 *       and the route keeps >= 70 px from every ledge end;
 *     - gates at 5 / 4.5 / 4 s from 360 px clipped the lander at 100 px/s ->
 *       7 / 6.5 / 6 s from 300 px (gap >= 160 px at 100 px/s, >= 120 at 80);
 *     - the front (75 px/s, 700 px lag, from 4 s) never came closer than
 *       420 px -> 80 px/s, 600 px, from 90 px under the floor at lift-off
 *       (a 3 s timer crushed a browser player still reading the card);
 *       burnSeconds 110 -> 95 (two 0.25 canisters on the way).
 */

import type { EntitySpec, LevelSpec, TerrainPiece, Vec2, ZoneSpec } from '../contracts';
import { s7Noise, s7Piece, s7Profile, s7Prop, s7Rect } from './s7Helpers';

const W = 1400;
const H = 10400;
const FLOOR_Y = 10250;
/** The crust: walls close in to the hole above this y; the sky starts at CRUST_TOP. */
const CRUST_Y = 420;
const CRUST_TOP = 150;

// ------------------------------------------------------------------ shaft

/** Shaft centre line x(y) and half-width(y) (px), keyed from the TOP (y ascending). */
const centre = s7Profile([
  [0, 700],
  [CRUST_Y, 700],
  [900, 700],
  [1250, 640],
  [1750, 820],
  [2250, 580],
  [2750, 820],
  [3250, 580],
  [3700, 700],
  [5500, 700],
  [5800, 700],
  [7200, 700],
  [7500, 700],
  [7900, 560],
  [8400, 850],
  [8900, 560],
  [9300, 700],
  [H, 700],
]);
const halfWidth = s7Profile([
  [0, 110],
  [CRUST_Y, 110],
  [CRUST_Y + 200, 170],
  [3600, 175],
  [3700, 200],
  [5500, 200],
  [5800, 520],
  [7200, 520],
  [7500, 200],
  [9300, 200],
  [10000, 600],
  [H, 620],
]);
export const madDashCentre = centre;
export const madDashHalfWidth = halfWidth;

const wallNoiseL = s7Noise('madDash.wallL', 140);
const wallNoiseR = s7Noise('madDash.wallR', 140);
/** Wall roughness (px): none at the crust hole and the gates (the doors must seal). */
const rough = (y: number) => (y < CRUST_Y + 150 || (y > 3650 && y < 5550) ? 0 : 22);

const Y_STEP = 50;
const ys: number[] = [];
for (let y = CRUST_TOP; y < FLOOR_Y; y += Y_STEP) ys.push(y);
ys.push(FLOOR_Y);

export const MADDASH_LEFT: Vec2[] = ys.map((y) => ({ x: Math.round(centre(y) - halfWidth(y) + rough(y) * Math.abs(wallNoiseL(y))), y }));
export const MADDASH_RIGHT: Vec2[] = ys.map((y) => ({ x: Math.round(centre(y) + halfWidth(y) - rough(y) * Math.abs(wallNoiseR(y))), y }));

const leftWall: Vec2[] = [{ x: 0, y: CRUST_TOP }, ...MADDASH_LEFT, { x: 0, y: FLOOR_Y }];
const rightWall: Vec2[] = [{ x: W, y: FLOOR_Y }, ...[...MADDASH_RIGHT].reverse(), { x: W, y: CRUST_TOP }];

/** Ruined towers in the city (solid): centre x, top y, w, h. */
export const MADDASH_TOWERS: readonly { id: string; x: number; y: number; w: number; h: number }[] = [
  { id: 'tower1', x: 430, y: 6850, w: 110, h: 320 },
  { id: 'tower2', x: 980, y: 6400, w: 110, h: 360 },
  { id: 'tower3', x: 470, y: 5950, w: 100, h: 280 },
];

const terrain: TerrainPiece[] = [
  s7Piece('wallLeft', 'polygon', leftWall, { material: 'ruin', decorDensity: 0.5 }),
  s7Piece('wallRight', 'polygon', rightWall, { material: 'ruin', decorDensity: 0.5 }),
  s7Piece('floor', 'polygon', s7Rect(0, FLOOR_Y, W, H - FLOOR_Y), { material: 'ruin' }),
  ...MADDASH_TOWERS.map((t) => s7Piece(t.id, 'polygon', s7Rect(t.x - t.w / 2, t.y, t.w, t.h), { material: 'ruin' })),
];

// ------------------------------------------------------------------ gates

/** Gates: slot centre y, the side they close FROM, trigger distance below (px), close time (s). */
export const MADDASH_GATES: readonly { id: string; y: number; from: 'left' | 'right'; trigger: number; closeSec: number }[] = [
  { id: 'gate1', y: 5150, from: 'left', trigger: 300, closeSec: 7 },
  { id: 'gate2', y: 4650, from: 'right', trigger: 300, closeSec: 6.5 },
  { id: 'gate3', y: 4150, from: 'left', trigger: 300, closeSec: 6 },
];
/** The intended climb speed (px/s) through the gates, for the door-timing test. */
export const MADDASH_INTENDED_SPEED = 100;
const GATE_W = 400; // the gate shaft is 400 px wide (hw 200, no roughness)
const GATE_H = 30;

const gates: EntitySpec[] = MADDASH_GATES.map((g) => ({
  id: g.id,
  kind: 'blastDoor',
  x: 700,
  y: g.y,
  w: GATE_W,
  h: GATE_H,
  from: g.from,
  close: { kind: 'enterRegion', rect: { x: 300, y: g.y + g.trigger, w: 800, h: 60 } },
  closeDurationSec: g.closeSec,
}));

// ------------------------------------------------------------------ crumbling ledges

/** Crumbling ledges: centre x, y, width. Hall steps, shaft ledges, city bridges, chimney shelves. */
export const MADDASH_LEDGES: readonly { id: string; x: number; y: number; w: number }[] = (() => {
  const out: { id: string; x: number; y: number; w: number }[] = [];
  // hall: stepping stones
  out.push({ id: 'hall1', x: 360, y: 9950, w: 140 }, { id: 'hall2', x: 1040, y: 9750, w: 140 }, { id: 'hall3', x: 520, y: 9560, w: 120 });
  // shaft A: ledges in the outside pocket of each bend of the zig-zag (perches, never across the line)
  [8900, 8400, 7900].forEach((y, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    const x = centre(y) + side * (halfWidth(y) - 55);
    out.push({ id: `shaft${i + 1}`, x: Math.round(x), y, w: 110 });
  });
  // city: crumbling bridges off the main line (perches between the towers and the walls)
  out.push({ id: 'bridge1', x: 1040, y: 6850, w: 200 }, { id: 'bridge2', x: 360, y: 6400, w: 200 }, { id: 'bridge3', x: 1000, y: 5950, w: 180 });
  // chimney: shelves in the outside pockets of the bends
  [3250, 2750, 2250, 1750, 1250].forEach((y, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    out.push({ id: `shelf${i + 1}`, x: Math.round(centre(y) + side * (halfWidth(y) - 45)), y, w: 90 });
  });
  return out;
})();

const ledges: EntitySpec[] = MADDASH_LEDGES.map((l) => ({ id: l.id, kind: 'crumblePlatform', x: l.x, y: l.y, w: l.w, h: 16, delaySec: 0.8, style: { material: 'ruin' } }));

// ------------------------------------------------------------------ route (the intended line, bottom -> top)

/** The intended line: shaft centre every 100 px, biased to each gate's open side. */
export const MADDASH_ROUTE: Vec2[] = (() => {
  const pts: Vec2[] = [];
  for (let y = FLOOR_Y - 30; y > 60; y -= 100) {
    let x = centre(y);
    for (const g of MADDASH_GATES) {
      // from 'left' leaves the gap on the right: hold that side from the trigger to past the gate
      if (y <= g.y + g.trigger + 150 && y >= g.y - 120) x = 700 + (g.from === 'left' ? 1 : -1) * 140;
    }
    for (const t of MADDASH_TOWERS) {
      if (y >= t.y - 60 && y <= t.y + t.h + 60) x = t.x < 700 ? Math.max(x, t.x + t.w / 2 + 120) : Math.min(x, t.x - t.w / 2 - 120);
    }
    // keep clear of the crumbling ledges (>= 70 px from their ends)
    for (const l of MADDASH_LEDGES) {
      if (Math.abs(y - l.y) > 80) continue;
      const lo = l.x - l.w / 2 - 70;
      const hi = l.x + l.w / 2 + 70;
      if (x > lo && x < hi) x = l.x < centre(y) ? hi : lo;
    }
    pts.push({ x: Math.round(x), y });
  }
  return pts;
})();

// ------------------------------------------------------------------ everything else

/**
 * Falling debris: narrow, readable STREAMS of rubble (never a blind rain —
 * at a 100 px/s climb a piece falling from off-screen could not be dodged),
 * each off the intended line by >= 80 px, switched on as you approach its
 * section. Pieces live 6 s (debris.lifetimeSec override), so the rubble lands
 * on towers / ledges / pockets instead of pouring down the whole shaft.
 */
export const MADDASH_STREAMS: readonly { id: string; x: number; y: number; w: number; from: number }[] = [
  // the hall roof comes down as you lift off
  { id: 'hallL', x: 420, y: 9380, w: 50, from: FLOOR_Y - 140 },
  { id: 'hallR', x: 1000, y: 9420, w: 50, from: FLOOR_Y - 140 },
  // the city roof, onto the towers and the east bridge
  { id: 'cityW', x: 450, y: 5680, w: 50, from: 7400 },
  { id: 'cityE', x: 1000, y: 5680, w: 60, from: 7400 },
  // chimney pockets, onto their ledges
  ...MADDASH_LEDGES.filter((l) => l.id.startsWith('shelf') || l.id.startsWith('shaft')).map((l) => ({ id: `${l.id}Fall`, x: l.x + (l.x < centre(l.y) ? -15 : 15), y: l.y - 160, w: 40, from: l.y + 700 })),
];

const debris: EntitySpec[] = MADDASH_STREAMS.map((st, i) => ({
  id: st.id,
  kind: 'debrisSpawner',
  x: st.x,
  y: st.y,
  area: { x: st.x - st.w / 2, y: st.y - 10, w: st.w, h: 20 },
  ratePerSec: 1.6,
  sizeMin: 5,
  sizeMax: 9,
  activate: { kind: 'enterRegion', rect: { x: 0, y: st.from, w: W, h: 80 } },
  durationSec: 40,
  seed: 800 + i,
}));

const fuel: EntitySpec[] = [
  { id: 'fuel1', kind: 'fuelPickup', x: 700, y: 7350, amount: 0.25 },
  { id: 'fuel2', kind: 'fuelPickup', x: 700, y: 3800, amount: 0.25 },
];

const decor: EntitySpec[] = [
  ...[9900, 9500, 7300, 6200, 5600].flatMap((y, i) => [
    s7Prop(`pillarL${i}`, i % 2 ? 'prop.ruinPillarCrumbling' : 'prop.ruinPillar', centre(y) - halfWidth(y) + 30, y, 24, 64),
    s7Prop(`pillarR${i}`, i % 2 ? 'prop.ruinPillar' : 'prop.ruinPillarCrumbling', centre(y) + halfWidth(y) - 30, y, 24, 64),
  ]),
  ...MADDASH_TOWERS.map((t) => s7Prop(`${t.id}Arch`, 'prop.ruinArch', t.x, t.y - 20, t.w, 40)),
  ...[8800, 8000, 6600, 4400, 3000, 1900, 1000].map((y, i) => s7Prop(`wallRuin${i}`, i % 2 ? 'prop.ruinWallCrumbling' : 'prop.ruinWall', centre(y) + (i % 2 ? 1 : -1) * (halfWidth(y) - 20), y, 40, 48)),
  ...[9000, 7000, 5000, 3000, 1200].map((y, i) => s7Prop(`ember${i}`, 'prop.emberDebris', centre(y) + (i % 2 ? 80 : -80), y, 12, 12)),
];

const zones: ZoneSpec[] = [{ kind: 'killFront', id: 'collapse', axis: 'y', start: FLOOR_Y + 90, speed: -80, activate: { kind: 'enterRegion', rect: { x: 0, y: FLOOR_Y - 200, w: W, h: 80 } } }];

export const madDash: LevelSpec = {
  id: 'madDash',
  title: 'The Mad Dash',
  themeId: 'collapse',
  vesselMode: 'lander',
  worldSize: { w: W, h: H },
  spawn: { x: 700, y: FLOOR_Y - 14 },
  gravity: { x: 0, y: 4 },
  terrain: { pieces: terrain },
  entities: [
    ...decor,
    ...ledges,
    ...gates,
    ...debris,
    ...fuel,
    { id: 'sky', kind: 'exitDock', x: 700, y: CRUST_TOP + 20, w: 500, h: CRUST_TOP, requireLanding: false },
  ],
  zones,
  objectives: [{ kind: 'reachExit', id: 'escape', exitId: 'sky' }],
  camera: { bias: 'vertical', lookAhead: 120 },
  physicsOverrides: {
    'lander.burnSeconds': 95,
    'debris.lifetimeSec': 6,
  },
};

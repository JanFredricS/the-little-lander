/**
 * Map 9 — Spring Isles (round 15: the post-final arc, map 1 of 2). The finale's lift-off
 * fried the thrusters: the lander can only HOP on its spring legs (vessel mode 'spring',
 * src/physics/vessel/spring.ts). A vertical tower of floating islets (1,400 × 3,500 px,
 * the Floating Isles sky); climb from the meadow to the summit dock.
 *
 * The spring is STABLE on this map: every touchdown is soaked, the lander stands still and
 * the player can think - aim (◀ ▶ / the stick's direction), charge (hold / the stick's
 * deflection), watch the dotted arc, release. No air control (the Jump King commitment).
 *
 * Spacing (Jump King / Icy Tower style: derived from the physics, not by eye). Felt gravity
 * 12 m/s² = 360 px/s² ('gravity.scale' 1 here: a snappy hop, not the 0.65 floaty feel),
 * full charge 380 px/s: straight up rises 200 px; the full-charge reach (the best aim) is
 * 401 px on the flat, 311 px at +80, 254 px at +120, 180 px at +160 (springReach). EVERY
 * hop of the route (centre to centre) is within 80 % of that envelope for its rise and
 * rises <= 80 % of 200 px (test/springIsles.test.ts), so a hop needs care, never a pixel.
 *
 * Teaching order:
 *   A  the meadow + four big close islets, rises 70-90, steps 220-230 (the mechanic)
 *   B  a ladder of jump-through (one-way) ledges stacked above A4: jump UP through a ledge,
 *      land on top of it; overshoot and you simply come down on it again
 *   C  a zig-zag: left along a shelf of islets, back right across a one-way ledge
 *   D  smaller islets near the edge of the envelope, a one-way step between them
 *   E  crumbling islets (shake + creak when you land, collapse 1.4 s later, grow back
 *      after 4 s once you are clear; jump-through, so a head bump never starts one):
 *      plan the next hop BEFORE landing on one
 *   F  the last climb: two one-way ledges, two crumbling islets, the summit dock
 * Checkpoints (enterRegion, resting respawns) on A4, B4, C7, D5 and E4. Falling never
 * strands the climb (everything below is a way back up); a long fall dents the hull and
 * a fall of more than ~1,100 px crashes (respawn at the checkpoint).
 *
 * Tuning notes (scripted jumper, test/springIsles.test.ts): an exact-aim jumper (it
 * solves each hop's arc, lowest launch speed with >= 30 px apex clearance, landing on the
 * descending branch) climbs the whole route without a miss: 29 hops, 43.3 s, hull 1.0,
 * all 5 checkpoints, 5 crumblings (each collapses behind it). Hesitating 200 ticks on E2
 * drops it; the islets grow back and it climbs again. That is a reachability proof, not a
 * difficulty number: a human aims by eye from the dot preview.
 *
 * Map 2 (next round) flips the spring to always bouncy with timed bounces - a data tweak:
 * physicsOverrides 'spring.autoBounce': 1 (+ bounceRestitution / bounceWindowSec).
 */

import type { CheckpointSpec, CrumblePlatformEntity, EntitySpec, LevelSpec, TerrainPiece, Vec2 } from '../contracts';
import { island, P, polygon, roughen } from './kit';

const W = 1400;
const H = 3500;
/** Designed = felt gravity (gravity.scale 1 below). */
export const SPRING_ISLES_G = 12;
/** The meadow (bottom ground) top. */
export const MEADOW_Y = 3300;
/** Side cliffs: inner faces at these x. */
const WALL_L = 60;
const WALL_R = W - 60;
/** Vessel centre above a surface it stands on (collision half-height 16 + skin). */
export const STAND_DY = 17;

export type RouteKind = 'meadow' | 'islet' | 'oneWay' | 'crumble';

export interface RouteStop {
  id: string;
  kind: RouteKind;
  /** Centre x and top surface y of the landing area (px). */
  cx: number;
  top: number;
  /** Width of the flat top (px). */
  w: number;
  /** Underside depth override (px; islets close above something else). */
  depth?: number;
}

/** The climb, in order (every hop is checked against the jump envelope by the tests). */
export const SPRING_ISLES_ROUTE: readonly RouteStop[] = [
  { id: 'meadow', kind: 'meadow', cx: 250, top: MEADOW_Y, w: 200 },
  // A: big close islets
  { id: 'a1', kind: 'islet', cx: 470, top: 3230, w: 220, depth: 45 },
  { id: 'a2', kind: 'islet', cx: 700, top: 3150, w: 220 },
  { id: 'a3', kind: 'islet', cx: 920, top: 3060, w: 210 },
  { id: 'a4', kind: 'islet', cx: 1140, top: 2980, w: 240 },
  // B: the one-way ladder above a4, then a solid shelf to the left
  { id: 'b1', kind: 'oneWay', cx: 1150, top: 2860, w: 200 },
  { id: 'b2', kind: 'oneWay', cx: 1080, top: 2740, w: 200 },
  { id: 'b3', kind: 'oneWay', cx: 1150, top: 2620, w: 190 },
  { id: 'b4', kind: 'islet', cx: 920, top: 2530, w: 160 },
  // C: zig-zag - left along the shelf, back right over a one-way ledge
  { id: 'c1', kind: 'islet', cx: 700, top: 2450, w: 170 },
  { id: 'c2', kind: 'islet', cx: 480, top: 2370, w: 170 },
  { id: 'c3', kind: 'islet', cx: 260, top: 2290, w: 180 },
  { id: 'c4', kind: 'oneWay', cx: 300, top: 2170, w: 180 },
  { id: 'c5', kind: 'islet', cx: 520, top: 2080, w: 160 },
  { id: 'c6', kind: 'islet', cx: 740, top: 1990, w: 160 },
  { id: 'c7', kind: 'islet', cx: 960, top: 1900, w: 200 },
  // D: smaller islets near the envelope's edge
  { id: 'd1', kind: 'islet', cx: 1160, top: 1790, w: 130 },
  { id: 'd2', kind: 'oneWay', cx: 1120, top: 1660, w: 150 },
  { id: 'd3', kind: 'islet', cx: 900, top: 1560, w: 130 },
  { id: 'd4', kind: 'islet', cx: 680, top: 1470, w: 120 },
  { id: 'd5', kind: 'islet', cx: 470, top: 1360, w: 170 },
  // E: crumbling islets (late)
  { id: 'e1', kind: 'crumble', cx: 300, top: 1270, w: 100 },
  { id: 'e2', kind: 'crumble', cx: 520, top: 1190, w: 100 },
  { id: 'e3', kind: 'crumble', cx: 740, top: 1110, w: 100 },
  { id: 'e4', kind: 'islet', cx: 960, top: 1030, w: 180 },
  // F: the last climb
  { id: 'f1', kind: 'oneWay', cx: 1000, top: 910, w: 160 },
  { id: 'f2', kind: 'oneWay', cx: 940, top: 790, w: 150 },
  { id: 'f3', kind: 'crumble', cx: 1160, top: 690, w: 100 },
  { id: 'f4', kind: 'crumble', cx: 940, top: 590, w: 100 },
  { id: 'summit', kind: 'islet', cx: 720, top: 500, w: 280 },
];

/** Crumbling islets: shake this long after the first touch, then collapse; regrow after. */
export const CRUMBLE_DELAY_SEC = 1.4;
export const CRUMBLE_REGROW_SEC = 4;
const CRUMBLE_H = 16;

const stop = (id: string): RouteStop => SPRING_ISLES_ROUTE.find((s) => s.id === id)!;

/**
 * Islet outline: a flat top between the outline's first and last interior top samples (~40 px
 * apart, so the flat landing top is narrower than `w`: test/springIsles.test.ts measures it,
 * >= 60 px everywhere), sloping 6 px down to lips 6 px outside w/2, and a hanging underside.
 */
function isletPiece(s: RouteStop, i: number): TerrainPiece {
  const depth = s.depth ?? (s.kind === 'oneWay' ? 34 : Math.round(Math.min(150, 40 + s.w * 0.35)));
  const half = s.w / 2 + 6; // the outline's sloped lips sit outside the flat top
  return island(s.id, s.cx - half, s.cx + half, s.top, depth, 'soil', 31 + i * 17, {
    pad: s.w / (2 * half),
    bumps: 0,
    decorDensity: s.kind === 'oneWay' ? 0.15 : 0.35,
    ...(s.kind === 'oneWay' ? { oneWay: true } : {}),
  });
}

const routePieces: TerrainPiece[] = SPRING_ISLES_ROUTE.filter((s) => s.kind === 'islet' || s.kind === 'oneWay').map((s, i) => isletPiece(s, i));

/** Side cliffs (rough inner faces) keep every arc inside the world. */
function cliff(id: string, left: boolean): TerrainPiece {
  const face = left ? WALL_L : WALL_R;
  const edge = left ? 0 : W;
  const inner = roughen([P(face, 0), P(face, H)].map((p) => P(p.y, p.x)), 120, 14, left ? 5 : 6).map((p) => P(p.y, p.x));
  const pts: Vec2[] = left ? [P(edge, 0), ...inner, P(edge, H)] : [P(edge, H), ...inner.reverse(), P(edge, 0)];
  return polygon(id, pts, 'rock', { decorDensity: 0.1, anchorable: false });
}

const terrain: TerrainPiece[] = [
  // the meadow: a broad flat ground across the bottom
  polygon('meadow', [P(0, MEADOW_Y), P(W, MEADOW_Y), P(W, H), P(0, H)], 'soil', { decorDensity: 0.4 }),
  cliff('cliffL', true),
  cliff('cliffR', false),
  ...routePieces,
];

const crumble = (s: RouteStop): CrumblePlatformEntity => ({
  id: s.id,
  kind: 'crumblePlatform',
  x: s.cx,
  y: s.top + CRUMBLE_H / 2,
  w: s.w,
  h: CRUMBLE_H,
  delaySec: CRUMBLE_DELAY_SEC,
  regrowSec: CRUMBLE_REGROW_SEC,
  // jump-through too: a head bump from below never sets one crumbling
  oneWay: true,
  style: { material: 'soil' },
});

const deco = (id: string, sprite: string, x: number, y: number, w: number, h: number): EntitySpec => ({ id, kind: 'staticProp', sprite, x, y, w, h }) as EntitySpec;
/** A prop standing on route stop `sid` at dx from its centre. */
const on = (id: string, sid: string, sprite: string, dx: number, w: number, h: number): EntitySpec => deco(id, sprite, stop(sid).cx + dx, stop(sid).top - h / 2, w, h);

const SUMMIT = stop('summit');

const entities: EntitySpec[] = [
  // sky life (background parallax, as on the Floating Isles)
  { id: 'whale1', kind: 'creature', species: 'skyWhale', x: 700, y: 2600, path: [P(0, 0), P(500, -300), P(0, -600), P(-500, -300)], speed: 30, depth: 0.8, scale: 2 },
  { id: 'flock1', kind: 'creature', species: 'dragonBird', x: 400, y: 1500, path: [P(0, 0), P(600, -100), P(300, 120)], speed: 60, depth: 0.6, scale: 0.4 },
  { id: 'whale2', kind: 'creature', species: 'skyWhale', x: 900, y: 600, path: [P(0, 0), P(-600, 200), P(0, 400), P(400, 200)], speed: 25, depth: 0.85, scale: 2.4 },
  // decor (never on a landing line: the edges of the bigger islets)
  deco('fernM', 'prop.fern', 120, MEADOW_Y - 8, 16, 16),
  deco('treeM', 'prop.tree', 520, MEADOW_Y - 20, 32, 40),
  on('treeA2', 'a2', 'prop.palm', 90, 32, 40),
  on('fernA4', 'a4', 'prop.fern', -100, 16, 16),
  on('treeB4', 'b4', 'prop.tree', -60, 32, 40),
  on('fernC3', 'c3', 'prop.fern', -70, 16, 16),
  on('palmC7', 'c7', 'prop.palm', 80, 32, 40),
  on('fernD5', 'd5', 'prop.fern', 70, 16, 16),
  on('treeE4', 'e4', 'prop.tree', 75, 32, 40),
  on('treeS', 'summit', 'prop.tree', -120, 32, 40),
  ...SPRING_ISLES_ROUTE.filter((s) => s.kind === 'crumble').map(crumble),
  // the summit dock
  { id: 'exit', kind: 'exitDock', x: SUMMIT.cx + 30, y: SUMMIT.top - 10, w: 120, h: 60, requireLanding: true },
];

/** Resting respawn on route stop `id` (standing on its centre). */
export function restOn(id: string): { x: number; y: number } {
  const s = stop(id);
  return { x: s.cx, y: s.top - STAND_DY };
}

/** Round 15: a checkpoint every few tiers - entering the band above the stop's top. */
export const SPRING_ISLES_CHECKPOINTS: readonly CheckpointSpec[] = ['a4', 'b4', 'c7', 'd5', 'e4'].map((id) => {
  const s = stop(id);
  return { id: `cp_${id}`, at: 'enterRegion' as const, rect: { x: s.cx - s.w / 2, y: s.top - 40, w: s.w, h: 40 }, respawn: restOn(id) };
});

export const springIsles: LevelSpec = {
  id: 'springIsles',
  title: 'Spring Isles',
  themeId: 'islands',
  vesselMode: 'spring',
  worldSize: { w: W, h: H },
  spawn: { x: 250, y: MEADOW_Y - STAND_DY },
  gravity: { x: 0, y: SPRING_ISLES_G },
  terrain: { pieces: terrain },
  entities,
  zones: [],
  objectives: [{ kind: 'reachExit', id: 'summitDock', exitId: 'exit' }],
  checkpoints: SPRING_ISLES_CHECKPOINTS,
  camera: { bias: 'vertical', lookAhead: 50 },
  physicsOverrides: { 'gravity.scale': 1 },
};

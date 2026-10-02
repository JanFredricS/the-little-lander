/**
 * Map 9 — Spring Isles (round 15: the post-final arc, map 1 of 2). The finale's lift-off
 * fried the thrusters: the lander can only HOP on its spring legs (vessel mode 'spring',
 * src/physics/vessel/spring.ts). A vertical tower of floating islets (round 16: 1,400 × 4,700 px,
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
 * Round 16 (playtest: "too easy"): narrower stops, hazards, denser checkpoints. The route
 * (43 stops, 42 hops; 1,400 x 4,700 px) narrows section by section - forgiving first, then
 * ever smaller flat tops down to SPRING_ISLES_MIN_FLAT = 40 px (1.67 leg spans; the flat top
 * is exactly `w`, the outline's lips sit outside it). The 80 % envelope still holds per hop.
 *   A  teaching: the meadow + four big close islets (210-220 px)
 *   B  a ladder of jump-through (one-way) ledges above A4 (160 -> 140), a 120 px shelf
 *   C  the precision tier: a zig-zag of ever narrower islets (100 -> 64 px), a one-way step
 *   D  the vine curtain: c7 -> d1 crosses vines hanging under d2, d2 -> d3 under d4. Vines
 *      are the Floating Isles' vine entity (light dynamic link chains), so the "soft drag" is
 *      the physical push of the links - no extra drag force and NO damage. Measured: a full
 *      charge through a curtain lands 6-15 % short (19-52 px), so those hops are designed for
 *      an aim ~30 px past the stop (RouteStop.curtain, inside the 80 % envelope). The spring
 *      legs never stand on a vine (SpringVessel.isFooting: no touchdown soak mid-curtain);
 *      a hull resting in vines is still "touching" and the wedged rule lets it hop out.
 *      Vines anchor 3 px BELOW the rock (one-sided terrain chains).
 *   E  the animal crossing: three sky-birds patrol the e1 -> e2, e4 -> e5, e5 -> e6 gaps on
 *      a fixed diamond loop (periodic, no RNG, its dotted path drawn): CreatureEntity.harm -
 *      a contact stings 15 % hull and SWATS the hull sideways 70 px/s (horizontal, away from
 *      the bird: the hop keeps its vertical arc), 1 s cooldown per bird; never a kill on its
 *      own. Time the hop (blocked part of each loop, never all). Audit M1: a 70 px/s swat
 *      still puts a stung hop 40-90 px long / short - off a 56-64 px islet - so every lane
 *      hangs over a net (SPRING_ISLES_NETS, or GATE_CATCH): a stung hop rests at most 2 hops
 *      below its target (30 launch timings per lane, tested). The nets never overhang a stop.
 *   F  the crate gate: four 22 px dynamic crates (density 1; a dynamic staticProp, no new
 *      entity kind) stacked on f1's near lip, 88 px tall - the column top is out of reach, f1
 *      is reachable only through it. Audit M2: e6 sits 128 px (centre) from the column so a
 *      ram with >= 90 % charge at aim 0.35-0.45 gets past it from anywhere on e6 (+-30 px,
 *      tested); <= 65 % never topples it. 80 % only reaches the column's FOOT (the hull meets
 *      crate 0/1 at ~100 px/s as it lands) - it sometimes works, it is not promised. The
 *      GATE_CATCH ledge (240 px under f1, under e6 too) catches every failed ram, every
 *      tumble back over e6 and every fall past f1 (210 rams tested). A checkpoint respawn
 *      builds a fresh session, so the column stands again; crates knocked off f1 stay on the
 *      lower tiers until then (passable: the auditor's 28/30 pile layouts, no lock).
 *   G  crumbling islets (shake 1.4 s after landing, regrow after 4 s; jump-through), 56 -> 50
 *   H  one-way ledges, needle islets (48 / 46 px), a crumble
 *   I  the top tiers: 48 -> 40 px, a last crumble, the summit dock
 * Checkpoints (enterRegion, resting respawns) on a4 b4 c3 c7 d5 e3 e6 f1 g4 h3 h6 i2: one
 * every <= 5 hops, one right after the gate (f1: its band starts right of the column, the
 * respawn rests beside it). Falling never strands the climb (everything below is a way back
 * up); a long fall dents the hull and a fall of more than ~1,100 px crashes (respawn at the
 * checkpoint). Audit L1: e2's left and d4's right lip are rounded (a leg kept re-hooking there).
 *
 * Tuning notes (scripted jumper, test/springIsles.test.ts + springHazards.test.ts). The exact
 * jumper (solves each arc; waits while a bird's loop crosses it; rams the gate) climbs it in
 * 60.8 s: 42 hops, 0 misses, 1 ram, 0 stings, hull 1.0, all 12 checkpoints. Sloppy (8 seeds
 * each, climbWithRespawns; all finish):
 *   aim +-0.06 rad                 59-78 s,  0-4 misses,  0 respawns,       1 sting
 *   aim +-0.15 rad                 79-224 s, 2-26 misses, 0-4 respawns (6), 2 stings
 *   aim +-0.06 + charge +-0.03     59-91 s,  0-8 misses,  0 respawns,       0 stings
 *   aim +-0.12 + charge +-0.06     65-320 s, 2-47 misses, 0 respawns,       4 stings
 *   aim +-0.06 + charge +-0.10     76-625 s, 4-80 misses, 0-4 respawns (13), 18 stings
 * Aim error is felt less than its size suggests (the solver's slowest launch sits near the
 * range-stationary angle); a human's charge error is the bigger one. Hesitating 200 ticks on
 * crumble g2 drops it; it grows back and the climb resumes.
 *
 * Map 2 (next round) flips the spring to always bouncy with timed bounces - a data tweak:
 * physicsOverrides 'spring.autoBounce': 1 (+ bounceRestitution / bounceWindowSec).
 */

import type { CheckpointSpec, CreatureEntity, CrumblePlatformEntity, EntitySpec, LevelSpec, StaticPropEntity, TerrainPiece, Vec2, VineEntity } from '../contracts';
import { bottomAt, islandPoints, P, polygon, roughen } from './kit';

const W = 1400;
const H = 4700;
/** Designed = felt gravity (gravity.scale 1 below). */
export const SPRING_ISLES_G = 12;
/** The meadow (bottom ground) top. */
export const MEADOW_Y = 4500;
/** Side cliffs: inner faces at these x. */
const WALL_L = 60;
const WALL_R = W - 60;
/** Vessel centre above a surface it stands on (collision half-height 16 + skin). */
export const STAND_DY = 17;
/** Round 16: the narrowest flat landing top anywhere on the route (px): 40 = 1.67 x the 24 px leg span. */
export const SPRING_ISLES_MIN_FLAT = 40;

export type RouteKind = 'meadow' | 'islet' | 'oneWay' | 'crumble';

export interface RouteStop {
  id: string;
  kind: RouteKind;
  /** Centre x and top surface y of the landing area (px). */
  cx: number;
  top: number;
  /** Width of the FLAT landing top (px; round 16: exact - the outline's lips sit outside it). */
  w: number;
  /** Underside depth override (px; islets close above something else). */
  depth?: number;
  /**
   * Round 16: the hop INTO this stop crosses a vine curtain. The vines drag it short by about
   * this much (px, measured): aim this far past the stop (the scripted jumper does).
   */
  curtain?: number;
  /** Round 16: a crate column stands on this stop's near lip (the crate gate): topple it first. */
  gate?: boolean;
  /**
   * Audit L1: round this lip (a gentler 3-step curve instead of the 5 px corner) - a hull whose
   * leg caught under the corner kept re-hooking there.
   */
  roundLip?: 'left' | 'right';
}

/** The climb, in order (every hop is checked against the jump envelope by the tests). */
export const SPRING_ISLES_ROUTE: readonly RouteStop[] = [
  { id: 'meadow', kind: 'meadow', cx: 250, top: MEADOW_Y, w: 200 },
  // A: the teaching stretch - big close islets (forgiving)
  { id: 'a1', kind: 'islet', cx: 470, top: 4430, w: 220, depth: 45 },
  { id: 'a2', kind: 'islet', cx: 700, top: 4350, w: 220 },
  { id: 'a3', kind: 'islet', cx: 920, top: 4260, w: 210 },
  { id: 'a4', kind: 'islet', cx: 1140, top: 4180, w: 220 },
  // B: the one-way ladder above a4, then a solid shelf to the left (narrowing)
  { id: 'b1', kind: 'oneWay', cx: 1150, top: 4060, w: 160 },
  { id: 'b2', kind: 'oneWay', cx: 1080, top: 3940, w: 150 },
  { id: 'b3', kind: 'oneWay', cx: 1150, top: 3820, w: 140 },
  { id: 'b4', kind: 'islet', cx: 920, top: 3730, w: 120 },
  // C: the precision tier - a zig-zag of ever narrower islets (100 -> 64 px)
  { id: 'c1', kind: 'islet', cx: 720, top: 3650, w: 100 },
  { id: 'c2', kind: 'islet', cx: 520, top: 3570, w: 90 },
  { id: 'c3', kind: 'islet', cx: 320, top: 3490, w: 80 },
  { id: 'c4', kind: 'oneWay', cx: 360, top: 3370, w: 90 },
  { id: 'c5', kind: 'islet', cx: 560, top: 3280, w: 70 },
  { id: 'c6', kind: 'islet', cx: 760, top: 3200, w: 64 },
  { id: 'c7', kind: 'islet', cx: 980, top: 3120, w: 90 },
  // D: the vine curtains - two hops cross the vines hanging from the islet above the gap
  { id: 'd1', kind: 'islet', cx: 1190, top: 3060, w: 90, curtain: 30 },
  { id: 'd2', kind: 'islet', cx: 1080, top: 2930, w: 70, depth: 30 },
  { id: 'd3', kind: 'islet', cx: 870, top: 2850, w: 70, curtain: 30 },
  { id: 'd4', kind: 'islet', cx: 970, top: 2720, w: 64, depth: 30, roundLip: 'right' },
  { id: 'd5', kind: 'islet', cx: 760, top: 2640, w: 90 },
  // E: the animal crossing - sky-birds patrol three of the gaps (time the hop)
  { id: 'e1', kind: 'islet', cx: 550, top: 2560, w: 64 },
  { id: 'e2', kind: 'islet', cx: 340, top: 2480, w: 60, roundLip: 'left' },
  { id: 'e3', kind: 'oneWay', cx: 380, top: 2360, w: 64 },
  { id: 'e4', kind: 'islet', cx: 590, top: 2270, w: 56 },
  { id: 'e5', kind: 'islet', cx: 800, top: 2190, w: 56 },
  { id: 'e6', kind: 'islet', cx: 1020, top: 2110, w: 90 },
  // F: the crate gate - a crate column on f1's near lip: ram it over, then land
  { id: 'f1', kind: 'islet', cx: 1190, top: 2000, w: 110, gate: true },
  // G: crumbling islets, narrowing
  { id: 'g1', kind: 'crumble', cx: 960, top: 1910, w: 56 },
  { id: 'g2', kind: 'crumble', cx: 750, top: 1830, w: 52 },
  { id: 'g3', kind: 'crumble', cx: 540, top: 1750, w: 50 },
  { id: 'g4', kind: 'islet', cx: 330, top: 1670, w: 80 },
  // H: one-way ledges, then the needle islets (48 -> 46 px), a crumble
  { id: 'h1', kind: 'oneWay', cx: 370, top: 1550, w: 60 },
  { id: 'h2', kind: 'oneWay', cx: 310, top: 1430, w: 56 },
  { id: 'h3', kind: 'islet', cx: 520, top: 1340, w: 48 },
  { id: 'h4', kind: 'islet', cx: 730, top: 1260, w: 46 },
  { id: 'h5', kind: 'crumble', cx: 940, top: 1180, w: 48 },
  { id: 'h6', kind: 'islet', cx: 1160, top: 1100, w: 70 },
  // I: the top tiers - down to SPRING_ISLES_MIN_FLAT, then the summit dock
  { id: 'i1', kind: 'oneWay', cx: 1120, top: 980, w: 48 },
  { id: 'i2', kind: 'oneWay', cx: 1190, top: 860, w: 44 },
  { id: 'i3', kind: 'islet', cx: 970, top: 770, w: 40 },
  { id: 'i4', kind: 'crumble', cx: 750, top: 690, w: 44 },
  { id: 'summit', kind: 'islet', cx: 530, top: 610, w: 240 },
];

/** Crumbling islets: shake this long after the first touch, then collapse; regrow after. */
export const CRUMBLE_DELAY_SEC = 1.4;
export const CRUMBLE_REGROW_SEC = 4;
const CRUMBLE_H = 16;

const stop = (id: string): RouteStop => SPRING_ISLES_ROUTE.find((s) => s.id === id)!;

/**
 * Islet outline (round 16): a flat top exactly `w` wide (samples every ~40 px), lips sloping
 * 5 px down just outside it, and a hanging underside (kit islandPoints, seeded).
 */
function isletPiece(s: RouteStop, i: number): TerrainPiece {
  const depth = s.depth ?? (s.kind === 'oneWay' ? 34 : Math.round(Math.min(150, 40 + s.w * 0.35)));
  const x0 = s.cx - s.w / 2;
  const x1 = s.cx + s.w / 2;
  const n = Math.max(1, Math.round(s.w / 40));
  const top: Vec2[] = Array.from({ length: n + 1 }, (_, k) => P(x0 + (s.w * k) / n, s.top));
  // lips: a 5 px corner, or (roundLip) a rounded 3-step curve reaching 9 px out and down
  const rl = s.roundLip === 'left';
  const rr = s.roundLip === 'right';
  const ux0 = x0 - (rl ? 9 : 5);
  const ux1 = x1 + (rr ? 9 : 5);
  const under = islandPoints(ux0, ux1, s.top, depth, 31 + i * 17, { pad: 1, bumps: 0 }).filter((p) => p.y > s.top + (rl || rr ? 9 : 1));
  const right = rr ? [P(x1 + 4, s.top + 1), P(x1 + 7, s.top + 4), P(ux1, s.top + 9)] : [P(ux1, s.top + 5)];
  const left = rl ? [P(ux0, s.top + 9), P(x0 - 7, s.top + 4), P(x0 - 4, s.top + 1)] : [P(ux0, s.top + 5)];
  return polygon(s.id, [...top, ...right, ...under, ...left], 'soil', {
    decorDensity: s.kind === 'oneWay' ? 0.15 : s.w >= 120 ? 0.35 : 0.2,
    ...(s.kind === 'oneWay' ? { oneWay: true } : {}),
  });
}

const routePieces: TerrainPiece[] = SPRING_ISLES_ROUTE.filter((s) => s.kind === 'islet' || s.kind === 'oneWay').map((s, i) => isletPiece(s, i));
const pieceOf = (id: string): TerrainPiece => routePieces.find((p) => p.id === id)!;

/** Side cliffs (rough inner faces) keep every arc inside the world. */
function cliff(id: string, left: boolean): TerrainPiece {
  const face = left ? WALL_L : WALL_R;
  const edge = left ? 0 : W;
  const inner = roughen([P(face, 0), P(face, H)].map((p) => P(p.y, p.x)), 120, 14, left ? 5 : 6).map((p) => P(p.y, p.x));
  const pts: Vec2[] = left ? [P(edge, 0), ...inner, P(edge, H)] : [P(edge, H), ...inner.reverse(), P(edge, 0)];
  return polygon(id, pts, 'rock', { decorDensity: 0.1, anchorable: false });
}

/**
 * Round 16: the gate's catch ledge under e6 and f1 (not a route stop). A hop that bounces off
 * the crate column (too weak to topple it) - or tumbles back over e6, or past f1 - drops onto it
 * instead of falling 900 px; it hops back to e6 (audit M2: 210 rams from anywhere on e6, every
 * one rests on e6, this ledge or f1). 240 px below f1: no way round the gate from here.
 */
export const GATE_CATCH: RouteStop = { id: 'gateCatch', kind: 'islet', cx: 1125, top: 2250, w: 330, depth: 30 };

/**
 * Round 16 audit M1: nets under the bird lanes (not route stops). A sting knocks a hop 60-90 px
 * long or short - off a 56-64 px islet - and the animal crossing hangs over ~1,500 px of open
 * air; a net turns that into a one-hop setback. `rejoin`: the route stop a hop from the net
 * gets back onto (within the 80 % envelope, tested).
 */
export const SPRING_ISLES_NETS: readonly (RouteStop & { rejoin: string })[] = [
  // under e1 -> e2: short falls between e1 and e2, long ones left of e2
  { id: 'netE12', kind: 'islet', cx: 322, top: 2620, w: 346, depth: 26, rejoin: 'e2' },
  // under e4 -> e5: short falls
  { id: 'netE45', kind: 'islet', cx: 705, top: 2370, w: 150, depth: 26, rejoin: 'e4' },
  // under e5 -> e6: long falls of e4 -> e5, short ones of e5 -> e6 (long ones land on GATE_CATCH)
  { id: 'netE56', kind: 'islet', cx: 895, top: 2290, w: 112, depth: 26, rejoin: 'e5' },
];

const terrain: TerrainPiece[] = [
  // the meadow: a broad flat ground across the bottom
  polygon('meadow', [P(0, MEADOW_Y), P(W, MEADOW_Y), P(W, H), P(0, H)], 'soil', { decorDensity: 0.4 }),
  cliff('cliffL', true),
  cliff('cliffR', false),
  ...routePieces,
  isletPiece(GATE_CATCH, SPRING_ISLES_ROUTE.length),
  ...SPRING_ISLES_NETS.map((n, k) => isletPiece(n, SPRING_ISLES_ROUTE.length + 1 + k)),
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

// ------------------------------------------------------------------ round 16: vine curtains

/** Vine curtain: vines hanging from an islet's underside across the gap below it (floatingIsles' vines). */
export const CURTAIN_VINE_LEN = 110;

/**
 * A vine from the underside of route islet `islandId` at x. Anchored just BELOW the rock (not
 * inside it, as on the Floating Isles): terrain outlines are one-sided chains, so a link
 * starting inside the rock could be shoved up through it and out over the islet's top.
 */
function hang(id: string, islandId: string, x: number, length: number): VineEntity {
  const y = Math.round(bottomAt(pieceOf(islandId).points, x)) + 3;
  return { id, kind: 'vine', x, y, length, segments: Math.max(4, Math.round(length / 24)) };
}

/**
 * The islets whose vines curtain the hop into the stop that names a `curtain`: d2 over
 * c7 -> d1, d4 over d2 -> d3. The vines hang under the islet (dx from its centre) where the
 * curtain hop crosses them but the hop UP onto that islet does not: d2's under its far (left)
 * half; d4's centred (measured: shifted right, the d2 -> d3 hop leaves them swinging into the
 * d3 -> d4 arc a second later - 7 exact-jumper misses; centred: none).
 */
export const SPRING_ISLES_CURTAINS: readonly { over: string; into: string; dx: readonly number[] }[] = [
  { over: 'd2', into: 'd1', dx: [-24, -12, 0] },
  { over: 'd4', into: 'd3', dx: [-12, 0, 12] },
];

const vines: VineEntity[] = SPRING_ISLES_CURTAINS.flatMap(({ over, dx }) => dx.map((d, k) => hang(`vine_${over}_${k}`, over, stop(over).cx + d, CURTAIN_VINE_LEN)));

// ------------------------------------------------------------------ round 16: patrolling sky-birds

/** A bird's sting: a dent, never a kill (a full hull takes 7). */
export const SKY_BIRD_HARM = 0.15;
/** Round 16 audit M1: the sideways swat (px/s) - a stung hop lands long / short, onto a net at worst. */
export const SKY_BIRD_KNOCK = 70;
/** Each bird bobs on a thin diamond loop across the middle of the gap between two islets. */
function skyBird(id: string, from: string, to: string, dy: number, speed: number): CreatureEntity {
  const a = stop(from);
  const b = stop(to);
  return {
    id,
    kind: 'creature',
    species: 'dragonBird',
    x: Math.round((a.cx + b.cx) / 2),
    y: Math.round(Math.min(a.top, b.top) - 30 + dy),
    path: [P(0, -80), P(14, 0), P(0, 80), P(-14, 0)],
    speed,
    scale: 0.5,
    harm: SKY_BIRD_HARM,
    hitRadius: 13,
    knock: SKY_BIRD_KNOCK,
  };
}

/**
 * The three patrolled gaps (animal crossing): e1 -> e2, e4 -> e5, e5 -> e6 - each over a net
 * (or the gate's catch ledge) so a sting costs at most ~2 hops (audit M1; e3 -> e4 crosses
 * above e1 and has no room for one).
 */
export const SPRING_ISLES_BIRDS: readonly CreatureEntity[] = [skyBird('bird1', 'e1', 'e2', 0, 55), skyBird('bird2', 'e4', 'e5', 0, 65), skyBird('bird3', 'e5', 'e6', 0, 75)];

// ------------------------------------------------------------------ round 16: the crate gate

/** Crate edge (px) and density (kg/m²; the hull is ~1.8 kg, a crate ~0.54). */
export const CRATE = 22;
export const CRATE_DENSITY = 1;
export const CRATE_ROWS = 4;
const GATE = stop('f1');
/** The crate column stands on f1's left (near) lip: its top is out of reach from e6, so the only way on is through it. */
export const SPRING_ISLES_CRATES: readonly StaticPropEntity[] = Array.from({ length: CRATE_ROWS }, (_, r) => ({
  id: `crate${r}`,
  kind: 'staticProp' as const,
  sprite: 'prop.crate' as const,
  x: GATE.cx - GATE.w / 2 + 2 + CRATE / 2,
  y: GATE.top - CRATE / 2 - r * CRATE,
  w: CRATE,
  h: CRATE,
  dynamic: true,
  density: CRATE_DENSITY,
}));

const SUMMIT = stop('summit');

const entities: EntitySpec[] = [
  // sky life (background parallax, as on the Floating Isles)
  { id: 'whale1', kind: 'creature', species: 'skyWhale', x: 700, y: 3700, path: [P(0, 0), P(500, -300), P(0, -600), P(-500, -300)], speed: 30, depth: 0.8, scale: 2 },
  { id: 'flock1', kind: 'creature', species: 'dragonBird', x: 400, y: 2000, path: [P(0, 0), P(600, -100), P(300, 120)], speed: 60, depth: 0.6, scale: 0.4 },
  { id: 'whale2', kind: 'creature', species: 'skyWhale', x: 900, y: 800, path: [P(0, 0), P(-600, 200), P(0, 400), P(400, 200)], speed: 25, depth: 0.85, scale: 2.4 },
  ...SPRING_ISLES_BIRDS,
  ...vines,
  ...SPRING_ISLES_CRATES,
  // decor (never on a landing line: the edges of the bigger islets)
  deco('fernM', 'prop.fern', 120, MEADOW_Y - 8, 16, 16),
  deco('treeM', 'prop.tree', 520, MEADOW_Y - 20, 32, 40),
  on('treeA2', 'a2', 'prop.palm', 90, 32, 40),
  on('fernA4', 'a4', 'prop.fern', -100, 16, 16),
  on('treeB4', 'b4', 'prop.tree', -50, 32, 40),
  on('fernC7', 'c7', 'prop.fern', 38, 16, 16),
  on('fernD5', 'd5', 'prop.fern', -38, 16, 16),
  on('fernE6', 'e6', 'prop.fern', 38, 16, 16),
  on('fernG4', 'g4', 'prop.fern', -34, 16, 16),
  on('treeS', 'summit', 'prop.tree', -100, 32, 40),
  ...SPRING_ISLES_ROUTE.filter((s) => s.kind === 'crumble').map(crumble),
  // the summit dock
  { id: 'exit', kind: 'exitDock', x: SUMMIT.cx + 30, y: SUMMIT.top - 10, w: 120, h: 60, requireLanding: true },
];

/** Resting respawn on route stop `id` (standing at dx from its centre). */
export function restOn(id: string, dx = 0): { x: number; y: number } {
  const s = stop(id);
  return { x: s.cx + dx, y: s.top - STAND_DY };
}

/** Round 16: denser checkpoints - every 3-5 stops from a4 on (each a resting respawn on a wider islet). */
export const SPRING_ISLES_CHECKPOINT_STOPS = ['a4', 'b4', 'c3', 'c7', 'd5', 'e3', 'e6', 'f1', 'g4', 'h3', 'h6', 'i2'] as const;

export const SPRING_ISLES_CHECKPOINTS: readonly CheckpointSpec[] = SPRING_ISLES_CHECKPOINT_STOPS.map((id) => {
  const s = stop(id);
  // f1: rest right of the crate column (the gate is behind you)
  // audit L2: the gate's band starts right of the crate column (standing ON the column is not past it)
  const x0 = s.gate ? s.cx - s.w / 2 + 2 + CRATE + 2 : s.cx - s.w / 2;
  return { id: `cp_${id}`, at: 'enterRegion' as const, rect: { x: x0, y: s.top - 40, w: s.cx + s.w / 2 - x0, h: 40 }, respawn: restOn(id, s.gate ? 25 : 0) };
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

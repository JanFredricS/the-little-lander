/**
 * Map 6 — The Hollow (harpoonThrust: the pod with its thruster stage
 * re-attached — rope guns + main engine + rotation). ~16,000 px across the
 * planet's hollow interior: a jungle floor far below, the crust above, an
 * artificial sun hanging from the crust in the middle, waterfalls pouring
 * from the crust, floating rocks everywhere, and (round 13) rock spires from
 * the floor and crystal spires from the crust closing in on the flight line.
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
 *    Round 13 (spires): ~275 s, 27 orbs, 3 hits, fuel >= 0.44, 9 spire scrapes.
 *  - "lazy" line (ignores the sun): complete in ~200 s, 25 orbs, 7 hits,
 *    hull 0.58; at other cruise speeds it runs dry 1 in 2 times — ignoring the
 *    telegraph is meant to hurt. Round 13: ~175 s, 26 orbs, 3 hits, fuel >= 0.62.
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
import { type S7Spire, s7Band, s7Blob, s7DistToPolygon, s7Noise, s7Piece, s7Profile, s7Prop, s7Scatter, s7SpireHalf, s7SpirePoints } from './s7Helpers';

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

const floorY = (x: number) => surfaceY(GROUND, x);
const ceilY = (x: number) => surfaceY(CEILING, x);
/** The natural flight line's y at x (px). */
export const hollowRouteY = (x: number): number => routeY(x);
/** The jungle floor's / the crust's surface y at x (px, before spires). */
export const hollowFloorY = floorY;
export const hollowCeilY = ceilY;

/** Sheltered spots: in each rock's shadow, as seen from the sun. */
export const HOLLOW_SHELTERS: Vec2[] = HOLLOW_ROCKS.map((k) => {
  const d = { x: k.x - HOLLOW_SUN.x, y: k.y - HOLLOW_SUN.y };
  const l = Math.hypot(d.x, d.y);
  const off = k.r * 1.25 + 45; // blobs are 1.25 r wide
  return { x: Math.round(k.x + (d.x / l) * off), y: Math.round(k.y + (d.y / l) * off) };
});

// ------------------------------------------------------------------ spires (round 13)

/**
 * Round 13 (user: "harpoon mission too easy, should be more stalactites from floor and
 * roof to make it more tricky. also if the user falls to the floor they get stuck due to
 * cable not long enough to reach anything"). SOLID spires, placed along the route:
 *  - stalagmites (rock) from the floor every ~SPIRE_STEP px and stalactites (crystal)
 *    from the crust staggered half a step between them: the flight line zig-zags between
 *    their tips (tips SPIRE_GAP_MIN..MAX = 110..150 px off the line). Every GATE_EVERY
 *    slots (or the first slot after that with room, sliding the pair up to GATE_SLIDE px)
 *    a stalagmite gets a stalactite right above it: a gate, tips GATE_GAP px off the line.
 *    A gate's upper jaw may be a floating rock hanging from its stalactite.
 *    As generated: 93 spires (42 floor, 51 crust), 9 gates, 6 of them a slot <= 230 px.
 *  - Spires keep clear of the floating rocks, their sheltered spots (with a pocket to
 *    dive into) and the bonus orbs: a spire first slides up to SPIRE_SLIDE px along its
 *    slot, and only then gives its tip way (TIP_CLEAR px). A roof spire centred over a
 *    rock runs into it instead, but its tip is clamped to the rock's centre: it ends
 *    INSIDE the rock (the rock hangs from it; its underside is unchanged), never through.
 *  - Invariants (enforced here, measured on the polygons in test/hollow.test.ts): floor
 *    spires are >= FLOOR_SPIRE_MIN_GAP (230) px apart, base centre to base centre (every
 *    placement, gate pairs included, goes through the same spacing check), and the
 *    flight line keeps >= ROUTE_CLEAR (70) px of open air to every spire outline (a tip
 *    that comes closer is shortened in 10 px steps).
 *  - The roof crystal is translucent (TerrainPiece.castsShadow false): solid and
 *    anchorable, but the sun shines through, so the roof spires add no free cover (rock
 *    stalactites shaded the whole flight line beyond them). Floor spires are rock and
 *    cast shadows like any terrain.
 *  - The floor softlock: a pod resting on the floor (or, in the UP zones, on the crust)
 *    with an empty tank is never far from a spire flank; flanks, spire tips and the rocks
 *    above them form a ladder within rope reach (ropeRange 400 here, was 320) up to the
 *    flight line and its fuel orbs. test/hollow.test.ts climbs out on the rope alone
 *    from every gap between spires (spots derived from the spire spans at pod height:
 *    each gap's middle and 23 px off each flank); with the old cavern or a 320 px rope
 *    it got out of 3 / 22 of 30 grid spots.
 */
export const SPIRE_STEP = 340;
const SPIRE_GAP_MIN = 110;
const SPIRE_GAP_MAX = 150;
const GATE_EVERY = 3;
const GATE_GAP = 90;
const TIP_CLEAR = 60;
/** Open air (px) between the flight line and any spire outline (the pod is 16 x 22). */
export const ROUTE_CLEAR = 70;
/** Min spacing (px) of floor spires (base centres). */
export const FLOOR_SPIRE_MIN_GAP = 230;
/** How far (px) a spire may slide along its slot to dodge a rock. */
const SPIRE_SLIDE = 120;
/** How far (px) a gate pair may slide to find room for both tips. */
const GATE_SLIDE = 120;
const SPIRE_X0 = 900;
const SPIRE_X1 = 15100;

/** A Hollow spire (the S7 spire, src/levels/s7Helpers.ts - shared with the Vaults' stalactites since round 17). */
export type HollowSpire = S7Spire;

/**
 * Things a spire must stay clear of: rock blobs (1.25 r x 1.16 r), the sheltered spots
 * (with a pod-sized pocket around them to dive in on a telegraph) and bonus orbs.
 */
const spireBlockers = (): { x: number; y: number; hw: number; hh: number; rock: boolean }[] => [
  ...HOLLOW_ROCKS.map((k) => ({ x: k.x, y: k.y, hw: k.r * 1.25 * 1.16, hh: k.r * 1.16, rock: true })),
  ...HOLLOW_SHELTERS.map((p) => ({ x: p.x, y: p.y, hw: 60, hh: 60, rock: false })),
  ...HOLLOW_ROCKS.map((k) => ({ x: k.x + k.r * 1.25 + 30, y: k.y, hw: 12, hh: 20, rock: false })), // bonus-orb spots (beside rocks)
];

function spireHalf(len: number): number {
  return s7SpireHalf(len);
}
/** Spire half-width (px) at fraction t (0 base .. 1 tip), incl. the worst lean and jitter (see spirePoints). */
const spireHalfAt = (half: number, t: number) => (half * (1 - Math.min(1, Math.max(0, t))) ** 1.15 + 7) * 1.1 + 0.25 * half;

export const HOLLOW_SPIRES: HollowSpire[] = (() => {
  const out: HollowSpire[] = [];
  const rand = rng(hashString('hollow.spires'));
  const blockers = spireBlockers();
  /**
   * The tip a spire at x can have, aiming `off` px off the route. It gives way to every
   * blocker its body would touch (checked at the spire's width at that height), except
   * that a roof spire may run INTO a floating rock it is centred over: the rock then hangs
   * from the stalactite (its underside stays the anchor / cover it was).
   */
  const tipAt = (from: 'floor' | 'ceiling', x: number, off: number) => {
    const surf = from === 'floor' ? floorY(x) : ceilY(x);
    const want = from === 'floor' ? routeY(x) + off : routeY(x) - off;
    const dir = from === 'floor' ? -1 : 1; // growth direction (y) from the surface
    let tip = want;
    let hang: number | null = null;
    let hangBottom = 0;
    for (let pass = 0; pass < 4; pass++) {
      const len = Math.abs(surf - tip);
      const half = spireHalf(len);
      for (const b of blockers) {
        // the blocker's extent along the spire, measured from the surface
        const near = dir < 0 ? surf - (b.y + b.hh) : b.y - b.hh - surf;
        if (near > Math.abs(surf - tip) + TIP_CLEAR) continue; // beyond the tip
        const t = Math.max(0, near - TIP_CLEAR) / Math.max(1, len);
        if (Math.abs(b.x - x) > spireHalfAt(half, t) + b.hw + TIP_CLEAR / 2) continue;
        if (b.rock && from === 'ceiling' && Math.abs(b.x - x) < b.hw * 0.5) {
          if (hang === null || b.y < hang) {
            hang = b.y; // ends inside this rock (see below)
            hangBottom = b.y + b.hh;
          }
          continue;
        }
        tip = dir < 0 ? Math.max(tip, b.y + b.hh + TIP_CLEAR) : Math.min(tip, b.y - b.hh - TIP_CLEAR);
      }
    }
    // a roof spire over a rock never reaches past the rock's middle: it ends INSIDE it,
    // so the rock's underside (anchor face, sun cover) is untouched
    if (hang !== null) tip = Math.min(tip, hang);
    // the upper jaw of a gate: the spire's tip, or the underside of the rock it ends in
    const jaw = hang !== null && tip === hang ? hangBottom : tip;
    return { tip, len: Math.abs(surf - tip), giveWay: Math.abs(tip - want), jawGiveWay: Math.abs(jaw - want) };
  };
  /** Slide a spire up to `slide` px along its slot to where its tip gives way least (a rock in the way moves the spire rather than shortening it). */
  const lastX = { floor: -Infinity, ceiling: -Infinity };
  /** Keep spires of one surface this far apart (px) after sliding: no clumps, no wide floor gaps. */
  const minGap = { floor: FLOOR_SPIRE_MIN_GAP, ceiling: 130 };
  const room = (from: 'floor' | 'ceiling', x: number) => x >= lastX[from] + minGap[from];
  const place = (from: 'floor' | 'ceiling', x0: number, off: number, slide = SPIRE_SLIDE) => {
    x0 = Math.max(x0, lastX[from] + minGap[from]);
    let best = { x: x0, ...tipAt(from, x0, off) };
    for (let d = 20; d <= slide; d += 20)
      for (const x of [x0 - d, x0 + d]) {
        if (!room(from, x)) continue;
        const c = { x, ...tipAt(from, x, off) };
        if (c.giveWay < best.giveWay - 15) best = c;
      }
    return best;
  };
  const push = (id: string, from: 'floor' | 'ceiling', p: { x: number; tip: number; len: number }) => {
    const surf = from === 'floor' ? floorY(p.x) : ceilY(p.x);
    const away = from === 'floor' ? 1 : -1; // tip shortening direction (y)
    let sp: HollowSpire = { id, from, x: Math.round(p.x), tip: Math.round(p.tip), base: Math.round(2 * spireHalf(p.len)) };
    // the flight line keeps ROUTE_CLEAR px of open air to the spire's actual outline
    while (Math.abs(surf - sp.tip) >= 60 && spireRouteClearance(sp) < ROUTE_CLEAR) {
      const tip = sp.tip + away * 10;
      sp = { ...sp, tip, base: Math.round(2 * spireHalf(Math.abs(surf - tip))) };
    }
    if (Math.abs(surf - sp.tip) < 60) return;
    out.push(sp);
    lastX[from] = p.x;
  };
  let k = 0;
  let lastGate = -GATE_EVERY;
  for (let x = SPIRE_X0; x <= SPIRE_X1; x += SPIRE_STEP, k++) {
    const jx = x + (rand() - 0.5) * 60;
    const off = SPIRE_GAP_MIN + rand() * (SPIRE_GAP_MAX - SPIRE_GAP_MIN);
    const offC = SPIRE_GAP_MIN + rand() * (SPIRE_GAP_MAX - SPIRE_GAP_MIN);
    // a gate (stalagmite + stalactite right above it) every GATE_EVERY slots, or the
    // first slot after that where both tips fit without giving way
    let gate = false;
    if (k - lastGate >= GATE_EVERY) {
      // slide the pair together to where both tips fit best
      const gx = Math.max(jx, lastX.floor + minGap.floor, lastX.ceiling + minGap.ceiling);
      let m = { x: gx, ...tipAt('floor', gx, GATE_GAP) };
      let c = tipAt('ceiling', gx, GATE_GAP);
      for (let d = -GATE_SLIDE; d <= GATE_SLIDE; d += 20) {
        if (!room('floor', gx + d) || !room('ceiling', gx + d)) continue;
        const mm = { x: gx + d, ...tipAt('floor', gx + d, GATE_GAP) };
        const cc = tipAt('ceiling', gx + d, GATE_GAP);
        if (Math.max(mm.giveWay, cc.jawGiveWay) < Math.max(m.giveWay, c.jawGiveWay) - 5) {
          m = mm;
          c = cc;
        }
      }
      // (a gate's upper jaw may be a floating rock hanging from its stalactite)
      if (m.giveWay <= 30 && c.jawGiveWay <= 40) {
        push(`mite${k}`, 'floor', m);
        push(`gate${k}`, 'ceiling', { x: m.x, ...c });
        gate = true;
        lastGate = k;
      }
    }
    if (!gate) push(`mite${k}`, 'floor', place('floor', jx, off));
    const cx = x + SPIRE_STEP / 2 + (rand() - 0.5) * 60;
    if (cx <= SPIRE_X1) push(`tite${k}`, 'ceiling', place('ceiling', cx, offC));
  }
  return out;
})();

/** Distance (px) from a point to a polygon's outline; 0 inside. */
export function distToPolygon(p: Vec2, pts: readonly Vec2[]): number {
  return s7DistToPolygon(p, pts);
}

/** Open air (px) between the flight line and a spire's outline (sampled every 4 px). */
export function spireRouteClearance(sp: HollowSpire): number {
  const pts = spirePoints(sp);
  let x0 = Infinity;
  let x1 = -Infinity;
  for (const q of pts) {
    x0 = Math.min(x0, q.x);
    x1 = Math.max(x1, q.x);
  }
  let best = Infinity;
  for (let x = x0 - 120; x <= x1 + 120; x += 4) best = Math.min(best, distToPolygon({ x, y: routeY(x) }, pts));
  return best;
}

/** A spire as a polygon (s7SpirePoints on the Hollow's floor / crust). */
export function spirePoints(sp: HollowSpire): Vec2[] {
  return s7SpirePoints(sp, floorY, ceilY);
}

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
  // floor spires are rock (they cast sun shadows like the jungle rocks); roof
  // spires are translucent crystal: solid and anchorable, but the sun shines
  // through them, so they tighten the corridor without handing out free cover
  ...HOLLOW_SPIRES.map((sp) =>
    sp.from === 'floor'
      ? s7Piece(sp.id, 'polygon', spirePoints(sp), { material: 'rock', decorDensity: 0.2 })
      : s7Piece(sp.id, 'polygon', spirePoints(sp), { material: 'crystal', decorDensity: 0.2 }, { castsShadow: false }),
  ),
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
    // round 13: a longer rope - from any floor gap a spire flank, and from a spire tip the route, is in reach
    'harpoonThrust.ropeRange': 400,
  },
};

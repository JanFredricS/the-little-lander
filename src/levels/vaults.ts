/**
 * Map 5 — The Vaults (harpoon mode: the ascent-stage pod, rope guns only,
 * no thrusters). ~14,000 px of cave in two chained sections.
 *
 *  A. Swing school (x 0-6600): generous rock roof ~280 px above the floor,
 *     three god-ray holes to the surface (you must swing past them — no
 *     anchor in the light shaft), alien glow-vegetation, three gentle pits
 *     whose roof dips so a pod that drops in can always rope back out, and
 *     seven short solid stalactites (70-80 px) to swing past or rope.
 *  B. Mastery (x 6600-13300): four chasms (a fall is fatal), three brittle
 *     roof stretches (anchors crack after 1.4 s: keep re-anchoring), two
 *     roof collapses that rain debris while you cross, a higher roof in
 *     places (longer ropes), seven longer stalactites (100-180 px; three hang
 *     low enough that a lazy pendulum clips them, five are brittle), seven
 *     short lip pegs by the chasm lips (always sound, even in a brittle
 *     stretch), darkness deepening while bioluminescent spores thicken.
 *     Five checkpoints: as B starts and past each chasm (A has none).
 *  End: the research team's camp (x ~13650) — lower yourself onto the pad
 *  (soft landing inside the camp dock).
 *
 * Design rules (tested in test/s7.levels.test.ts and test/vaults.test.ts):
 * anchorable roof within harpoon range (ropeRange - margin) of the swing line
 * along the whole route; the roof is never out of reach over a chasm except
 * at god-ray holes, which are narrower than a rope swing; from EVERY floor
 * spot in both sections (50 px grid, chasms excepted) the rope alone hauls
 * the pod back up under the roof; no rope can hold the pod below lip level
 * over a chasm (VAULTS_LIP_CLEAR); stalactites keep >= 250 px from the holes,
 * >= 100 px from the A pits and the collapses; the bottom 20 px of every
 * stalactite (10 px of a lip peg) takes no harpoon.
 *
 * Round 17 — solid stalactites (playtest feedback: "the stalactites I expected
 * to be physical hindrances, not hovering background"). VAULTS_STALACTITES are
 * real terrain (rock tiles, round-13 spire outline via s7SpirePoints), all
 * anchorable; the non-solid prop.stalactite drips stay only >= 150 px from them
 * (VAULTS_DRIP_CLEAR) and the caves backdrop's silhouettes were pushed back
 * (src/art/backdrops.ts: smaller, flat deep-rock shades, no outline, parallax
 * 0.3 — this also changes The Throat, which shares the caves theme).
 * What the playtests taught (24 harpoon-pilot variants, test/support/s7Pilots.ts):
 *  - longer A stalactites (90-150 px) gave lower anchors, so pendulums scraped
 *    the pit lips (A hull loss median ~0.13 vs 0.00 before): cut to 70-80 px
 *    (now median 0.07, max 0.20);
 *  - a stalactite over a chasm let a long pendulum swing below lip level into
 *    the far wall, and one just past a lip held the pod against the chasm wall,
 *    roped into the corner with nothing else in reach (a soft-lock): both
 *    banned by VAULTS_LIP_CLEAR;
 *  - B's floor was never rope-recoverable before: its roof is 284-374 px above
 *    the floor (5 px grid, chasm lips excepted; rope 320), 59 of 209 floor spots
 *    in B were soft-locks. The stalactites rescue most; lip pegs (short stubs
 *    ~180 px in from each lip) the rest, and collapse 2 moved to [12450, 12800]
 *    to make room for its west peg. Now 0 of 209 upright, 0 of 263 tipped.
 * Round-17 audit fixes:
 *  - M1, the winch dragged the pod into the spire it was roped to (a tipped pod
 *    at x 8650 roped stalactite 10's flank and died reeling in; a short rope on
 *    stalactite 14's tip let the pod orbit the tip into its far flank, 249 px/s).
 *    Fixed generally in harpoonRig.ts (the winch also stalls on rock within 20 px
 *    of a leading corner along the rope line to the anchor) and here: the bottom
 *    VAULTS_TIP_NO_ANCHOR px of each tip is a noAnchorRegion (10 px on the pegs,
 *    which sit at the edge of reach from the lip ledges). Reel-in matrix (every
 *    stalactite / peg, dx 0 / +-45, upright / +-1.3 rad, aimed up / at the tip /
 *    at the low flank, 8 s reel, 567 cases): 1 crash -> 0 (pinned). At dx +-90:
 *    31 of 252 (up / tip aims) -> 1 of 378 (with the flank aim). Plain roof
 *    unchanged: straight-up reels still reach ropeMin (pinned).
 *  - M2, checkpoints (VAULTS_CHECKPOINTS): B start + past each of the 4 chasms.
 *  - L2, collapse 2 covers only the east 350 px of chasm 4 (the west 200 px stay
 *    rain-free, like collapse 1 over chasm 2); 6 pilot variants respawned at
 *    checkpoint chasm3 all cross under the live rain and land.
 *  - L3, the lip pegs at 8770 / 10570 / 12070 stand in brittle stretches but hold
 *    (VAULTS_BRITTLE_SPANS cut the brittle zones around them; the roof beside
 *    them still cracks).
 * Measured (after the audit fixes, 24 variants): all 24 reach the camp on their
 * first life (no checkpoint needed); time median 101 s (HEAD 99), hull median
 * 0.86 / min 0.47 (HEAD 0.90 / 0.58; before the audit fixes 0.78 / 0.32); hull
 * lost in A median 0.04 (HEAD 0.00), in B 0.10 (HEAD 0.09). The reference pilot:
 * 102 s, hull 0.90. Nearly all damage is floor scrapes and collapse debris; no
 * pilot run struck a stalactite head-on (they shape the swings instead) — a
 * pendulum swung under one does strike it (pinned).
 *
 * Playtest notes (S7): played headless by the reference autopilot
 * (test/s7.playtest.test.ts: ray-cast "what's on screen" anchor picks,
 * hand-over-hand, re-fire while swinging forward, lower onto the pad) —
 * completed in ~92 s with hull 0.79; 8 pilot variants (reel timing, reach,
 * switch length) all crossed all four chasms with no crash, 6/8 also finished
 * the landing (the other two dangled over the pad; round 17 taught the pilot
 * to right a tipped pod and to lower only while upright). Tuning that came out of it:
 *  - harpoon.ropeBreakAccel 600 (S1 default 150 snapped the rope on every
 *    slack -> taut catch above ~75 px/s, i.e. on every real swing);
 *  - harpoon.damageSpeed 110 / crashSpeed 240: a mistimed swing into the roof
 *    costs hull instead of the run;
 *  - reelOutSpeed 85 px/s < damageSpeed: holding "reel out" lowers you onto a
 *    floor without damage (the camp landing, pit recoveries);
 *  - pit roof dips widened (the pod could wedge against a steep dip wall);
 *  - camp dock 520 px wide: an overshooting swing still lands in camp;
 *  - brittle anchors 1.4 s (1.0 s left no time to pick the next anchor).
 * Darkness (audit cycle 1, drawn by src/render/s7LevelFx.ts S7_DARKNESS):
 * a world-covering near-black overlay whose alpha smoothsteps from 0 at
 * x 6600 (Section B start) to 0.6 at x 13000 and holds through the camp;
 * glow plants / mushrooms / crystals / spores within 1400 px of the pod get
 * an additive cyan halo (alpha up to ~0.1 outer / 0.22 core, scaled by the
 * darkness) so they punch through. Max 0.6 was browser-playtested: route,
 * chasm lips and brittle markers stay readable up to ~0.65; beyond that the
 * mid-parallax silhouettes merge with real terrain near the chasms.
 * Two harpoon-rig bugs were found and fixed here (roped pods fell through
 * terrain; the winch crushed pods into rock) — see src/physics/vessel/harpoonRig.ts.
 */

import { rectPoints, surfaceY } from './kit';
import type { EntitySpec, LevelSpec, TerrainPiece, ZoneSpec } from '../contracts';
import { type S7Spire, s7Band, s7Notch, s7Noise, s7Piece, s7Profile, s7Prop, s7Scatter, s7SpireHalf, s7SpirePoints } from './s7Helpers';

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
export const VAULTS_COLLAPSES: readonly [number, number][] = [
  [9150, 9700],
  // round 17: was [12000, 12600] (west ledge + chasm 4); now the east 350 px of chasm 4
  // only, mirroring the first one over chasm 2: its west ledge keeps a lip peg
  // (VAULTS_STALACTITES) and the first 200 px of the chasm stay rain-free - the swing
  // off the peg starts in the clear, and the 12 s rain (triggered at x 12100) can be
  // waited out on the ledge
  [12450, 12800],
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

const floorY = (x: number) => surfaceY(VAULTS_GROUND, x);
const roofY = (x: number) => surfaceY(VAULTS_CEILING, x);

// ------------------------------------------------------------------ stalactites (round 17)

/**
 * Solid rock stalactites hanging from the roof (round 17: the scattered
 * prop.stalactite decor read as touchable but was not). [x, length px below
 * the local roof]. Sparse and short in A (the swing school), longer in B, with
 * a few hung low enough that a lazy, low pendulum clips them. All are anchorable
 * rock built with the round-13 spire outline (s7SpirePoints; the Vaults have no
 * sun, so nothing to shade and no crystal needed).
 * Placement rules (pinned in test/vaults.test.ts): >= 250 px from a god-ray
 * hole (its no-anchor crossing stays a clean swing), >= 100 px off the A pits
 * and the debris-collapse spans, and clear of the chasm lips (VAULTS_LIP_CLEAR).
 */

/**
 * No stalactite point may be within `reach` px (rope range 320 + the pod) of any spot
 * `below` px under lip level over a chasm: no rope can hold a pod down there (the roof
 * alone never could - pinned too).
 */
export const VAULTS_LIP_CLEAR = { below: 20, reach: 330 };

const STALACTITE_PLAN: readonly [number, number][] = [
  // A: seven, 750-1100 px apart, 70-80 px long (tips >= 170 px above the floor), on
  // the flats between holes and pits: short enough that the swing school's
  // pendulums pass under them (round-17 playtests: 90-110 px ones put the anchors
  // low enough that pendulums scraped the pit lips)
  [900, 70],
  [2000, 70],
  [2750, 70],
  [3650, 80],
  [4400, 80],
  [5300, 70],
  [6300, 80],
  // B: seven, 350-1450 px apart (the chasms between them), 100-180 px long; the low
  // ones mid-ledge, where a lazy pendulum clips them. Five hang in the brittle
  // stretches, so they crack like the roof there. None hangs over or near a chasm
  // (VAULTS_LIP_CLEAR): round-17 playtests found two traps there - a stalactite
  // over a chasm let a long pendulum swing below lip level into the far wall, and
  // one just past a lip held the pod against the chasm wall, roped into the corner
  // with nothing else in reach
  [6950, 130],
  [8250, 180], // low
  [8600, 130],
  [10050, 180], // low
  [10420, 130],
  [11720, 170], // low
  [13150, 100], // the last: short, so the run-in to the camp stays calm
];

/**
 * Lip pegs: short stubs ~180 px in from each chasm lip on the ledge side, tips at
 * y 375-390 (as low as VAULTS_LIP_CLEAR allows, with 5 px to spare). B's roof is
 * 284-374 px above its floor - mostly out of rope reach (320) - so on the pre-round-17 map
 * 59 of 209 floor spots in B (50 px grid) were rope-only soft-locks; the stalactites
 * rescue most of them, the pegs the ledges at the chasm lips, where a longer
 * stalactite would break VAULTS_LIP_CLEAR. [x, tip y].
 */
const LIP_PEGS: readonly [number, number][] = [
  [8100, 375], // chasm 1 east lip
  [8770, 390], // chasm 2 west lip
  [9880, 390], // chasm 2 east lip
  [10570, 375], // chasm 3 west lip
  [11530, 380], // chasm 3 east lip
  [12070, 390], // chasm 4 west lip
  [12980, 385], // chasm 4 east lip
];

export const VAULTS_STALACTITES: readonly S7Spire[] = [
  ...STALACTITE_PLAN.map(([x, len], i) => ({
    id: `stalactite${i + 1}`,
    from: 'ceiling' as const,
    x,
    tip: Math.round(roofY(x) + len),
    base: Math.round(2 * s7SpireHalf(len)),
  })),
  ...LIP_PEGS.map(([x, tip], i) => ({
    id: `lipPeg${i + 1}`,
    from: 'ceiling' as const,
    x,
    tip,
    base: Math.round(2 * s7SpireHalf(tip - roofY(x))),
  })),
];

/** A stalactite's outline (s7SpirePoints on the Vaults' roof). */
export const vaultsStalactitePoints = (sp: S7Spire) => s7SpirePoints(sp, floorY, roofY);

const terrain: TerrainPiece[] = [
  s7Piece('roof', 'ceiling', VAULTS_CEILING, { material: 'rock', decorDensity: 0.3 }),
  s7Piece('floor', 'ground', VAULTS_GROUND, { material: 'rock', decorDensity: 0.35 }),
  s7Piece('wallWest', 'polygon', rectPoints(0, 200, 30, 380), { material: 'rock' }),
  s7Piece('wallEast', 'polygon', rectPoints(W - 30, 200, 30, 430), { material: 'rock' }),
  // crystal outcrops on the chasm lips (visual landmarks; solid, anchorable)
  s7Piece('lip1', 'polygon', [{ x: 7270, y: 700 }, { x: 7350, y: 640 }, { x: 7360, y: 760 }], { material: 'crystal' }),
  s7Piece('lip2', 'polygon', [{ x: 9700, y: 660 }, { x: 9780, y: 700 }, { x: 9700, y: 760 }], { material: 'crystal' }),
  ...VAULTS_STALACTITES.map((sp) => s7Piece(sp.id, 'polygon', vaultsStalactitePoints(sp), { material: 'rock', decorDensity: 0.2 })),
];

// ------------------------------------------------------------------ entities

const inChasm = (x: number) => VAULTS_CHASMS.some(([a, b]) => x > a - 30 && x < b + 30);
const inHole = (x: number) => VAULTS_HOLES.some(([a, b]) => x > a - 20 && x < b + 20);

/** Decor drips stay this far (px) from a solid stalactite's base. */
export const VAULTS_DRIP_CLEAR = 150;
const nearStalactite = (x: number) => VAULTS_STALACTITES.some((sp) => Math.abs(x - sp.x) < sp.base / 2 + VAULTS_DRIP_CLEAR);

const decor: EntitySpec[] = [
  // god rays down each hole
  ...VAULTS_HOLES.map(([a, b], i) => s7Prop(`godRay${i}`, 'prop.godRay', (a + b) / 2, 330, b - a + 40, 560, { foreground: true })),
  // glow vegetation on the floor: lush in A, sparse in B
  ...s7Scatter('glowPlant', 'prop.glowPlant', 500, 13300, (x) => (x < VAULTS_SECTION_B ? 9 : 3), (x) => (inChasm(x) ? null : { y: floorY(x) - 10, w: 16, h: 20 })),
  ...s7Scatter('glowShroom', 'prop.glowMushroom', 600, 13300, (x) => (x < VAULTS_SECTION_B ? 6 : 4), (x) => (inChasm(x) ? null : { y: floorY(x) - 7, w: 14, h: 14 })),
  // small decor drips on the roof, kept well away from the solid stalactites (round 17:
  // a little non-solid spike next to a real one read as one more thing to dodge)
  ...s7Scatter('stalactite', 'prop.stalactite', 300, 13400, () => 5, (x) => (inHole(x) || nearStalactite(x) ? null : { y: roofY(x) + 14, w: 12, h: 28 })),
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
  ...VAULTS_COLLAPSES.map(
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

/**
 * The brittle zones as actually laid (round-17 audit L3): each VAULTS_BRITTLE stretch
 * minus the x-span of any lip peg inside it (8770, 10570, 12070 - the west lips of
 * chasms 2-4, where a player most needs an anchor that holds). The roof stays brittle
 * right up to the peg's flanks; the peg, and the roof it is rooted in, do not crack.
 */
export const VAULTS_BRITTLE_SPANS: readonly [number, number][] = VAULTS_BRITTLE.flatMap(([a, b]) => {
  const cuts = VAULTS_STALACTITES.filter((sp) => sp.id.startsWith('lipPeg') && sp.x > a && sp.x < b)
    .map((sp) => {
      const xs = vaultsStalactitePoints(sp).map((q) => q.x);
      return [Math.floor(Math.min(...xs)) - 2, Math.ceil(Math.max(...xs)) + 2] as const;
    })
    .sort((m, n) => m[0] - n[0]);
  const out: [number, number][] = [];
  let x = a;
  for (const [c0, c1] of cuts) {
    if (c0 > x) out.push([x, c0]);
    x = Math.max(x, c1);
  }
  if (x < b) out.push([x, b]);
  return out;
});

/**
 * Round-17 audit M1: the bottom VAULTS_TIP_NO_ANCHOR px of every stalactite / peg take
 * no harpoon (a noAnchorRegion; the head bounces off as a miss). A short rope on the
 * blunt tip let the pod orbit the tip and the rope then dragged it through the spire's
 * far flank (fatal, measured 249 px/s). Anchors higher up the flank stay fine (the
 * winch's rope-line stall probe, harpoonRig.ts, covers being reeled along a flank).
 */
export const VAULTS_TIP_NO_ANCHOR = 20;
/**
 * The lip pegs' no-anchor tip is only 10 px (just the blunt end): they sit at the edge of
 * rope reach from the lip ledges by design (VAULTS_LIP_CLEAR leaves 5 px), and a 20 px cut
 * left four lip spots (x 7950, 9750, 10700, 12200) with nothing in reach for a pod lying
 * on its side (tipped recovery, audit L4). Their short, wide stubs never showed the orbit.
 */
export const VAULTS_PEG_TIP_NO_ANCHOR = 10;
export const vaultsTipNoAnchor = (sp: S7Spire) => (sp.id.startsWith('lipPeg') ? VAULTS_PEG_TIP_NO_ANCHOR : VAULTS_TIP_NO_ANCHOR);

const zones: ZoneSpec[] = [
  ...VAULTS_BRITTLE_SPANS.map(([a, b], i) => ({
    kind: 'brittleRegion' as const,
    id: `brittle${i + 1}`,
    rect: { x: a, y: 0, w: b - a, h: 500 },
    breakAfterSec: 1.4,
  })),
  ...VAULTS_STALACTITES.map((sp): ZoneSpec => {
    // the outline's x extent below the cut line (vertices under it + where edges cross it)
    const cut = vaultsTipNoAnchor(sp);
    const y0 = sp.tip - cut;
    const pts = vaultsStalactitePoints(sp);
    const xs: number[] = [];
    pts.forEach((q, i) => {
      const n = pts[(i + 1) % pts.length]!;
      if (q.y >= y0) xs.push(q.x);
      if ((q.y - y0) * (n.y - y0) < 0) xs.push(q.x + ((y0 - q.y) / (n.y - q.y)) * (n.x - q.x));
    });
    const x0 = Math.floor(Math.min(...xs)) - 2;
    const x1 = Math.ceil(Math.max(...xs)) + 2;
    return { kind: 'noAnchorRegion', id: `${sp.id}Tip`, rect: { x: x0, y: y0, w: x1 - x0, h: cut + 4 } };
  }),
];

/**
 * Checkpoints (round-17 audit M2; CheckpointSpec 'enterRegion', forward only): one as
 * section B starts and one past each fatal chasm. Section A (the swing school) has none.
 * Each region is a full-height band the pod must cross; each respawn rests on flat
 * ledge floor between the hanging rock (>= 45 px off every stalactite / peg outline),
 * outside the collapse rains, and is never inside a later band. A respawn is a fresh
 * session: brittle anchors are per-rope timers, so nothing about the roof carries over.
 */
const cp = (id: string, bandX: number, x: number) => ({
  id,
  at: 'enterRegion' as const,
  rect: { x: bandX, y: 0, w: 40, h: H },
  respawn: { x, y: Math.round(floorY(x)) - 9 },
});
export const VAULTS_CHECKPOINTS = [
  cp('sectionB', VAULTS_SECTION_B - 40, 6620), // between stalactites 7 and 8
  cp('chasm1', 7940, 8000), // chasm 1's east ledge, before lip peg 1
  cp('chasm2', 9740, 10250), // past the lip crystal and stalactite 11, clear of collapse 1
  cp('chasm3', 11360, 11420), // chasm 3's east ledge, before lip peg 5
  cp('chasm4', 12810, 12870), // chasm 4's east ledge, before lip peg 7
];

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
  checkpoints: VAULTS_CHECKPOINTS.map((c) => ({ ...c, rect: { ...c.rect }, respawn: { ...c.respawn } })),
  camera: { bias: 'horizontal', lookAhead: 80 },
  physicsOverrides: {
    'harpoon.reelOutSpeed': 85,
    'harpoon.damageSpeed': 110,
    'harpoon.crashSpeed': 240,
    // S1 default (150) snaps a rope on any slack->taut catch above ~75 px/s (one-step force spike)
    'harpoon.ropeBreakAccel': 600,
    // feel pass opt-out: pure rope swinging, no thrusters, so the lighter
    // gravity (gravity.scale 0.65, a thruster-feel change) would only make
    // every swing slower and floatier; the Vaults keep their designed pull
    'gravity.scale': 1,
  },
};

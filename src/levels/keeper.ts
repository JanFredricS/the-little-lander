/**
 * Map 7 — Boss: The Keeper (harpoonThrust). A ~4,000 px cavern under the
 * crust: a flat, cracked roof studded with loose rocks, a rubble floor, and
 * the Keeper — a tentacled flyer — hovering in between.
 *
 *  - Damage it by dropping rocks on it: harpoon a loose rock and reel in
 *    (the winch tears it loose; breakForce 13 N sits between the pod's
 *    hanging weight ~6 N and the winch pull ~16 N, so hanging alone never
 *    breaks one). A torn-loose rock snaps down at 160 px/s. The Keeper idles
 *    in place while you stay within ~140 px of it sideways, so lure it:
 *    wait one dead zone beyond a rock on the far side from it, it drifts
 *    over and stops right under the rock. It also stands still for the
 *    whole sweep wind-up — a rock fired then still lands. 7 rock hits win
 *    (phase 2 at 3, phase 3 at 5). Fallen rocks regrow after 14 s, and all
 *    of them whenever it slams the roof.
 *  - Sweeps: the Keeper tracks you while it shivers, then its aim LOCKS
 *    (1.1 / 0.95 / 0.8 s per phase) and it lunges along that line. Get off
 *    the line — sideways or by dropping; climbing is the slow way out.
 *  - Tendril grabs: burn the tendril with your exhaust (nose away from the
 *    Keeper + thrust) to break free — it also hurts the Keeper a little.
 *    A held pod hangs at ~95 px from it (no body contact on top).
 *  - Phases (hp 2/3, 1/3): faster sweeps, slams shaking debris loose, two
 *    tendrils, then a light debris rain. bossPhase / bossHit / bossDefeated
 *    events drive the HUD health bar and the audio.
 *  - Fuel canisters float at mid-height across the arena (and one at the
 *    start ledge); the fight takes 2-5 minutes.
 *  - The fight is won when the Keeper's death animation ends (surviveBoss);
 *    the story flow plays 'keeperFalls' after.
 *
 * Playtest notes (S7; headless reference pilot test/support/s7Pilots.ts
 * keeperPilot: lure + rock drop, tendril burn, sweep dodge, fuel runs; it
 * never uses the rope to rest, so a floor for a real player):
 *  - Final tuning: 4 of 6 lure-spot variants win, in 130-290 s with hull
 *    0.07-0.81 left; the losses die in phase 3 with the Keeper at 1-2 hits
 *    from death. test/s7.playtest.test.ts requires 2 of 3 variants to win.
 *  - What the pass changed (first cut: the pilot never won, 1-2 rock hits
 *    in 400 s):
 *     - a knocked-over harpoonThrust pod could never get up again on the
 *       arena floor (soft-lock) -> levels/systems/righting.ts ground kick;
 *     - knockback 240 -> 150 px/s (it exceeded crashSpeed: every shove into
 *       a wall was a crash), grabs reel to a hold distance and damp motion
 *       (the pod used to orbit the Keeper and get flung to the floor);
 *     - sweeps aim-lock before the lunge (was: aimed at your position at
 *       the lunge, undodgeable for a 1.5 g pod), longer wind-ups, slower
 *       lunges (300/350/400), 650 px reach, and a brisk 180 px/s climb back
 *       to the hover band afterwards; bumping it while stunned or between
 *       phases only shoves;
 *     - hover band 330 -> 250 px under the roof, rock snap 160 px/s, rock
 *       damage 0.13 -> 0.145 (7 hits), cooldowns 3.6/3.2/2.8 s, phase
 *       patterns with an extra sweep instead of back-to-back grabs;
 *     - damage eased ~25% (sweep 0.12, bump 0.04, grab 0.02/s, crush 0.22),
 *       gravity 5 -> 4 (more time to flip after a tendril burn), fuel moved
 *       off the floor (a 1,100 px climb each way).
 *   S8 difficulty pass: burnSeconds 90 -> 110. The reference pilots bottomed
 *   out at 22% fuel with the canisters not respawning, the tightest margin
 *   of the campaign; a slower human fight could strand the pod mid-arena.
 *  Round 21 (players did not see how to hurt it): winnability re-checked, no
 *  tuning change. keeperPilot over 20 lure variants (offset 120-160 x below
 *  160-210): 17 win (losses die in phase 3, 1-2 hits short); 9+ of the 12
 *  rocks always hanging (7 hits needed, regrowth 14 s + at every slam); the
 *  Keeper's hover range covers every rock and every lure spot is inside the
 *  arena, so no rock is unusable and none can run out. 107 rocks torn -> 102
 *  hits. Guarded by the round-21 audit in test/s7.playtest.test.ts. Teaching
 *  added, layered: the start card adds "HARPOON THE CRACKED ROCKS IN THE
 *  ROOF, / REEL IN HARD TO DROP THEM ON THE KEEPER" (controlsHelp
 *  missionTips); in flight the HUD coaches 3 s in for 9 s and again after 30 s
 *  without a rock hit, alternating the drop and the lure hint, until 2 rock
 *  hits (hudState BOSS_HINTS); every hanging rock glints, and one the Keeper
 *  is lined up under (KeeperBrain.linedUpUnder: within one body radius; 95 of
 *  96 such drops hit) glows gold with a drop line down to it (s7LevelFx
 *  rockCue); Io's keeperWakes briefing names the harpoon + reel + lure.
 */

import { rectPoints, surfaceY } from './kit';
import type { EntitySpec, LevelSpec, TerrainPiece } from '../contracts';
import { s7Band, s7Noise, s7Piece, s7Profile, s7Prop, s7Scatter } from './s7Helpers';

const W = 4000;
const H = 1400;
/** Roof line over the arena (rocks hang from it). */
export const KEEPER_ROOF_Y = 160;
export const KEEPER_ARENA = { x: 300, y: KEEPER_ROOF_Y + 10, w: 3400, h: 1100 };
const FLOOR_Y = 1300;

const roofNoise = s7Noise('keeper.roof', 90);
const floorNoise = s7Noise('keeper.floor', 150);

const ROOF = s7Band(0, W, 50, s7Profile([[0, 60], [250, KEEPER_ROOF_Y - 10], [3750, KEEPER_ROOF_Y - 10], [W, 60]]), 6, roofNoise).map((p) =>
  // keep the rock line itself flat
  p.x > 380 && p.x < 3620 ? { x: p.x, y: KEEPER_ROOF_Y } : p,
);
const FLOOR = s7Band(0, W, 80, s7Profile([[0, 1180], [260, 1180], [420, FLOOR_Y], [3600, FLOOR_Y], [W, 1250]]), 18, floorNoise).map((p) =>
  p.x <= 260 ? { x: p.x, y: 1180 } : p,
);

/** Loose rocks along the roof (x). */
export const KEEPER_ROCK_X: readonly number[] = Array.from({ length: 12 }, (_, i) => 520 + i * 270);
const ROCK_R = 16;

const terrain: TerrainPiece[] = [
  s7Piece('roof', 'ceiling', ROOF, { material: 'rock', decorDensity: 0.4 }),
  s7Piece('floor', 'ground', FLOOR, { material: 'rock', decorDensity: 0.4 }),
  s7Piece('wallWest', 'polygon', rectPoints(0, 40, 40, 1300), { material: 'rock' }),
  s7Piece('wallEast', 'polygon', rectPoints(W - 40, 40, 40, 1300), { material: 'rock' }),
  // two rubble mounds (cover from sweeps, perches)
  s7Piece('mound1', 'polygon', [{ x: 1180, y: FLOOR_Y + 5 }, { x: 1260, y: 1230 }, { x: 1340, y: 1215 }, { x: 1420, y: FLOOR_Y + 5 }], { material: 'rock' }),
  s7Piece('mound2', 'polygon', [{ x: 2600, y: FLOOR_Y + 5 }, { x: 2680, y: 1220 }, { x: 2770, y: 1230 }, { x: 2840, y: FLOOR_Y + 5 }], { material: 'rock' }),
];

const floorY = (x: number) => surfaceY(FLOOR, x);

const entities: EntitySpec[] = [
  // decor
  ...KEEPER_ROCK_X.map((x, i) => s7Prop(`crack${i}`, 'prop.ceilingRockLarge', x, KEEPER_ROOF_Y + 8, 40, 16)),
  ...s7Scatter('stalactite', 'prop.stalactite', 60, 3940, () => 5, (x) => (KEEPER_ROCK_X.some((r) => Math.abs(r - x) < 50) ? null : { y: surfaceY(ROOF, x) + 14, w: 12, h: 28 })),
  ...s7Scatter('spore', 'prop.spore', 300, 3700, () => 12, (x, r) => ({ y: 300 + r() * 900, w: 6, h: 6, foreground: r() < 0.2 })),
  ...s7Scatter('rubble', 'prop.rock', 450, 3600, () => 8, (x) => ({ y: floorY(x) - 6, w: 16, h: 12 })),
  // the loose rocks
  ...KEEPER_ROCK_X.map((x, i): EntitySpec => ({ id: `rock${i + 1}`, kind: 'looseRock', x, y: KEEPER_ROOF_Y + ROCK_R, radius: ROCK_R, breakForce: 13 })),
  // fuel canisters: floating at mid-height (below the Keeper's hover band), one at the start
  ...[440, 1020, 1640, 2360, 2980, 3560].map((x, i): EntitySpec => ({ id: `fuel${i + 1}`, kind: 'fuelPickup', x, y: 660 + (i % 2) * 60, amount: 0.4 })),
  { id: 'fuel7', kind: 'fuelPickup', x: 150, y: 1150, amount: 0.5 },
  // the Keeper
  { id: 'keeper', kind: 'bossSpawn', bossId: 'keeper', x: 2000, y: KEEPER_ARENA.y + 330, arena: KEEPER_ARENA },
];

export const keeper: LevelSpec = {
  id: 'keeper',
  title: 'The Keeper',
  themeId: 'boss',
  vesselMode: 'harpoonThrust',
  worldSize: { w: W, h: H },
  spawn: { x: 150, y: 1180 - 11 },
  gravity: { x: 0, y: 4 },
  harpoonGuns: 1,
  terrain: { pieces: terrain },
  entities,
  zones: [],
  objectives: [{ kind: 'surviveBoss', id: 'keeper', bossEntityId: 'keeper' }],
  camera: { lookAhead: 40 },
  physicsOverrides: {
    'harpoonThrust.burnSeconds': 110,
    'harpoonThrust.ropeBreakAccel': 600,
    'harpoonThrust.damageSpeed': 110,
    'harpoonThrust.crashSpeed': 230,
  },
};

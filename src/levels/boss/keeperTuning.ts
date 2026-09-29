/**
 * The Keeper (map 7 boss) tuning. Units: px, px/s, seconds; hp and damage
 * are fractions (boss hp 0..1, vessel hull 0..1). Per-phase arrays are
 * indexed by phase - 1 (phases 1..3). Tuned in the S7 playtest pass (see the
 * header of src/levels/keeper.ts).
 */

export const KEEPER_TUNING = {
  /** Hit circle (px) for falling rocks and vessel contact. */
  bodyRadius: 38,
  /** hp thresholds: phase 2 below the first, phase 3 below the second. */
  phaseThresholds: [2 / 3, 1 / 3] as readonly number[],
  /** Rock hit damage for a rock of refRockRadius (scaled by radius, clamped 0.7x..1.4x). */
  rockDamage: 0.13,
  refRockRadius: 16,
  /** A rock must be falling at least this fast (px/s, downward) to hurt. */
  rockMinSpeed: 50,
  /** Damage when a grabbing tendril is burnt off. */
  tendrilBurnDamage: 0.035,

  /** Intro (rises into view, no attacks) and phase-change pause (s). */
  introSec: 2.5,
  transitionSec: 2.2,
  /** Stagger after a rock hit (s): attacks cancelled, tendrils let go. */
  staggerSec: 1.3,
  /** Death animation before the fight counts as won (s). */
  deathSec: 2.5,

  /** Hover band: px below the arena top. */
  hoverY: 420,
  /** Vertical bob amplitude (px) and period (s). */
  bobAmp: 18,
  bobSec: 3.2,
  /** Idle follow speed (px/s) per phase. */
  followSpeed: [70, 90, 115] as readonly number[],
  /** Rest between attacks (s) per phase. */
  attackCooldown: [2.8, 2.2, 1.6] as readonly number[],
  /** Attack order per phase (cycled). */
  pattern: [
    ['sweep', 'grab'],
    ['sweep', 'grab', 'slam'],
    ['grab', 'sweep', 'slam', 'sweep'],
  ] as readonly (readonly KeeperAttack[])[],

  /** Sweep: telegraph (s), lunge speed (px/s), max lunge distance (px). */
  sweepWindup: [1.3, 1.1, 0.9] as readonly number[],
  sweepSpeed: [330, 390, 450] as readonly number[],
  sweepDistance: 900,
  sweepDamage: 0.22,
  /** Knockback velocity change (px/s) on a sweep / contact hit. */
  knockback: 240,
  /** Plain body contact (outside sweeps). */
  contactDamage: 0.1,
  contactCooldown: 1.0,

  /** Grab: tendrils per grab, tip speed (px/s), reach (px), catch radius (px). */
  grabTendrils: [1, 1, 2] as readonly number[],
  grabTipSpeed: 420,
  grabReach: 330,
  grabRadius: 22,
  /** Pull on a caught vessel (m/s², mass independent) towards the boss. */
  grabPull: 7,
  /** Hull damage per second while held. */
  grabDamagePerSec: 0.04,
  /** Seconds of exhaust on the tendril (near the vessel) to burn it off; burn decays at this rate/s when not burning. */
  burnToBreak: 0.45,
  burnDecay: 0.5,
  /** Held this long -> crushed: big damage + thrown clear. */
  crushAfterSec: 5,
  crushDamage: 0.3,
  /** Tendril retract time (s). */
  retractSec: 0.6,

  /** Slam: windup rising to the roof (s), then shakes debris loose + regrows rocks. */
  slamWindup: 1.4,
  slamRecover: 1.0,
  /** Debris pieces shaken loose per slam, per phase. */
  slamDebris: [0, 6, 10] as readonly number[],
  /** Phase 3: ambient debris rain (pieces/s). */
  ambientDebrisRate: [0, 0, 0.5] as readonly number[],
};

export type KeeperAttack = 'sweep' | 'grab' | 'slam';
export type KeeperTuning = typeof KEEPER_TUNING;

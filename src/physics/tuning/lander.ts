/**
 * Lander mode tuning (legs, two independent engines left/right of centre, no
 * direct rotation). Override per level with `lander.<field>` keys.
 *
 * Units: sizes px, speeds px/s, angular rad / rad/s², times sim seconds.
 */

export const LANDER_TUNING = {
  /** Body box (px). */
  width: 22,
  height: 18,
  /** Legs: feet span (px, outer edge to outer edge; = the vessel.lander pad span, S8) and how far below the body they reach (px). */
  legSpan: 24,
  legDrop: 7,
  density: 4,
  friction: 0.8,
  restitution: 0.02,
  /** Thrust of EACH engine as a multiple of the dry lander's weight at reference gravity (both = 2×). */
  thrust: 0.8,
  /** Passive angular damping (1/s): tames the one-engine spin. */
  angularDamping: 1.2,
  linearDamping: 0,
  /**
   * Nozzle x offset from centre (px). Each engine's force acts here, so this
   * is the spin lever: one engine alone gives angular accel ≈
   * thrust·weight·offset / inertia (scales with level gravity like the lift).
   * Left engine = clockwise (+), right = counter-clockwise.
   */
  engineOffset: 4,
  /** Seconds of continuous BOTH-engine burn per full tank (one engine burns half as fast). */
  burnSeconds: 30,
  damageSpeed: 75,
  crashSpeed: 150,
  hitDamage: 0.4,
  landSpeed: 24,
  landAngle: 0.3,
  landSpin: 1,
  landSettleSec: 0.25,
  exhaustLength: 45,
  exhaustHalfAngle: 0.45,
};

export type LanderTuning = typeof LANDER_TUNING;

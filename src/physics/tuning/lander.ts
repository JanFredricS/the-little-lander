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
  /** Legs: feet span (px, outer edge to outer edge) and how far below the body they reach (px). */
  legSpan: 30,
  legDrop: 7,
  density: 4,
  friction: 0.8,
  restitution: 0.02,
  /** Thrust of EACH engine as a multiple of the dry lander's weight at reference gravity (both = 2×). */
  thrust: 0.8,
  /**
   * Angular acceleration (rad/s²) from ONE engine firing alone (dry lander).
   * The differential torque is applied directly so the feel does not depend
   * on level gravity. Left engine = clockwise (+), right = counter-clockwise.
   */
  spinAccel: 3.2,
  /** Small passive angular damping: hard but learnable. */
  angularDamping: 1.2,
  linearDamping: 0,
  /** Nozzle x offset from centre (px) — render + exhaust cones. */
  engineOffset: 8,
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

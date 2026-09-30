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
  /**
   * Thrust of EACH engine as a multiple of the dry lander's weight at reference gravity (both = 2×).
   * Feel pass: 0.8 -> 0.9 (both 1.8; hover duty ~56 %, was 62 %). Kept < 1:
   * one engine alone must not hover, or every tilt pulse would also climb.
   */
  thrust: 0.9,
  /** Passive angular damping (1/s): tames the one-engine spin. */
  angularDamping: 1.2,
  linearDamping: 0,
  /**
   * Nozzle x offset from centre (px). Each engine's force acts here, so this
   * is the spin lever: one engine alone gives angular accel ≈
   * thrust·weight·offset / inertia (scales with level gravity like the lift).
   * Left engine = clockwise (+), right = counter-clockwise.
   * Feel pass: 4 -> 5 so the tilt response keeps ~90 % of its pre-pass
   * angular accel under the lighter felt gravity (weight × thrust dropped
   * to ~0.73×), instead of turning sluggish.
   */
  engineOffset: 5,
  /**
   * S9 top thrusters: thrust of EACH top thruster as a multiple of the dry
   * lander's weight at reference gravity. They sit on the top of the body
   * (y = -height/2) at x = ±topOffset and push along the body's DOWN axis, so
   * an inverted lander lifts with both (2 × 0.7 = 1.4 × weight) and flips
   * with one. Upright, they push you down (a brake for climbs).
   * Feel pass: 0.6 -> 0.7 alongside the main engines.
   */
  topThrust: 0.7,
  /** Top thruster x offset from centre (px): the lever for flipping. Left top = counter-clockwise, right top = clockwise. */
  topOffset: 7,
  /** Seconds of continuous BOTH-engine burn per full tank (one engine burns half as fast; each top thruster burns like one main engine). */
  burnSeconds: 30,
  damageSpeed: 75,
  crashSpeed: 150,
  hitDamage: 0.4,
  landSpeed: 24,
  landAngle: 0.3,
  landSpin: 1,
  landSettleSec: 0.25,
  /**
   * S10 brake assist: an engine firing against the velocity gets up to
   * brakeBoost × thrust, ramping linearly from 1× at 0 px/s to the full boost
   * at >= brakeBoostRef px/s, scaled by how directly it opposes the motion
   * (perpendicular = no boost). Fuel drain stays un-boosted. 1 = off.
   */
  brakeBoost: 1.5,
  brakeBoostRef: 180,
  exhaustLength: 45,
  exhaustHalfAngle: 0.45,
};

export type LanderTuning = typeof LANDER_TUNING;

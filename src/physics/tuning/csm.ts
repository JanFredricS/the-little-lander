/**
 * CSM mode tuning (lander + command/service module stack, one big main
 * thruster). Override per level with LevelSpec.physicsOverrides using the
 * key `csm.<field>` (e.g. `{ 'csm.thrust': 1.6 }`).
 *
 * Units: sizes px, speeds px/s, angular rad / rad/s², times sim seconds.
 * "Reference gravity" = |LevelSpec.gravity| (at least MIN_REFERENCE_GRAVITY),
 * fixed for the level: ramps/zones change the weight you fight, not your engine.
 */

export const CSM_TUNING = {
  /** Hull box (px). */
  width: 20,
  height: 36,
  /** kg/m² of the hull box. */
  density: 4,
  friction: 0.7,
  restitution: 0.05,
  /** Main thrust as a multiple of the dry stack's weight at reference gravity (1 = hover). ~1.8 → pulsing is mandatory. */
  thrust: 1.8,
  /** Angular acceleration from rotate input (rad/s², dry stack). */
  rotateAccel: 7,
  angularDamping: 3,
  linearDamping: 0,
  /** Seconds of continuous main burn per full tank. */
  burnSeconds: 30,
  /** Impacts faster than this (px/s) damage the hull. */
  damageSpeed: 90,
  /** Impacts at/above this (px/s) crash the vessel. */
  crashSpeed: 180,
  /** Hull fraction lost by an impact just below crashSpeed (linear from damageSpeed). */
  hitDamage: 0.4,
  /** Soft-land: max speed (px/s), max |angle| (rad), max |angular vel| (rad/s), sustained contact (s). */
  landSpeed: 24,
  landAngle: 0.35,
  landSpin: 1,
  landSettleSec: 0.25,
  /** Exhaust cone (goo burn-off): length past the nozzle (px) and half-angle (rad). */
  exhaustLength: 70,
  exhaustHalfAngle: 0.55,
};

export type CsmTuning = typeof CSM_TUNING;

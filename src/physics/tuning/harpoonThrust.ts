/**
 * Harpoon + thrust mode tuning (levels 6-8: the pod with a re-attached
 * thruster stage — rope guns plus a CSM-style main engine and rotation).
 * Override per level with `harpoonThrust.<field>` keys.
 *
 * Units: sizes px, speeds px/s, angular rad / rad/s², times sim seconds.
 */

import { HARPOON_TUNING } from './harpoon';

export const HARPOON_THRUST_TUNING = {
  ...HARPOON_TUNING,
  /** Pod + thruster stage (px). */
  width: 16,
  height: 22,
  mountHeight: 8,
  /** Main thrust × dry weight at reference gravity. Gentler than the CSM. */
  thrust: 1.5,
  rotateAccel: 6,
  angularDamping: 3,
  /** Seconds of continuous burn per full tank. */
  burnSeconds: 25,
  /**
   * S10 brake assist: an engine firing against the velocity gets up to
   * brakeBoost × thrust, ramping linearly from 1× at 0 px/s to the full boost
   * at >= brakeBoostRef px/s, scaled by how directly it opposes the motion
   * (perpendicular = no boost). Fuel drain stays un-boosted. 1 = off.
   */
  brakeBoost: 1.5,
  brakeBoostRef: 180,
  exhaustLength: 55,
  exhaustHalfAngle: 0.5,
  landAngle: 0.35,
};

export type HarpoonThrustTuning = typeof HARPOON_THRUST_TUNING;

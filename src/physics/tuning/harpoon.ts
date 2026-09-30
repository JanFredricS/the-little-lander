/**
 * Harpoon mode tuning (ascent-stage pod, 1-2 rope guns, no thrusters).
 * Override per level with `harpoon.<field>` keys. The rope fields are also
 * used by harpoonThrust unless overridden there (see harpoonThrust.ts).
 *
 * Units: sizes px, speeds px/s, angular rad / rad/s², times sim seconds.
 */

export const HARPOON_TUNING = {
  /** Pod box (px): matches the vessel.pod art (S8). */
  width: 16,
  height: 14,
  density: 4,
  friction: 0.6,
  restitution: 0.05,
  angularDamping: 2,
  linearDamping: 0,
  /** Rope gun mount, px above the pod centre (rope pulls from here → the pod hangs upright). */
  mountHeight: 6,
  /** Max rope length = harpoon range (px). */
  ropeRange: 320,
  /** Shortest reel-in length (px). */
  ropeMin: 24,
  /** Reel speeds (px/s). */
  reelInSpeed: 120,
  reelOutSpeed: 140,
  /** Harpoon head flight speed (px/s). */
  headSpeed: 1100,
  /**
   * Rope snaps ('overload') when its smoothed tension exceeds dry pod mass ×
   * this (m/s²). Gravity-independent: hanging still is ~1 g of tension, a hard
   * swing catch several g.
   */
  ropeBreakAccel: 150,
  damageSpeed: 90,
  crashSpeed: 190,
  hitDamage: 0.4,
  landSpeed: 24,
  landAngle: 0.45,
  landSpin: 1.2,
  landSettleSec: 0.25,
};

export type HarpoonTuning = typeof HARPOON_TUNING;

/**
 * Environment tuning: goo balls, debris, pickups, beacons, gravity events.
 * Override per level with `goo.<field>`, `debris.<field>`, `pickup.<field>`,
 * `beacon.<field>`, `gravity.<field>` keys.
 *
 * Units: sizes px, speeds px/s, accelerations m/s², times sim seconds.
 * Per-spawner numbers (rates, homing accel, sizes) live on the LevelSpec
 * entities themselves; these are the shared defaults behind them.
 */

export const GOO_TUNING = {
  /** Blob radius (px). */
  radius: 7,
  /** kg/m². Attached goo adds this mass (and its weight) to the vessel. */
  density: 3,
  /** Free-flying drag (1/s): terminal speed ≈ homingAccel / linearDamping (m/s). */
  linearDamping: 1,
  /** Extra vessel linear damping (1/s) per attached blob (the "drag" of goo). */
  attachedDrag: 0.05,
  /** Seconds inside an active exhaust cone to burn a blob away. */
  burnSec: 0.4,
  /**
   * Out-of-cone time (s) before the burn timer resets — so a PULSED burn
   * (the core CSM skill) still accumulates.
   */
  burnGraceSec: 0.2,
  /** Hull damage per attach (0..1). */
  attachDamage: 0,
  /** Max blobs welded to one hull; extra blobs keep bumping. */
  maxAttached: 8,
  /** Soft weld spring (Hz) + damping ratio: attached goo wobbles. 0 = rigid. */
  weldHertz: 6,
  weldDamping: 0.6,
};

export const DEBRIS_TUNING = {
  /** kg/m². */
  density: 2.5,
  restitution: 0.2,
  friction: 0.5,
  /** Pieces are removed after this long (s) or when they fall out of the world. */
  lifetimeSec: 18,
  /** Global cap of live debris pieces. */
  maxAlive: 120,
  /** Hull damage for a hit at refSpeed (scaled linearly with approach speed, capped at 2×). */
  hitDamage: 0.06,
  refSpeed: 200,
  /** Hits slower than this (px/s) do no damage. */
  minDamageSpeed: 40,
  /** Burning debris damage multiplier. */
  burningMultiplier: 2,
};

export const PICKUP_TUNING = {
  /** Sensor radius of orbs / fuel pickups (px). */
  orbRadius: 10,
  fuelRadius: 12,
};

export const BEACON_TUNING = {
  /** Height of a beacon site's landing zone above its surface (px). */
  zoneHeight: 48,
  /** Tolerance below the surface line (px). */
  zoneBelow: 8,
};

export const GRAVITY_TUNING = {
  /**
   * Feel pass: every level / ramp / zone gravity the world applies is the
   * designed LevelSpec value (m/s²) × scale, so falls build speed slower and
   * the player has longer to react. Engine `thrust` multiples are T/W
   * against this FELT gravity (levelReferenceGravity), and were raised in
   * the same pass (csm 1.8 -> 2.4, lander 0.8 -> 0.9 per engine and top
   * thrusters 0.6 -> 0.7, harpoonThrust 1.5 -> 2.3) so short pulses with
   * longer coasts redirect.
   * Wind gusts scale with it too (they were balanced against gravity/thrust).
   * 1 = the designed pull (pre-feel-pass gravity).
   */
  scale: 0.65,
  /** Min change of the vessel's effective gravity (m/s²) that emits gravityChanged. */
  eventThreshold: 0.3,
};

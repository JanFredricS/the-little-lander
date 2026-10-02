/**
 * Spring mode tuning (round 15: the post-final arc). The lander's thrusters are dead;
 * it hops on spring legs. On the ground the pilot aims (an angle from straight up) and
 * charges (0..1), then releases: the vessel leaves with a FIXED launch speed
 *
 *   v = jumpSpeedMin + power × (jumpSpeedMax − jumpSpeedMin)   (px/s)
 *
 * along the aim, and flies a pure ballistic arc (no thrust, no air control: the Jump King
 * commitment). Landing on its legs, the springs soak the touchdown (velocity zeroed:
 * no slide) unless `autoBounce` is set.
 *
 * Map-2 hooks (data only, no code change): `autoBounce` 1 makes the legs never settle -
 * a touchdown faster than `bounceMinSpeed` bounces back with `bounceRestitution` × the
 * normal speed, and a jump released within `bounceWindowSec` of a touchdown is a timed
 * bounce (launch speed + the stored bounce). Slow touchdowns still stop.
 *
 * Units: sizes px, speeds px/s, angles rad, times sim seconds.
 */

export const SPRING_TUNING = {
  /** Body box (px): the lander's hull and legs (same sprite). */
  width: 22,
  height: 18,
  legSpan: 24,
  legDrop: 7,
  density: 4,
  friction: 0.9,
  restitution: 0,
  /** Passive angular damping (1/s): a clipped edge spins less. */
  angularDamping: 2,
  linearDamping: 0,
  /** Launch speed at zero / full charge (px/s). The level's felt gravity sets the reach (see springReach). */
  jumpSpeedMin: 120,
  jumpSpeedMax: 380,
  /** Furthest aim from straight up (rad, either side). */
  aimMax: 1.4,
  /** Keyboard / button aim sweep (rad/s). */
  aimRate: 1.5,
  /** Keyboard / button hold time for a full charge (s). The stick charges by deflection instead. */
  chargeSec: 1,
  /**
   * Upright PD on the ground (1/s² per rad, 1/s): a hop that lands tilted rights itself,
   * capped at the torque the legs could give (weight × legSpan / 2), so a lander whose
   * centre is past an edge still topples.
   */
  uprightStiffness: 60,
  uprightDamping: 10,
  damageSpeed: 480,
  crashSpeed: 900,
  hitDamage: 0.35,
  landSpeed: 24,
  landAngle: 0.3,
  landSpin: 1,
  landSettleSec: 0.15,
  /** Map 2: 1 = the legs always bounce (see header). 0 = stable (map 1). */
  autoBounce: 0,
  bounceRestitution: 0.6,
  bounceWindowSec: 0.25,
  bounceMinSpeed: 140,
};

export type SpringTuning = typeof SPRING_TUNING;

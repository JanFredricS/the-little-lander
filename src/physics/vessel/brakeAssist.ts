/**
 * S10 brake assist: an engine firing AGAINST the vessel's velocity (a
 * retro-burn) gets a thrust multiplier that tapers back to 1 as the opposing
 * speed drops.
 *
 *   factor = max(0, -dot(thrustDir, vNorm))         (1 = pure retro, 0 = perpendicular or with the motion)
 *   ramp   = min(1, |v| / brakeBoostRef)            (0 at rest, 1 at >= ref speed)
 *   mult   = 1 + (brakeBoost - 1) · factor · ramp
 *
 * factor · ramp is continuous in v everywhere (it is max(0, -d·v) / max(|v|, ref)),
 * so there is no jump when the velocity passes through zero and flips.
 * Fuel drain is NOT boosted (see VesselBase.thrustAt).
 */

import type { Vec2 } from '../../contracts';

export interface BrakeTuning {
  /** Max thrust multiplier on a pure retro-burn at/above brakeBoostRef (1 = off). */
  brakeBoost: number;
  /** Speed (px/s) at which the full boost applies; linear from 1.0 at 0 px/s. */
  brakeBoostRef: number;
}

/**
 * Thrust multiplier for an engine pushing along unit world direction
 * `thrustDir` while the vessel moves at `velPx` (px/s).
 */
export function brakeBoostMultiplier(thrustDir: Vec2, velPx: Vec2, t: BrakeTuning): number {
  const extra = t.brakeBoost - 1;
  if (!(extra > 0) || !(t.brakeBoostRef > 0)) return 1;
  const opposing = -(thrustDir.x * velPx.x + thrustDir.y * velPx.y);
  if (!(opposing > 0)) return 1;
  const speed = Math.hypot(velPx.x, velPx.y);
  return 1 + (extra * opposing) / Math.max(speed, t.brakeBoostRef);
}

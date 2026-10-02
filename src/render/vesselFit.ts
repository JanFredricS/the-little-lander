/**
 * Fit native-size vessel art onto the S1 physics collision geometry.
 *
 * Vessel sprites are drawn at NATIVE size around their pivot (never
 * stretched). The art (VESSEL_SIZES, e.g. vessel.csm 24x48) and the physics
 * hull (per-mode dims from src/physics/tuning/*, surfaced as
 * VesselGeometry, centred on the body origin) disagree in size, so the
 * sprite is shifted in body space (it rotates with the vessel) until its
 * visual ground line (engine bell / leg pads) sits on the collision bottom
 * (geometry.h / 2: hull bottom, or the feet for the lander).
 *
 * S8: the physics dims were harmonized with the art (csm 20x44, lander legs
 * 24 wide, pod 14 tall), so collision bounds sit within 3 px of the opaque
 * art on every side (test/vesselFit.test.ts); the offset is now a small
 * constant (0..5 px) rather than an overhang fix.
 */

import type { SpriteName, VesselMode } from '../contracts';
import { LANDER_POSE, VESSEL_PIVOTS, vesselGroundY, type VesselSpriteName } from '../art/sprites/vessels';

/** The sprite that draws each vessel mode. */
export const MODE_SPRITES: Record<VesselMode, VesselSpriteName & SpriteName> = {
  csm: 'vessel.csm',
  lander: 'vessel.lander',
  harpoon: 'vessel.pod',
  harpoonThrust: 'vessel.podThrust',
  spring: 'vessel.lander', // round 15: the same lander, thrusters dead, spring coils drawn by FlightView
};

/** Sprite frame (pose) for a mode: the lander deploys its contact pose when landed. */
export function vesselFrame(mode: VesselMode, landed: boolean): number {
  // spring: always the full-leg flight pose (it matches the spring hull's collision box; FlightView draws the coils)
  return mode === 'lander' && landed ? LANDER_POSE.contact : 0;
}

/**
 * Vertical offset (px, body space, +y down) to add to the sprite's pivot
 * position so that art bottom == collision bottom (geometry centred on the
 * body origin, total height `collisionH`).
 */
export function vesselArtOffsetY(name: VesselSpriteName, collisionH: number, frame = 0): number {
  const artBottomBelowPivot = vesselGroundY(name, frame) - VESSEL_PIVOTS[name].y;
  return collisionH / 2 - artBottomBelowPivot;
}

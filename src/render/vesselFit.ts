/**
 * Fit native-size vessel art onto the physics collision box.
 *
 * The art (VESSEL_SIZES, e.g. vessel.csm 24x48) and the physics body (S0
 * stub PLACEHOLDER_VESSEL, a centred 20x28 box) disagree in size. Drawing
 * the sprite around its pivot at the body origin makes the CSM sink ~7px
 * into the terrain, so the sprite is shifted (in body space, so it rotates
 * with the vessel) until its visual ground line sits on the box bottom.
 *
 * TODO(S8): harmonize physics vessel dims with VESSEL_SIZES; this offset
 * then becomes (near) zero.
 */

import { VESSEL_PIVOTS, vesselGroundY, type VesselSpriteName } from '../art/sprites/vessels';

/**
 * Vertical offset (px, body space, +y down) to add to the sprite's pivot
 * position so that art bottom == collision box bottom (box centred on the
 * body origin, height `collisionH`).
 */
export function vesselArtOffsetY(name: VesselSpriteName, collisionH: number, frame = 0): number {
  const artBottomBelowPivot = vesselGroundY(name, frame) - VESSEL_PIVOTS[name].y;
  return collisionH / 2 - artBottomBelowPivot;
}

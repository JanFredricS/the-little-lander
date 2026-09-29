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
 * TODO(S8): harmonize physics vessel dims with VESSEL_SIZES; the offset then
 * becomes (near) zero.
 */

import type { SpriteName, VesselMode } from '../contracts';
import { LANDER_POSE, VESSEL_PIVOTS, vesselGroundY, type VesselSpriteName } from '../art/sprites/vessels';

/** The sprite that draws each vessel mode. */
export const MODE_SPRITES: Record<VesselMode, VesselSpriteName & SpriteName> = {
  csm: 'vessel.csm',
  lander: 'vessel.lander',
  harpoon: 'vessel.pod',
  harpoonThrust: 'vessel.podThrust',
};

/** Sprite frame (pose) for a mode: the lander deploys its contact pose when landed. */
export function vesselFrame(mode: VesselMode, landed: boolean): number {
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

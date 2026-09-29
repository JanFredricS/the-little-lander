import { describe, expect, it } from 'vitest';
import { getVesselAnchors, VESSEL_PIVOTS, VESSEL_SIZES, vesselGroundY, type VesselSpriteName } from '../src/art/sprites/vessels';
import { PLACEHOLDER_VESSEL } from '../src/game/placeholderVessel';
import { vesselArtOffsetY } from '../src/render/vesselFit';

const NAMES = Object.keys(VESSEL_SIZES) as VesselSpriteName[];

describe('vessel art ↔ physics box fit', () => {
  it.each(NAMES)('%s: art bottom lands exactly on the collision box bottom', (name) => {
    const collisionH = PLACEHOLDER_VESSEL.h;
    const dy = vesselArtOffsetY(name, collisionH);
    // sprite top-left in body space = (-pivot) + offset; art bottom = top + groundY
    const artBottom = -VESSEL_PIVOTS[name].y + dy + vesselGroundY(name);
    expect(artBottom).toBe(collisionH / 2);
    // also for another hypothetical box height
    expect(-VESSEL_PIVOTS[name].y + vesselArtOffsetY(name, 48) + vesselGroundY(name)).toBe(24);
  });

  it('ground line is the engine bell bottom (csm) / pad feet (lander)', () => {
    const bell = getVesselAnchors('vessel.csm').engines[0]!.find((e) => e.engine === 'main')!;
    expect(Math.abs(vesselGroundY('vessel.csm') - bell.y)).toBeLessThanOrEqual(1);
    const feetY = Math.max(...getVesselAnchors('vessel.lander').feet.map((f) => f.y));
    expect(Math.abs(vesselGroundY('vessel.lander', 1) - feetY)).toBeLessThanOrEqual(1);
    expect(vesselGroundY('vessel.csm')).toBeLessThanOrEqual(VESSEL_SIZES['vessel.csm'].h);
  });
});

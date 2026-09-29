import { describe, expect, it } from 'vitest';
import { VESSEL_MODES } from '../src/contracts';
import { getVesselAnchors, LANDER_POSE, VESSEL_PIVOTS, VESSEL_SIZES, vesselGroundY } from '../src/art/sprites/vessels';
import { CSM_TUNING, HARPOON_THRUST_TUNING, HARPOON_TUNING, LANDER_TUNING } from '../src/physics/tuning';
import { csmGeometry } from '../src/physics/vessel/csm';
import { podGeometry } from '../src/physics/vessel/harpoon';
import { landerGeometry } from '../src/physics/vessel/lander';
import type { VesselGeometry } from '../src/physics/vessel';
import { MODE_SPRITES, vesselArtOffsetY, vesselFrame } from '../src/render/vesselFit';

/** The REAL S1 collision geometry per mode (default tuning). */
const GEOMETRY: Record<(typeof VESSEL_MODES)[number], VesselGeometry> = {
  csm: csmGeometry(CSM_TUNING),
  lander: landerGeometry(LANDER_TUNING),
  harpoon: podGeometry(HARPOON_TUNING, false),
  harpoonThrust: podGeometry(HARPOON_THRUST_TUNING, true),
};

/** Lowest collision point below the body origin (px). */
const collisionBottom = (g: VesselGeometry) => Math.max(...g.boxes.map((b) => b.y + b.h / 2));

describe('vessel art ↔ S1 collision geometry fit', () => {
  it.each([...VESSEL_MODES])('%s: art ground line lands exactly on the collision bottom (every pose)', (mode) => {
    const name = MODE_SPRITES[mode];
    const geo = GEOMETRY[mode];
    expect(geo.h / 2).toBeCloseTo(collisionBottom(geo), 9); // geometry is centred on the body origin
    for (const landed of [false, true]) {
      const frame = vesselFrame(mode, landed);
      const dy = vesselArtOffsetY(name, geo.h, frame);
      // sprite top-left in body space = (-pivot) + offset; art bottom = top + groundY
      const artBottom = -VESSEL_PIVOTS[name].y + dy + vesselGroundY(name, frame);
      expect(artBottom).toBeCloseTo(collisionBottom(geo), 9);
    }
  });

  it('lander uses the contact pose when landed', () => {
    expect(vesselFrame('lander', true)).toBe(LANDER_POSE.contact);
    expect(vesselFrame('lander', false)).toBe(LANDER_POSE.flight);
    expect(vesselFrame('csm', true)).toBe(0);
  });

  it('ground line is the engine bell bottom (csm) / pad feet (lander)', () => {
    const bell = getVesselAnchors('vessel.csm').engines[0]!.find((e) => e.engine === 'main')!;
    expect(Math.abs(vesselGroundY('vessel.csm') - bell.y)).toBeLessThanOrEqual(1);
    const feetY = Math.max(...getVesselAnchors('vessel.lander').feet.map((f) => f.y));
    expect(Math.abs(vesselGroundY('vessel.lander', 1) - feetY)).toBeLessThanOrEqual(1);
    expect(vesselGroundY('vessel.csm')).toBeLessThanOrEqual(VESSEL_SIZES['vessel.csm'].h);
  });

  it('vesselGroundY wraps frames like getSprite (negative frames too)', () => {
    const n = 2; // vessel.lander: flight + contact poses
    expect(vesselGroundY('vessel.lander', -1)).toBe(vesselGroundY('vessel.lander', n - 1));
    expect(vesselGroundY('vessel.lander', -2)).toBe(vesselGroundY('vessel.lander', 0));
    expect(vesselGroundY('vessel.lander', n)).toBe(vesselGroundY('vessel.lander', 0));
    expect(vesselGroundY('vessel.csm', -1)).toBe(vesselGroundY('vessel.csm', 0));
    expect(Number.isFinite(vesselGroundY('vessel.pod', -7))).toBe(true);
  });

  it('every mode has engine anchors for each engine its physics nozzles fire', () => {
    for (const mode of VESSEL_MODES) {
      const anchors = getVesselAnchors(MODE_SPRITES[mode]).engines[0]!;
      for (const n of GEOMETRY[mode].nozzles) expect(anchors.some((a) => a.engine === n.engine)).toBe(true);
    }
  });
});

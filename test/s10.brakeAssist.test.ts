/**
 * S10 brake assist: an engine firing against the velocity gets a thrust
 * multiplier (up to brakeBoost at >= brakeBoostRef px/s, scaled by how
 * directly it opposes the motion). Pure multiplier math, tuning registration,
 * and real-physics braking runs (assist vs assist forced to 1.0) for the
 * lander main pair, the S9 top thrusters, the CSM and harpoonThrust; fuel
 * drain stays un-boosted; perpendicular burns are unaffected.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { FIXED_DT } from '../src/contracts';
import type { InputFrame, VesselMode } from '../src/contracts';
import { PhysicsWorld } from '../src/physics/engine';
import { overrideRangeError, PHYSICS_OVERRIDE_KEYS, resolveTuning } from '../src/physics/tuning';
import { createVessel } from '../src/physics/vessel';
import { brakeBoostMultiplier } from '../src/physics/vessel/brakeAssist';
import { emptyFrame } from '../src/shell/input';

const T = { brakeBoost: 1.5, brakeBoostRef: 180 };
const UP = { x: 0, y: -1 };

describe('S10 brakeBoostMultiplier (pure)', () => {
  it('is 1 at rest and ramps linearly to the full boost at the reference speed', () => {
    expect(brakeBoostMultiplier(UP, { x: 0, y: 0 }, T)).toBe(1);
    expect(brakeBoostMultiplier(UP, { x: 0, y: 90 }, T)).toBeCloseTo(1.25, 12);
    expect(brakeBoostMultiplier(UP, { x: 0, y: 180 }, T)).toBeCloseTo(1.5, 12);
    expect(brakeBoostMultiplier(UP, { x: 0, y: 400 }, T)).toBeCloseTo(1.5, 12); // capped above ref
  });

  it('perpendicular and with-the-motion burns get no boost', () => {
    expect(brakeBoostMultiplier(UP, { x: 300, y: 0 }, T)).toBe(1);
    expect(brakeBoostMultiplier(UP, { x: -300, y: 0 }, T)).toBe(1);
    expect(brakeBoostMultiplier(UP, { x: 0, y: -300 }, T)).toBe(1); // thrust along the velocity
  });

  it('scales with how directly the engine opposes the velocity (cosine)', () => {
    const d = { x: Math.SQRT1_2, y: -Math.SQRT1_2 };
    const m = brakeBoostMultiplier(d, { x: 0, y: 400 }, T); // 45° off a pure retro-burn, above ref
    expect(m).toBeCloseTo(1 + 0.5 * Math.SQRT1_2, 12);
  });

  it('is smooth across a velocity flip (no jump through zero speed)', () => {
    let prev = brakeBoostMultiplier(UP, { x: 3, y: 50 }, T);
    for (let vy = 50; vy >= -50; vy -= 0.5) {
      const m = brakeBoostMultiplier(UP, { x: 3, y: vy }, T);
      expect(Math.abs(m - prev)).toBeLessThan(0.002);
      expect(m).toBeGreaterThanOrEqual(1);
      prev = m;
    }
    // sideways drift through zero with a tiny closing speed: still continuous
    expect(brakeBoostMultiplier(UP, { x: 1e-9, y: 1e-9 }, T)).toBeCloseTo(1, 9);
  });

  it('brakeBoost 1 (or a degenerate ref) switches the assist off', () => {
    expect(brakeBoostMultiplier(UP, { x: 0, y: 400 }, { brakeBoost: 1, brakeBoostRef: 180 })).toBe(1);
    expect(brakeBoostMultiplier(UP, { x: 0, y: 400 }, { brakeBoost: 1.5, brakeBoostRef: 0 })).toBe(1);
  });
});

describe('S10 tuning fields', () => {
  it('lander 1.5 / csm 1.3 / harpoonThrust 1.5, all at 180 px/s', () => {
    const t = resolveTuning();
    expect([t.lander.brakeBoost, t.lander.brakeBoostRef]).toEqual([1.5, 180]);
    expect([t.csm.brakeBoost, t.csm.brakeBoostRef]).toEqual([1.3, 180]);
    expect([t.harpoonThrust.brakeBoost, t.harpoonThrust.brakeBoostRef]).toEqual([1.5, 180]);
    expect(t.csm.brakeBoost).toBeLessThan(t.lander.brakeBoost); // map 2's retro-burn stays a skill
  });

  it('registered as per-level overrides with sensible ranges', () => {
    for (const g of ['lander', 'csm', 'harpoonThrust']) {
      expect(PHYSICS_OVERRIDE_KEYS).toContain(`${g}.brakeBoost`);
      expect(PHYSICS_OVERRIDE_KEYS).toContain(`${g}.brakeBoostRef`);
      expect(overrideRangeError(`${g}.brakeBoost`, 1)).toBeNull();
      expect(overrideRangeError(`${g}.brakeBoost`, 2)).toBeNull();
      expect(overrideRangeError(`${g}.brakeBoost`, 0.9)).not.toBeNull(); // never a brake penalty
      expect(overrideRangeError(`${g}.brakeBoost`, 3.5)).not.toBeNull();
      expect(overrideRangeError(`${g}.brakeBoostRef`, 0)).not.toBeNull();
    }
    expect(resolveTuning({ 'lander.brakeBoost': 1 }).lander.brakeBoost).toBe(1);
  });
});

// ------------------------------------------------------------ real physics

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

const REF_G = 3.2;
const V0 = 300;

/** Zero-g world (thrust still scales with REF_G), vessel spawned upright at `vel` px/s. */
async function rig(mode: VesselMode, vel: { x: number; y: number }, overrides: Record<string, number> = {}) {
  const physics = await PhysicsWorld.create({ gravity: { x: 0, y: 0 }, hitSpeedThreshold: 0.5 });
  cleanup.push(() => physics.destroy());
  const vessel = createVessel(mode, physics, { pos: { x: 0, y: 0 }, vel }, () => {}, { tuning: resolveTuning(overrides), refGravity: REF_G, harpoonGuns: 1 });
  const tick = (f: InputFrame) => {
    vessel.applyInput(f, FIXED_DT);
    physics.step(FIXED_DT);
    return vessel.state();
  };
  return { vessel, tick };
}

/** Burn `f` until the velocity along the spawn direction reaches zero: time (s) and distance (px). */
async function brake(mode: VesselMode, vel: { x: number; y: number }, f: Partial<InputFrame>, overrides: Record<string, number> = {}) {
  const { vessel, tick } = await rig(mode, vel, overrides);
  const sp = Math.hypot(vel.x, vel.y);
  const u = { x: vel.x / sp, y: vel.y / sp };
  const frame = { ...emptyFrame(), ...f };
  let s = vessel.state();
  let steps = 0;
  while (s.vel.x * u.x + s.vel.y * u.y > 0 && steps < 60 * 60) {
    s = tick(frame);
    steps++;
  }
  return { time: steps * FIXED_DT, dist: s.pos.x * u.x + s.pos.y * u.y, fuel: s.fuel };
}

describe('S10 braking runs (assist on vs forced off)', () => {
  const cases: [string, VesselMode, { x: number; y: number }, Partial<InputFrame>, string][] = [
    ['lander main pair (falling, burn up)', 'lander', { x: 0, y: V0 }, { thrust: true }, 'lander.brakeBoost'],
    ['lander S9 top thrusters (climbing, burn down)', 'lander', { x: 0, y: -V0 }, { topLeft: true, topRight: true }, 'lander.brakeBoost'],
    ['csm main (falling, burn up)', 'csm', { x: 0, y: V0 }, { thrust: true }, 'csm.brakeBoost'],
    ['harpoonThrust main (falling, burn up)', 'harpoonThrust', { x: 0, y: V0 }, { thrust: true }, 'harpoonThrust.brakeBoost'],
  ];

  it.each(cases)('%s stops measurably sooner and shorter with the assist', async (_n, mode, vel, f, key) => {
    const on = await brake(mode, vel, f);
    const off = await brake(mode, vel, f, { [key]: 1 });
    expect(on.time).toBeLessThan(off.time * 0.85);
    expect(on.dist).toBeLessThan(off.dist * 0.85);
    expect(on.dist).toBeGreaterThan(0);
  });

  it('the lander from 300 px/s: at least ~25 % shorter stopping distance', async () => {
    const on = await brake('lander', { x: 0, y: V0 }, { thrust: true });
    const off = await brake('lander', { x: 0, y: V0 }, { thrust: true }, { 'lander.brakeBoost': 1 });
    expect(on.dist / off.dist).toBeLessThan(0.75);
  });

  it('the csm assist is gentler than the lander (1.3 vs 1.5)', async () => {
    const csmOn = await brake('csm', { x: 0, y: V0 }, { thrust: true });
    const csmOff = await brake('csm', { x: 0, y: V0 }, { thrust: true }, { 'csm.brakeBoost': 1 });
    const lOn = await brake('lander', { x: 0, y: V0 }, { thrust: true });
    const lOff = await brake('lander', { x: 0, y: V0 }, { thrust: true }, { 'lander.brakeBoost': 1 });
    expect(csmOn.time / csmOff.time).toBeGreaterThan(lOn.time / lOff.time);
  });

  it('fuel drain is NOT boosted: same burn ticks -> same fuel either way', async () => {
    for (const [mode, key] of [['lander', 'lander.brakeBoost'], ['csm', 'csm.brakeBoost']] as const) {
      const a = await rig(mode, { x: 0, y: V0 });
      const b = await rig(mode, { x: 0, y: V0 }, { [key]: 1 });
      const f = { ...emptyFrame(), thrust: true };
      let sa = a.vessel.state();
      let sb = b.vessel.state();
      for (let i = 0; i < 60; i++) {
        sa = a.tick(f);
        sb = b.tick(f);
      }
      expect(sa.vel.y).toBeLessThan(sb.vel.y); // the assist really acted ...
      expect(sa.fuel).toBeCloseTo(sb.fuel, 12); // ... at no extra fuel
    }
  });

  it('a perpendicular burn is unaffected (sideways drift, burn up)', async () => {
    const a = await rig('lander', { x: V0, y: 0 });
    const b = await rig('lander', { x: V0, y: 0 }, { 'lander.brakeBoost': 1 });
    const f = { ...emptyFrame(), thrust: true };
    let sa = a.vessel.state();
    let sb = b.vessel.state();
    // one tick: purely perpendicular, identical force (later ticks pick up a small closing component)
    sa = a.tick(f);
    sb = b.tick(f);
    expect(sa.vel.y).toBeCloseTo(sb.vel.y, 9);
    expect(sa.vel.x).toBeCloseTo(sb.vel.x, 9);
  });

  it('thrusting WITH the motion is unaffected', async () => {
    const a = await rig('lander', { x: 0, y: -V0 });
    const b = await rig('lander', { x: 0, y: -V0 }, { 'lander.brakeBoost': 1 });
    const f = { ...emptyFrame(), thrust: true };
    let sa = a.vessel.state();
    let sb = b.vessel.state();
    for (let i = 0; i < 60; i++) {
      sa = a.tick(f);
      sb = b.tick(f);
    }
    expect(sa.vel.y).toBeCloseTo(sb.vel.y, 9);
  });
});

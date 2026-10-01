/**
 * Descent grounded soft-lock (round 3 user report): "when falling to the
 * ground and surviving at the bottom it is not possible to get to the target,
 * I cannot lift from sideways and cannot turn the vessel due to ground".
 *
 * At the floor of Descent (1.2 g) a CSM on its side or nose-down could neither
 * turn (rotateAccel cannot lift the 44 px hull over a corner) nor lift (its
 * thrust only slid it along the floor / pushed it into the ground). The
 * RightingSystem's ground kick now serves the CSM too (src/levels/systems/righting.ts).
 * These fly the real Descent level headless: settle tipped on the floor, then
 * a player-style pilot rights the CSM with the rotate keys and flies into the gate.
 * The lander had the same lock on its side (both steering schemes): see the
 * last block (physlab floor).
 */

import { describe, expect, it } from 'vitest';
import { PX_PER_M, type InputFrame, type VesselMode } from '../src/contracts';
import type { LevelSystemHost } from '../src/levels/systems/types';
import { RightingSystem } from '../src/levels/systems/righting';
import { physlab } from '../src/levels/physlab';
import { LevelSession } from '../src/game/session';
import { descent } from '../src/levels/descent';
import { DirectSteering } from '../src/shell/directSteering';
import { frame } from './support/s7Harness';

const FLOOR = 13900;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Descent with the CSM dropped onto the floor at (x, angle), then 2 s with no input to settle. */
async function settledAt(x: number, angle: number) {
  const s = await LevelSession.create(descent);
  s.start();
  s.physics.setTransform(s.vessel.body, { x: x / PX_PER_M, y: (FLOOR - 40) / PX_PER_M }, angle);
  for (let i = 0; i < 120; i++) s.step(frame());
  expect(s.state.crashed).toBe(false);
  return s;
}

/** min / max y (px) seen on every step of a righting (no hop, no sink / teleport between samples). */
const yRange = { min: Infinity, max: -Infinity };

/** Player-style: hold rotate toward upright (easing off near it) until upright and still. Returns the steps used. */
function rightIt(s: LevelSession, maxSteps = 600): number {
  yRange.min = yRange.max = s.state.pos.y;
  for (let t = 0; t < maxSteps; t++) {
    const a = wrap(s.state.angle);
    if (Math.abs(a) < 0.15 && Math.abs(s.state.angularVel) < 0.3) return t;
    const e = -a - 0.35 * s.state.angularVel;
    s.step(frame({ rotateCW: e > 0.08, rotateCCW: e < -0.08 }));
    yRange.min = Math.min(yRange.min, s.state.pos.y);
    yRange.max = Math.max(yRange.max, s.state.pos.y);
  }
  return -1;
}

/** Climb over the gate's lip, slide over it, then drop into the dock. */
function flyToGate(s: LevelSession, maxSteps = 1800): void {
  for (let u = 0; u < maxSteps && !s.outcome; u++) {
    const st = s.state;
    const ty = Math.abs(st.pos.x - 1200) > 60 ? 13540 : 13800;
    const vxWant = Math.max(-80, Math.min(80, (1200 - st.pos.x) * 0.5));
    const tilt = Math.max(-0.4, Math.min(0.4, (vxWant - st.vel.x) * 0.01));
    const e = wrap(tilt - st.angle) - 0.3 * st.angularVel;
    const vyWant = Math.max(-60, Math.min(60, (ty - st.pos.y) * 0.8));
    s.step(frame({ rotateCW: e > 0.03, rotateCCW: e < -0.03, thrust: st.vel.y > vyWant && Math.abs(wrap(st.angle)) < 0.8 }));
  }
}

const POSES: [string, number, number][] = [
  ['on its right side, left of the gate', 600, Math.PI / 2],
  ['on its left side, left of the gate', 600, -Math.PI / 2],
  ['on its side, right of the gate', 1800, Math.PI / 2],
  ['nose-down', 600, Math.PI],
  ['nose-down, slightly off', 1800, -2.9],
];

describe('Descent: a CSM tipped over on the floor is recoverable', () => {
  it.each(POSES)('%s: the rotate keys right it, then it lifts off and flies into the gate', async (_name, x, angle) => {
    const s = await settledAt(x, angle);
    expect(Math.abs(wrap(s.state.angle))).toBeGreaterThan(1.4); // really lying there
    const steps = rightIt(s);
    expect(steps).toBeGreaterThan(0);
    expect(steps).toBeLessThan(180); // upright within 3 s
    // rolled over on the floor on EVERY step: no hop, no sinking through it
    // (upright the CSM's centre rests 22 px above the floor, on its side ~10 px)
    expect(yRange.min).toBeGreaterThan(FLOOR - 30);
    expect(yRange.max).toBeLessThan(FLOOR - 5);
    flyToGate(s);
    expect(s.outcome?.kind).toBe('complete');
    expect(s.state.crashed).toBe(false);
    s.destroy();
  });

  it('no input = no power: a tipped CSM stays where it lies (no auto-upright)', async () => {
    const s = await settledAt(600, Math.PI / 2);
    const a0 = s.state.angle;
    for (let i = 0; i < 240; i++) s.step(frame());
    expect(Math.abs(s.state.angle - a0)).toBeLessThan(0.01);
    expect(s.systems.righting!.active).toBe(0);
    s.destroy();
  });

  it('DIRECT (finger held above the ship): the steering layer rotates it upright on the floor, then climbs', async () => {
    const s = await settledAt(600, Math.PI / 2);
    const layer = new DirectSteering();
    const y0 = s.state.pos.y;
    for (let i = 0; i < 300; i++) s.step(layer.apply(frame({ steer: { x: 0, y: -1 } }), s.state));
    expect(Math.abs(wrap(s.state.angle))).toBeLessThan(0.3);
    expect(s.state.pos.y).toBeLessThan(y0 - 150);
    expect(s.state.crashed).toBe(false);
    s.destroy();
  });
});

describe('a lander tipped over on the floor is recoverable (ENGINE and DIRECT keys)', () => {
  const GROUND = 1300; // physlab ground line
  async function landerAt(angle: number) {
    const s = await LevelSession.create({ ...physlab, zones: [] });
    s.start();
    expect(s.state.mode).toBe('lander');
    s.physics.setTransform(s.vessel.body, { x: 600 / PX_PER_M, y: (GROUND - 30) / PX_PER_M }, angle);
    for (let i = 0; i < 120; i++) s.step(frame());
    expect(s.state.crashed).toBe(false);
    return s;
  }

  it.each([
    ['on its side', Math.PI / 2],
    ['on its other side', -Math.PI / 2],
    ['upside down', Math.PI],
  ])('%s: rights itself on the turning engines, then climbs', async (_name, angle) => {
    for (const scheme of ['engines', 'direct'] as const) {
      const s = await landerAt(angle);
      expect(Math.abs(wrap(s.state.angle))).toBeGreaterThan(1.4);
      const layer = new DirectSteering();
      let t = 0;
      let yMin = s.state.pos.y;
      let yMax = s.state.pos.y;
      for (; t < 360; t++) {
        const a = wrap(s.state.angle);
        if (Math.abs(a) < 0.15 && Math.abs(s.state.angularVel) < 0.3) break;
        const e = -a - 0.35 * s.state.angularVel;
        const cw = e > 0.08;
        const ccw = e < -0.08;
        let f: InputFrame;
        if (scheme === 'direct') f = layer.apply(frame({ rotateCW: cw, rotateCCW: ccw }), s.state); // the DIRECT keyboard: ← / →
        else f = Math.abs(a) > 1.75 ? frame({ topRight: cw, topLeft: ccw }) : frame({ engineLeft: cw, engineRight: ccw }); // one engine / top thruster
        s.step(f);
        yMin = Math.min(yMin, s.state.pos.y);
        yMax = Math.max(yMax, s.state.pos.y);
      }
      expect(t, scheme).toBeLessThan(180);
      // on the floor on every step: no hop, no sinking through it
      // (upright on its legs the centre rests ~16-21 px above the ground, on its side ~9-12 px)
      expect(yMin, scheme).toBeGreaterThan(GROUND - 28);
      expect(yMax, scheme).toBeLessThan(GROUND - 5);
      const y0 = s.state.pos.y;
      for (let i = 0; i < 120; i++) s.step(scheme === 'direct' ? layer.apply(frame({ thrust: true }), s.state) : frame({ thrust: true }));
      expect(s.state.pos.y, scheme).toBeLessThan(y0 - 50);
      expect(s.state.vel.y, scheme).toBeLessThan(-50); // still climbing
      expect(s.state.crashed).toBe(false);
      s.destroy();
    }
  });
});

describe('righting: only real intent, only with fuel, only on the ground (audit round 3)', () => {
  const GROUND = 1300;
  async function landerAt(angle: number, extra: Record<string, unknown> = {}) {
    const s = await LevelSession.create({ ...physlab, zones: [], ...extra });
    s.start();
    s.physics.setTransform(s.vessel.body, { x: 600 / PX_PER_M, y: (GROUND - 30) / PX_PER_M }, angle);
    for (let i = 0; i < 120; i++) s.step(frame());
    expect(s.state.crashed).toBe(false);
    return s;
  }

  it('M2: a dry lander (no fuel) on its side gets no kick from a held engine', async () => {
    const s = await landerAt(Math.PI / 2, { startFuel: 0 });
    expect(s.state.fuel).toBe(0);
    const a0 = s.state.angle;
    for (let i = 0; i < 180; i++) {
      s.step(frame({ engineRight: true })); // counter-clockwise = towards upright
      expect(s.systems.righting!.active).toBe(0);
    }
    expect(Math.abs(s.state.angle - a0)).toBeLessThan(0.05); // settling only (a kick turns it ~1.5 rad)
    s.destroy();
  });

  it('M3: an inverted lander after a DIRECT rotate key is released: the release brake is never righting intent', async () => {
    const s = await landerAt(Math.PI);
    const layer = new DirectSteering();
    let kicked = 0;
    for (let i = 0; i < 20; i++) {
      s.step(layer.apply(frame({ rotateCW: true }), s.state));
      if (s.systems.righting!.active > 0) kicked++;
    }
    expect(kicked).toBeGreaterThan(0); // the held key did count (nose-down: either way is up)
    let braking = 0;
    for (let i = 0; i < 120; i++) {
      const f = layer.apply(frame(), s.state);
      if (f.engineLeft || f.engineRight || f.topLeft || f.topRight) braking++;
      s.step(f);
      expect(s.systems.righting!.active, `tick ${i} after release`).toBe(0);
    }
    expect(braking).toBeGreaterThan(0); // the brake really fired engines in that window
    s.destroy();
  });

  it('M4: no kick in flight (lander on its side, engine held, falling)', async () => {
    const s = await LevelSession.create({ ...physlab, zones: [] });
    s.start();
    s.physics.setTransform(s.vessel.body, { x: 600 / PX_PER_M, y: (GROUND - 700) / PX_PER_M }, Math.PI / 2);
    for (let i = 0; i < 40; i++) {
      s.step(frame({ engineRight: true }));
      expect(s.systems.righting!.active).toBe(0);
    }
    s.destroy();
  });

  it('M4: a lander lying on a moving (kinematic) island still gets its kick and rights itself', async () => {
    const s = await LevelSession.create({ ...physlab, zones: [] });
    s.start();
    const p = s.physics;
    const top = GROUND - 400;
    const island = p.createBody({ type: 'kinematic', position: { x: 600 / PX_PER_M, y: (top + 10) / PX_PER_M } });
    p.addBox(island, 200 / PX_PER_M, 10 / PX_PER_M);
    p.setLinearVelocity(island, { x: 120 / PX_PER_M, y: 0 }); // 120 px/s: far above the "resting" speed
    p.setTransform(s.vessel.body, { x: 600 / PX_PER_M, y: (top - 14) / PX_PER_M }, Math.PI / 2);
    p.setLinearVelocity(s.vessel.body, { x: 120 / PX_PER_M, y: 0 });
    for (let i = 0; i < 90; i++) s.step(frame());
    expect(s.state.crashed).toBe(false);
    expect(Math.abs(s.state.vel.x - 120)).toBeLessThan(10); // riding the island
    let kicked = 0;
    let t = 0;
    for (; t < 240; t++) {
      const a = wrap(s.state.angle);
      if (Math.abs(a) < 0.15 && Math.abs(s.state.angularVel) < 0.3) break;
      const e = -a - 0.35 * s.state.angularVel;
      s.step(frame({ engineLeft: e > 0.08, engineRight: e < -0.08 }));
      if (s.systems.righting!.active > 0) kicked++;
    }
    expect(kicked).toBeGreaterThan(0);
    expect(t).toBeLessThan(180);
    expect(s.state.pos.y).toBeLessThan(top); // still on the island
    s.destroy();
  });

  /** A RightingSystem on a fake host: one contact (`normal`, other body velocity `otherVel` m/s), vessel velocity `vel` px/s. */
  function fakeRight(mode: VesselMode, normal: { x: number; y: number }, vel = { x: 0, y: 0 }, otherVel = { x: 0, y: 0 }) {
    let torque = 0;
    const host = {
      spec: physlab,
      vessel: { mode, body: 1, parts: new Set([1]), hooks: {} },
      state: { crashed: false, pos: { x: 0, y: 0 }, angle: Math.PI / 2, vel, fuel: 1 },
      physics: {
        getGravity: () => ({ x: 0, y: 9.8 }),
        getMass: () => 1,
        getAngularVelocity: () => 0,
        applyTorque: (_b: unknown, t: number) => (torque += t),
        bodyContacts: () => [{ other: 2, normal, points: [] }],
        hasBody: () => true,
        getLinearVelocity: () => otherVel,
      },
    } as unknown as LevelSystemHost;
    const r = new RightingSystem(host);
    // towards upright from +90°: counter-clockwise
    const f = mode === 'lander' ? frame({ engineRight: true }) : frame({ rotateCCW: true });
    r.beforeStep(f);
    return { active: r.active, torque };
  }

  it.each(['lander', 'csm'] as const)('M4 (%s): a wall or the ceiling is not ground; the floor is, relative to its own motion', (mode) => {
    expect(fakeRight(mode, { x: 0, y: 1 }).active).toBe(1); // floor below
    expect(fakeRight(mode, { x: 0, y: 1 }).torque).toBeLessThan(0);
    expect(fakeRight(mode, { x: 0.6, y: 0.8 }).active).toBe(1); // a slope (~37°)
    expect(fakeRight(mode, { x: 1, y: 0 }).active).toBe(0); // wall on the right
    expect(fakeRight(mode, { x: -1, y: 0 }).active).toBe(0); // wall on the left
    expect(fakeRight(mode, { x: 0, y: -1 }).active).toBe(0); // ceiling
    expect(fakeRight(mode, { x: 0.9, y: 0.3 }).active).toBe(0); // steep (~72°): a wall, not ground
    // sliding at 100 px/s over static ground: not resting; riding a body moving at that speed: resting
    expect(fakeRight(mode, { x: 0, y: 1 }, { x: 100, y: 0 }).active).toBe(0);
    expect(fakeRight(mode, { x: 0, y: 1 }, { x: 100, y: 0 }, { x: 100 / PX_PER_M, y: 0 }).active).toBe(1);
  });

  it('the harpoon pod keeps its S7 rule: any contact counts (its tuned Hollow play leans on it)', () => {
    expect(fakeRight('harpoonThrust', { x: 1, y: 0 }).active).toBe(1);
    expect(fakeRight('harpoonThrust', { x: 0, y: 1 }, { x: 100, y: 0 }).active).toBe(0);
  });
});

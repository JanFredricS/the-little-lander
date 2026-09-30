/**
 * S9 top thrusters (lander): input plumbing (keys -> InputFrame), force
 * direction / torque sign, fuel drain, engine flags (frozen VesselState shape
 * kept), exhaust direction, and the scripted self-righting run: an inverted
 * lander resting on flat ground lifts off and flips with top thrusters only,
 * then levels and hovers.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { FIXED_DT } from '../src/contracts';
import type { GameEvent, InputFrame, InputSampleContext } from '../src/contracts';
import { PhysicsWorld } from '../src/physics/engine';
import { overrideRangeError, PHYSICS_OVERRIDE_KEYS, resolveTuning } from '../src/physics/tuning';
import { pxToM } from '../src/physics/units';
import { createVessel } from '../src/physics/vessel';
import { emptyFrame, InputMapper, KeyboardSource } from '../src/shell/input';

const input = (f: Partial<InputFrame>): InputFrame => ({ ...emptyFrame(), ...f });
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

const G = 3.2;
const GROUND = 300;

async function rig(spawn: { pos: { x: number; y: number }; angle?: number }, ground = true) {
  const physics = await PhysicsWorld.create({ gravity: { x: 0, y: G }, hitSpeedThreshold: 0.5 });
  cleanup.push(() => physics.destroy());
  if (ground) {
    const terrain = physics.createBody({ type: 'static', position: { x: 0, y: 0 }, tag: 'terrain' });
    physics.addChain(terrain, [{ x: -100, y: pxToM(GROUND) }, { x: 200, y: pxToM(GROUND) }], false);
  }
  const events: GameEvent[] = [];
  const vessel = createVessel('lander', physics, spawn, (e) => events.push(e), { tuning: resolveTuning(), refGravity: G, harpoonGuns: 1 });
  const tick = (f: InputFrame = emptyFrame()) => {
    vessel.applyInput(f, FIXED_DT);
    physics.step(FIXED_DT);
    return vessel.state();
  };
  const run = (n: number, f: InputFrame = emptyFrame()) => {
    let s = vessel.state();
    for (let i = 0; i < n; i++) s = tick(f);
    return s;
  };
  return { physics, vessel, events, tick, run };
}

describe('S9 top thrusters: input plumbing', () => {
  const ctx = (mode: InputSampleContext['mode']): InputSampleContext => ({ mode, vesselWorldPos: null, clientToWorld: () => ({ x: 0, y: 0 }) });
  const frameFor = (mode: InputSampleContext['mode'], code: string) => {
    const kb = new KeyboardSource(null);
    const m = new InputMapper();
    m.add(kb);
    kb.keyDown(code);
    return m.sample(ctx(mode));
  };

  it('Q / U -> topLeft, E / O -> topRight in lander mode (and nothing else)', () => {
    for (const code of ['KeyQ', 'KeyU']) {
      const f = frameFor('lander', code);
      expect(f.topLeft, code).toBe(true);
      expect(f.topRight || f.engineLeft || f.engineRight || f.thrust, code).toBe(false);
    }
    for (const code of ['KeyE', 'KeyO']) {
      const f = frameFor('lander', code);
      expect(f.topRight, code).toBe(true);
      expect(f.topLeft || f.engineLeft || f.engineRight || f.thrust, code).toBe(false);
    }
  });

  it('the existing lander keys are unchanged and Q/E/U/O do nothing in the other modes', () => {
    expect(frameFor('lander', 'KeyA').engineLeft).toBe(true);
    expect(frameFor('lander', 'KeyD').engineRight).toBe(true);
    expect(frameFor('lander', 'KeyW').thrust).toBe(true);
    for (const mode of ['csm', 'harpoon', 'harpoonThrust'] as const) {
      for (const code of ['KeyQ', 'KeyE', 'KeyU', 'KeyO']) {
        const f = frameFor(mode, code);
        expect(f.topLeft || f.topRight, `${mode} ${code}`).toBe(false);
      }
    }
  });

  it('a tap shorter than a tick still burns one tick (HELD semantics)', () => {
    const kb = new KeyboardSource(null);
    const m = new InputMapper();
    m.add(kb);
    kb.keyDown('KeyE');
    kb.keyUp('KeyE');
    expect(m.sample(ctx('lander')).topRight).toBe(true);
    expect(m.sample(ctx('lander')).topRight).toBe(false);
  });
});

describe('S9 top thrusters: physics', () => {
  it('tuning fields are registered with ranges', () => {
    expect(PHYSICS_OVERRIDE_KEYS).toContain('lander.topThrust');
    expect(PHYSICS_OVERRIDE_KEYS).toContain('lander.topOffset');
    expect(overrideRangeError('lander.topThrust', 0)).not.toBeNull();
    expect(overrideRangeError('lander.topOffset', -1)).not.toBeNull();
    expect(overrideRangeError('lander.topThrust', 0.5)).toBeNull();
    // both together out-lift the weight (an inverted lander can take off), one alone is weaker than a main engine
    const t = resolveTuning().lander;
    expect(2 * t.topThrust).toBeGreaterThan(1);
    expect(t.topThrust).toBeLessThanOrEqual(t.thrust);
  });

  it('force sign: top-left alone turns counter-clockwise, top-right clockwise; both push along body-down', async () => {
    const l = await rig({ pos: { x: 0, y: 0 } }, false);
    expect(l.run(30, input({ topLeft: true })).angle).toBeLessThan(-0.1);
    const r = await rig({ pos: { x: 0, y: 0 } }, false);
    expect(r.run(30, input({ topRight: true })).angle).toBeGreaterThan(0.1);

    const idle = await rig({ pos: { x: 0, y: 0 } }, false);
    const both = await rig({ pos: { x: 0, y: 0 } }, false);
    const si = idle.run(60);
    const sb = both.run(60, input({ topLeft: true, topRight: true }));
    expect(Math.abs(sb.angle)).toBeLessThan(1e-3);
    expect(sb.vel.y).toBeGreaterThan(si.vel.y + 20); // upright: pushed DOWN, faster than a free fall

    // inverted: both lift (body-down = world up)
    const inv = await rig({ pos: { x: 0, y: 0 }, angle: Math.PI }, false);
    expect(inv.run(60, input({ topLeft: true, topRight: true })).vel.y).toBeLessThan(0);
  });

  it('each top thruster drains fuel at the rate of one main engine', async () => {
    const a = await rig({ pos: { x: 0, y: 0 } }, false);
    const b = await rig({ pos: { x: 0, y: 0 } }, false);
    const c = await rig({ pos: { x: 0, y: 0 } }, false);
    const top = a.run(120, input({ topLeft: true })).fuel;
    const main = b.run(120, input({ engineLeft: true })).fuel;
    const twoTop = c.run(120, input({ topLeft: true, topRight: true })).fuel;
    expect(top).toBeLessThan(1);
    expect(top).toBeCloseTo(main, 6);
    expect(1 - twoTop).toBeCloseTo(2 * (1 - top), 6);
  });

  it('engine flags: engineFlags() + enginesChanged carry the top flags; VesselState.engines keeps its frozen shape', async () => {
    const r = await rig({ pos: { x: 0, y: 0 } }, false);
    const s = r.tick(input({ topRight: true }));
    expect(s.engines).toEqual({ main: false, left: false, right: false });
    expect(r.vessel.engineFlags()).toMatchObject({ topLeft: false, topRight: true });
    const ev = r.events.filter((e) => e.type === 'enginesChanged').at(-1) as unknown as Record<string, boolean>;
    expect(ev).toMatchObject({ main: false, left: false, right: false, topLeft: false, topRight: true });
    r.tick();
    expect(r.vessel.engineFlags().topRight).toBe(false);
  });

  it('no fuel -> top thrusters do not fire', async () => {
    const r = await rig({ pos: { x: 0, y: 0 } }, false);
    r.vessel.addFuel(-1, 'radiation');
    r.tick(input({ topLeft: true, topRight: true }));
    expect(r.vessel.engineFlags()).toMatchObject({ topLeft: false, topRight: false });
  });

  it('top exhaust cones point along body-up', async () => {
    const r = await rig({ pos: { x: 0, y: 0 } }, false);
    r.tick(input({ topLeft: true }));
    const cones = r.vessel.exhaustCones();
    expect(cones).toHaveLength(1);
    expect(cones[0]!.dir.y).toBeLessThan(-0.99);
  });
});

describe('S9 top thrusters: an inverted lander rights itself', () => {
  /** Inverted lander resting on its cabin on flat ground. */
  async function upsideDown() {
    const r = await rig({ pos: { x: 0, y: GROUND - 10 }, angle: Math.PI });
    const s = r.run(60); // settle
    expect(Math.abs(wrap(s.angle))).toBeGreaterThan(3);
    expect(s.crashed).toBe(false);
    return r;
  }

  it('main engines alone cannot flip it (they push it into the ground)', async () => {
    const r = await upsideDown();
    let s = r.run(120, input({ engineLeft: true }));
    s = r.run(120, input({ thrust: true }));
    expect(Math.abs(wrap(s.angle))).toBeGreaterThan(2.5);
    expect(GROUND - s.pos.y).toBeLessThan(15);
  });

  it('scripted: top thrusters alone lift it off and flip it past sideways, then it levels and hovers', async () => {
    const r = await upsideDown();
    let s = r.vessel.state();
    const fuel0 = s.fuel;
    // Phase 1: top thrusters ONLY. Both lift; once clear, one alone spins it toward upright
    // (err > 0 needs counter-clockwise = top-left, err < 0 clockwise = top-right).
    let maxAlt = 0;
    let t1 = 0;
    for (; t1 < 600; t1++) {
      const err = wrap(s.angle);
      if (Math.abs(err) < Math.PI / 3) break;
      const alt = GROUND - s.pos.y;
      maxAlt = Math.max(maxAlt, alt);
      const spinCw = err < 0;
      const f = alt < 40 ? input({ topLeft: true, topRight: true }) : input(spinCw ? { topRight: true } : { topLeft: true });
      expect(f.thrust || f.engineLeft || f.engineRight).toBe(false);
      s = r.tick(f);
      expect(s.crashed).toBe(false);
    }
    expect(Math.abs(wrap(s.angle)), 'flipped past sideways with top thrusters only').toBeLessThan(Math.PI / 3);
    expect(maxAlt).toBeGreaterThan(35); // it really lifted off the ground
    expect(t1 * FIXED_DT).toBeLessThan(6);

    // Phase 2: the main pair levels it (differential) and hovers (bang-bang on vertical speed).
    const angles: number[] = [];
    const vys: number[] = [];
    for (let i = 0; i < 480; i++) {
      const err = wrap(s.angle);
      const u = -(3 * err + 1.2 * s.angularVel); // + = clockwise = left engine
      const climb = s.vel.y > 0 || GROUND - s.pos.y < 60;
      let left = climb || u > 0.3;
      let right = climb || u < -0.3;
      if (u > 0.6) right = false;
      if (u < -0.6) left = false;
      s = r.tick(input({ engineLeft: left, engineRight: right }));
      expect(s.crashed).toBe(false);
      if (i >= 360) {
        angles.push(Math.abs(wrap(s.angle)));
        vys.push(Math.abs(s.vel.y));
      }
    }
    expect(Math.max(...angles)).toBeLessThan(0.15); // upright
    expect(Math.max(...vys)).toBeLessThan(10); // hovering
    expect(GROUND - s.pos.y).toBeGreaterThan(40); // off the ground
    expect(s.hull).toBe(1);
    expect(s.fuel).toBeLessThan(fuel0 - 0.05); // it cost fuel
  });
});

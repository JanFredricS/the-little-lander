/**
 * Round 15: the spring-legs vessel mode (src/physics/vessel/spring.ts) - aim + charge on
 * the ground, ballistic flight, touchdown soak, both input paths, cancel, hull damage on a
 * big fall, and the map-2 auto-bounce hooks as a pure data tweak.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { FIXED_DT, PX_PER_M } from '../src/contracts';
import type { GameEvent, InputFrame } from '../src/contracts';
import { PhysicsWorld } from '../src/physics/engine';
import { resolveTuning, SPRING_TUNING, tuningConsistencyErrors, type VesselOptions } from '../src/physics/tuning';
import { pxToM, vMToPx } from '../src/physics/units';
import { createVessel } from '../src/physics/vessel';
import { springLaunchVelocity, springMaxRise, springPreviewSec, springReach, stickPower, SPRING_MIN_STICK_POWER, SPRING_PREVIEW_PAST, SPRING_STICK_DEADZONE } from '../src/physics/vessel/spring';
import { emptyFrame, InputMapper, SPRING_POINTER_FULL_PX, VirtualControlsSource } from '../src/shell/input';

const input = (f: Partial<InputFrame>): InputFrame => ({ ...emptyFrame(), ...f });
const idle = emptyFrame();

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

const G = 12; // m/s² felt (the spring maps' gravity)
const GROUND = 600;

async function rig(opts: { overrides?: Record<string, number>; pos?: { x: number; y: number }; angle?: number; vel?: { x: number; y: number }; ground?: number; chain?: { x: number; y: number }[] } = {}) {
  const physics = await PhysicsWorld.create({ gravity: { x: 0, y: G }, hitSpeedThreshold: 0.5 });
  cleanup.push(() => physics.destroy());
  const terrain = physics.createBody({ type: 'static', position: { x: 0, y: 0 }, tag: 'terrain' });
  const gy = opts.ground ?? GROUND;
  const chain = opts.chain ?? [{ x: -3000, y: gy }, { x: 3000, y: gy }];
  physics.addChain(terrain, chain.map((p) => ({ x: pxToM(p.x), y: pxToM(p.y) })), false);
  const events: GameEvent[] = [];
  const options: VesselOptions = { tuning: resolveTuning(opts.overrides), refGravity: G, harpoonGuns: 1 };
  const vessel = createVessel('spring', physics, { pos: opts.pos ?? { x: 0, y: gy - 16.5 }, angle: opts.angle, vel: opts.vel }, (e) => events.push(e), options);
  const tick = (frame: InputFrame = idle) => {
    vessel.applyInput(frame, FIXED_DT);
    physics.step(FIXED_DT);
    return vessel.state();
  };
  const run = (n: number, frame: InputFrame | ((i: number) => InputFrame) = idle) => {
    let s = vessel.state();
    for (let i = 0; i < n; i++) s = tick(typeof frame === 'function' ? frame(i) : frame);
    return s;
  };
  /** Run until landed (or max ticks). */
  const settle = (max = 600) => {
    let s = vessel.state();
    for (let i = 0; i < max && !s.landed; i++) s = tick();
    return s;
  };
  return { physics, vessel, events, tick, run, settle, tuning: options.tuning };
}

const gPx = G * PX_PER_M;

describe('spring legs: ballistics', () => {
  it('stands, charges on keys for chargeSec, launches at jumpSpeedMax straight up and peaks at v²/2g', async () => {
    const r = await rig();
    let s = r.settle();
    expect(s.landed).toBe(true);
    const y0 = s.pos.y;
    expect(r.vessel.springState!().phase).toBe('ground');
    r.run(Math.ceil(SPRING_TUNING.chargeSec / FIXED_DT) + 5, input({ thrust: true }));
    expect(r.vessel.springState!().power).toBe(1);
    expect(r.vessel.springState!().phase).toBe('charging');
    s = r.tick(idle); // released: jump
    expect(r.events.some((e) => e.type === 'springJump' && e.power === 1)).toBe(true);
    let minY = s.pos.y;
    for (let i = 0; i < 240; i++) minY = Math.min(minY, r.tick().pos.y);
    const rise = y0 - minY;
    expect(rise).toBeGreaterThan(springMaxRise(SPRING_TUNING, gPx) * 0.95);
    expect(rise).toBeLessThan(springMaxRise(SPRING_TUNING, gPx) * 1.03);
  });

  it('a touchdown is soaked by the springs: the hull stops where it lands (no slide) and is landed again', async () => {
    const r = await rig();
    r.settle();
    // aim right 0.6 rad, half charge with the stick
    const len = SPRING_STICK_DEADZONE + 0.5 * (1 - SPRING_STICK_DEADZONE);
    r.run(3, input({ steer: { x: Math.sin(0.6), y: -Math.cos(0.6) }, steerLength: len }));
    expect(r.vessel.springState!().power).toBeCloseTo(0.5, 6);
    r.tick(); // stick let go -> jump
    expect(r.vessel.springState!().phase).toBe('air');
    let s = r.vessel.state();
    let i = 0;
    while (r.vessel.springState!().phase === 'air' && i++ < 600) s = r.tick();
    const xLand = s.pos.x;
    expect(Math.hypot(s.vel.x, s.vel.y)).toBeLessThan(1);
    s = r.run(60);
    expect(s.landed).toBe(true);
    expect(Math.abs(s.pos.x - xLand)).toBeLessThan(1.5);
    // the flight distance matches the analytic range for that launch (flat ground, rise 0)
    const v = springLaunchVelocity(SPRING_TUNING, 0.6, 0.5);
    const range = (2 * v.x * -v.y) / gPx;
    expect(xLand).toBeGreaterThan(range * 0.95);
    expect(xLand).toBeLessThan(range * 1.05);
  });

  it('keyboard (sweep + hold) and stick (direction + deflection) give the same jump', async () => {
    const aimTicks = 30;
    const holdTicks = 36;
    const a = await rig();
    a.settle();
    a.run(aimTicks, input({ rotateCW: true }));
    a.run(holdTicks, input({ thrust: true }));
    const ka = a.vessel.springState!();
    a.tick();
    const va = a.vessel.state().vel;

    const b = await rig();
    b.settle();
    const steer = { x: Math.sin(ka.aim), y: -Math.cos(ka.aim) };
    const len = SPRING_STICK_DEADZONE + ka.power * (1 - SPRING_STICK_DEADZONE);
    expect(stickPower(len)).toBeCloseTo(ka.power, 9);
    b.run(5, input({ steer, steerLength: len }));
    b.tick();
    const vb = b.vessel.state().vel;
    expect(vb.x).toBeCloseTo(va.x, 3);
    expect(vb.y).toBeCloseTo(va.y, 3);
    expect(ka.aim).toBeCloseTo(aimTicks * FIXED_DT * SPRING_TUNING.aimRate, 6);
  });

  it('the aim is clamped to ±aimMax; the stick down zone and S / release cancel without jumping', async () => {
    const r = await rig();
    r.settle();
    r.run(200, input({ rotateCCW: true }));
    expect(r.vessel.springState!().aim).toBeCloseTo(-SPRING_TUNING.aimMax, 9);
    r.run(20, input({ thrust: true }));
    r.tick(input({ thrust: true, release: true }));
    expect(r.vessel.springState!().power).toBe(0);
    let s = r.run(30);
    expect(s.landed).toBe(true);
    expect(r.events.some((e) => e.type === 'springJump')).toBe(false);
    // stick: charge, then swing down into the cancel zone, then let go
    r.run(10, input({ steer: { x: 0.6, y: -0.8 }, steerLength: 0.9 }));
    expect(r.vessel.springState!().phase).toBe('charging');
    r.run(3, input({ steer: { x: 0, y: 1 }, steerLength: 0.9 }));
    s = r.run(30);
    expect(r.events.some((e) => e.type === 'springJump')).toBe(false);
    expect(s.landed).toBe(true);
    expect(r.events.filter((e) => e.type === 'springCharging').map((e) => (e as { charging: boolean }).charging)).toEqual([true, false, true, false]);
  });

  it('no control in the air: thrust / stick / keys do not change the arc; there is no fuel use', async () => {
    const run = async (airFrame: InputFrame) => {
      const r = await rig();
      r.settle();
      r.run(40, input({ thrust: true }));
      r.tick();
      for (let i = 0; i < 20; i++) r.tick(airFrame);
      return r.vessel.state();
    };
    const a = await run(idle);
    const b = await run(input({ thrust: true, engineLeft: true, rotateCW: true, steer: { x: 1, y: 0 }, steerLength: 1 }));
    expect(b.pos.x).toBeCloseTo(a.pos.x, 6);
    expect(b.pos.y).toBeCloseTo(a.pos.y, 6);
    expect(b.fuel).toBe(1);
    expect(b.engines).toEqual({ main: false, left: false, right: false });
  });

  it('a short fall is harmless, a long fall dents the hull, a huge one crashes', async () => {
    const drop = async (h: number) => {
      const r = await rig({ pos: { x: 0, y: GROUND - 16.5 - h } });
      const s = r.run(400);
      return s;
    };
    const small = await drop(springMaxRise(SPRING_TUNING, gPx)); // a full-height jump back down
    expect(small.hull).toBe(1);
    expect(small.landed).toBe(true);
    const mid = await drop(600);
    expect(mid.hull).toBeLessThan(1);
    expect(mid.crashed).toBe(false);
    const big = await drop(1600);
    expect(big.crashed).toBe(true);
  });

  it('damageSpeed / crashSpeed are the touchdown APPROACH speed (calibrated, audit L1: within 5 %)', async () => {
    const hit = async (v: number) => {
      const r = await rig({ pos: { x: 0, y: GROUND - 16.5 - 2 }, vel: { x: 0, y: v } });
      return r.run(30);
    };
    expect((await hit(SPRING_TUNING.damageSpeed * 0.95)).hull).toBe(1);
    expect((await hit(SPRING_TUNING.damageSpeed * 1.05)).hull).toBeLessThan(1);
    expect((await hit(SPRING_TUNING.crashSpeed * 0.95)).crashed).toBe(false);
    expect((await hit(SPRING_TUNING.crashSpeed * 1.05)).crashed).toBe(true);
  });

  it('a pause / controls card mid-charge (input cleared) cancels: the first resumed step does not jump (audit M1)', async () => {
    for (const charge of [input({ thrust: true }), input({ steer: { x: 0.5, y: -0.86 }, steerLength: 0.8 })]) {
      const r = await rig();
      r.settle();
      r.run(40, charge);
      expect(r.vessel.springState!().phase).toBe('charging');
      r.vessel.inputCleared!();
      expect(r.vessel.springState!().power).toBe(0);
      const s = r.run(30); // resumed with nothing held
      expect(r.events.some((e) => e.type === 'springJump')).toBe(false);
      expect(s.landed).toBe(true);
      expect(r.vessel.springState!().phase).toBe('ground');
    }
  });

  it('easing the stick back to the centre cancels (no feeble hop); letting go off a real charge jumps (audit L3)', async () => {
    const r = await rig();
    r.settle();
    const dir = { x: 0, y: -1 };
    // push to 0.8, then ease back through the deadzone over a few ticks
    r.run(10, input({ steer: dir, steerLength: 0.8 }));
    for (const len of [0.6, 0.4, 0.3, 0.25, 0.23]) r.tick(input({ steer: dir, steerLength: len }));
    expect(r.vessel.springState!().power).toBeLessThan(SPRING_MIN_STICK_POWER);
    r.run(30);
    expect(r.events.some((e) => e.type === 'springJump')).toBe(false);
    expect(r.vessel.springState!().phase).toBe('ground');
    // finger lifted at 0.8: jumps at that charge
    r.run(10, input({ steer: dir, steerLength: 0.8 }));
    r.tick();
    expect(r.events.filter((e) => e.type === 'springJump')).toHaveLength(1);
  });

  it('the arc preview spans the whole flight back down to the launch height (audit L4)', () => {
    const g = { x: 0, y: gPx };
    for (const [aim, power] of [[0, 1], [0.6, 0.5], [-1.2, 0.3], [1.4, 1]] as const) {
      const v = springLaunchVelocity(SPRING_TUNING, aim, power);
      const flight = (2 * -v.y) / gPx;
      expect(springPreviewSec(v, g)).toBeCloseTo(Math.max(0.3, flight * SPRING_PREVIEW_PAST), 9);
      expect(springPreviewSec(v, g)).toBeGreaterThanOrEqual(flight);
    }
  });

  it('a landing tilted on the legs rights itself; one foot past a ledge topples off', async () => {
    const r = await rig();
    r.settle();
    r.physics.setTransform(r.vessel.body, r.physics.getTransform(r.vessel.body), 0.25);
    const s = r.run(120);
    expect(Math.abs(s.angle)).toBeLessThan(0.05);
    expect(s.landed).toBe(true);
    // one foot past a ledge (the hull centre over the drop): the weak on-legs righting does not hold it
    const l = await rig({ chain: [{ x: -3000, y: GROUND }, { x: 0, y: GROUND }, { x: 0, y: GROUND + 400 }, { x: 3000, y: GROUND + 400 }], pos: { x: 8, y: GROUND - 16.5 } });
    const sl = l.run(240);
    expect(sl.pos.y).toBeGreaterThan(GROUND + 200);
  });

  it('a hull lying on its side (a bad fall) is kicked back onto its legs and can jump again', async () => {
    for (const angle of [-1.6, 1.6]) {
      const r = await rig({ pos: { x: 0, y: GROUND - 20 }, angle });
      const s = r.run(180);
      expect(Math.abs(s.angle)).toBeLessThan(0.05);
      expect(s.landed).toBe(true);
      expect(r.vessel.springState!().phase).toBe('ground');
      r.run(10, input({ thrust: true }));
      r.tick();
      expect(r.events.some((e) => e.type === 'springJump')).toBe(true);
    }
  });
});

describe('spring legs: analytic reach', () => {
  it('full charge at 45° under the spring-map gravity reaches v²/g on the flat', () => {
    const v = SPRING_TUNING.jumpSpeedMax;
    expect(springReach(SPRING_TUNING, gPx, 0)).toBeCloseTo((v * v) / gPx, 0);
    expect(springReach(SPRING_TUNING, gPx, springMaxRise(SPRING_TUNING, gPx) + 1)).toBe(-1);
    expect(springReach(SPRING_TUNING, gPx, 100)).toBeLessThan(springReach(SPRING_TUNING, gPx, 0));
  });

  it('tuning: the spring group is registered, ranged and consistency-checked', () => {
    expect(tuningConsistencyErrors(resolveTuning({ 'spring.jumpSpeedMin': 500 }))).toContain('spring.jumpSpeedMin must be < spring.jumpSpeedMax');
    expect(resolveTuning({ 'spring.autoBounce': 0.5 }).spring.autoBounce).toBe(0); // int-only: ignored
    expect(resolveTuning({ 'spring.autoBounce': 1 }).spring.autoBounce).toBe(1);
  });
});

describe('spring legs: map-2 auto-bounce is a data tweak', () => {
  const MAP2 = { 'spring.autoBounce': 1 };

  it('a fast touchdown bounces back with bounceRestitution; slow ones settle', async () => {
    const h = 300;
    const r = await rig({ overrides: MAP2, pos: { x: 0, y: GROUND - 16.5 - h } });
    let s = r.vessel.state();
    let vin = 0;
    for (let i = 0; i < 200; i++) {
      const before = s.vel.y;
      s = r.tick();
      if (before > 100 && s.vel.y < 0) {
        vin = before;
        break;
      }
    }
    expect(vin).toBeGreaterThan(300);
    expect(-s.vel.y).toBeCloseTo(vin * SPRING_TUNING.bounceRestitution, -1);
    s = r.run(900);
    expect(s.landed).toBe(true); // the bounces decay below bounceMinSpeed and it stands
  });

  it('a jump released in the air is armed and fires at the next touchdown (timed bounce)', async () => {
    const r = await rig({ overrides: MAP2, pos: { x: 0, y: GROUND - 16.5 - 200 } });
    // charge in the air (allowed only with autoBounce), aim right, release just before touchdown
    r.run(10, input({ steer: { x: 0.5, y: -0.866 }, steerLength: 1 }));
    expect(r.vessel.springState!().phase).toBe('air');
    expect(r.vessel.springState!().power).toBe(1);
    // keep holding until ~0.1 s before touchdown, then let go
    const fall = Math.sqrt((2 * 190) / gPx);
    const hold = Math.max(0, Math.round(fall / FIXED_DT) - 10 - 6);
    r.run(hold, input({ steer: { x: 0.5, y: -0.866 }, steerLength: 1 }));
    r.tick();
    expect(r.vessel.springState!().armed).toBe(true);
    let s = r.vessel.state();
    for (let i = 0; i < 30 && s.vel.y >= 0; i++) s = r.tick();
    const want = springLaunchVelocity(SPRING_TUNING, Math.atan2(0.5, 0.866), 1);
    expect(s.vel.x).toBeCloseTo(want.x, 0);
    expect(r.events.some((e) => e.type === 'springJump' && e.power === 1)).toBe(true);
  });

  it('map 1 (default) never bounces: the same drop just stands', async () => {
    const r = await rig({ pos: { x: 0, y: GROUND - 16.5 - 300 } });
    let s = r.vessel.state();
    let up = false;
    for (let i = 0; i < 300; i++) {
      s = r.tick();
      if (s.vel.y < -20) up = true;
    }
    expect(up).toBe(false);
    expect(s.landed).toBe(true);
  });
});

describe('spring legs: input plumbing', () => {
  it('the mapper keeps the stick deflection as steerLength (direction normalised)', () => {
    const m = new InputMapper();
    const v = new VirtualControlsSource();
    m.add(v);
    v.setSteer({ x: 0.3, y: -0.4 });
    const f = m.sample({ mode: 'spring', vesselWorldPos: { x: 0, y: 0 }, clientToWorld: (x: number, y: number) => ({ x, y }) } as never);
    expect(f.steer.x).toBeCloseTo(0.6, 9);
    expect(f.steer.y).toBeCloseTo(-0.8, 9);
    expect(f.steerLength).toBeCloseTo(0.5, 9);
    v.setSteer({ x: 3, y: 4 });
    expect(m.sample({ mode: 'spring' } as never).steerLength).toBe(1);
    v.setSteer(null);
    expect(m.sample({ mode: 'spring' } as never).steerLength).toBeUndefined();
    expect(SPRING_POINTER_FULL_PX).toBeGreaterThan(0);
  });

  it('vMToPx sanity for the launch (px/s round-trip)', () => {
    expect(vMToPx({ x: 1, y: 0 }).x).toBe(PX_PER_M);
  });
});

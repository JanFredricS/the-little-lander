/**
 * Deterministic flight sims (S1): vessel controllers, harpoon rope,
 * crash / soft-land, and every environment system through LevelSession.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { FIXED_DT } from '../src/contracts';
import type { EntitySpec, GameEvent, GameEventOf, GameEventType, InputFrame, LevelSpec, TerrainPiece, ZoneSpec } from '../src/contracts';
import { LevelSession } from '../src/game/session';
import { physlab } from '../src/levels/physlab';
import { validateLevel } from '../src/levels/validate';
import { PhysicsWorld } from '../src/physics/engine';
import { gustPhase } from '../src/physics/env/wind';
import { PHYSICS_OVERRIDE_KEYS, resolveTuning, type VesselOptions } from '../src/physics/tuning';
import { mToPx, pxToM } from '../src/physics/units';
import { createVessel, type FlightVessel } from '../src/physics/vessel';
import { emptyFrame } from '../src/shell/input';

const idle = emptyFrame();
const input = (f: Partial<InputFrame>): InputFrame => ({ ...emptyFrame(), ...f });

// ----------------------------------------------------------------- harness

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

/** Bare world + vessel (no environment). Positions in px. */
async function rig(mode: FlightVessel['mode'], opts: { gravity?: number; pos?: { x: number; y: number }; vel?: { x: number; y: number }; ground?: number; ceiling?: number; guns?: 1 | 2 } = {}) {
  const g = opts.gravity ?? 3.2;
  const physics = await PhysicsWorld.create({ gravity: { x: 0, y: g }, hitSpeedThreshold: 0.5 });
  cleanup.push(() => physics.destroy());
  const terrain = physics.createBody({ type: 'static', position: { x: 0, y: 0 }, tag: 'terrain' });
  if (opts.ground !== undefined) physics.addChain(terrain, [{ x: -100, y: pxToM(opts.ground) }, { x: 200, y: pxToM(opts.ground) }], false);
  if (opts.ceiling !== undefined) physics.addChain(terrain, [{ x: 200, y: pxToM(opts.ceiling) }, { x: -100, y: pxToM(opts.ceiling) }], false);
  const events: GameEvent[] = [];
  const options: VesselOptions = { tuning: resolveTuning(), refGravity: Math.max(1.6, g), harpoonGuns: opts.guns ?? 1 };
  const vessel = createVessel(mode, physics, { pos: opts.pos ?? { x: 0, y: 0 }, vel: opts.vel }, (e) => events.push(e), options);
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
  return { physics, vessel, events, tick, run, g };
}

const GROUND = 1900;

function lab(over: Partial<LevelSpec> & { pieces?: TerrainPiece[] } = {}): LevelSpec {
  const { pieces, ...rest } = over;
  return {
    id: 'physlab',
    title: 'test',
    themeId: 'hangar',
    vesselMode: 'lander',
    worldSize: { w: 3000, h: 2000 },
    spawn: { x: 500, y: GROUND - 20 },
    gravity: { x: 0, y: 3.2 },
    terrain: {
      pieces: pieces ?? [{ id: 'ground', kind: 'ground', points: [{ x: 0, y: GROUND }, { x: 3000, y: GROUND }], style: { material: 'metal' } }],
    },
    entities: [],
    zones: [],
    objectives: [],
    ...rest,
  };
}

async function session(spec: LevelSpec) {
  const s = await LevelSession.create(spec);
  cleanup.push(() => s.destroy());
  const events: GameEvent[] = [];
  s.on((e) => events.push(e));
  s.start();
  const run = (n: number, frame: InputFrame | ((i: number) => InputFrame) = idle, until?: () => boolean) => {
    for (let i = 0; i < n; i++) {
      s.step(typeof frame === 'function' ? frame(i) : frame);
      if (until?.()) break;
    }
    return s.state;
  };
  return { s, events, run };
}

function ofType<T extends GameEventType>(events: GameEvent[], type: T): GameEventOf<T>[] {
  return events.filter((e): e is GameEventOf<T> => e.type === type);
}

// ------------------------------------------------------------------ lander

describe('lander', () => {
  it('both engines climb straight up', async () => {
    const { run } = await rig('lander', { pos: { x: 0, y: 0 } });
    const s = run(90, input({ thrust: true }));
    expect(s.pos.y).toBeLessThan(-20);
    expect(Math.abs(s.angle)).toBeLessThan(1e-3);
    expect(Math.abs(s.pos.x)).toBeLessThan(0.5);
    expect(s.engines).toEqual({ main: false, left: true, right: true });
    expect(s.fuel).toBeLessThan(1);
  });

  it('one engine alone tilts the lander and drifts it sideways', async () => {
    const left = await rig('lander');
    let s = left.run(40, input({ engineLeft: true }));
    expect(s.angle).toBeGreaterThan(0.2); // left engine -> clockwise
    s = left.run(60, input({ thrust: true }));
    expect(s.vel.x).toBeGreaterThan(10); // nose tilted right -> drifts right

    const right = await rig('lander');
    s = right.run(40, input({ engineRight: true }));
    expect(s.angle).toBeLessThan(-0.2);
    s = right.run(60, input({ thrust: true }));
    expect(s.vel.x).toBeLessThan(-10);
  });

  it('one engine burns half as fast as both', async () => {
    const one = await rig('lander');
    const both = await rig('lander');
    const a = one.run(120, input({ engineLeft: true }));
    const b = both.run(120, input({ thrust: true }));
    expect(1 - a.fuel).toBeCloseTo((1 - b.fuel) / 2, 6);
  });
});

// --------------------------------------------------------------------- csm

describe('csm', () => {
  it('holding thrust runs away (thrust-to-weight ~1.8)', async () => {
    const { run, g } = await rig('csm');
    const s = run(120, input({ thrust: true }));
    // net up ≈ 0.8 g for 2 s
    expect(-s.vel.y).toBeGreaterThan(mToPx(0.8 * g * 2) * 0.9);
  });

  it('a hover by pulsing needs a duty cycle near 1/1.8', async () => {
    const { tick, vessel } = await rig('csm');
    const target = 0;
    let on = 0;
    let s = vessel.state();
    let maxErr = 0;
    const N = 600;
    for (let i = 0; i < N; i++) {
      const thrust = s.pos.y > target || s.vel.y > 0;
      if (thrust) on++;
      s = tick(input({ thrust }));
      if (i > 120) maxErr = Math.max(maxErr, Math.abs(s.pos.y - target));
    }
    const duty = on / N;
    expect(duty).toBeGreaterThan(1 / 1.8 - 0.07);
    expect(duty).toBeLessThan(1 / 1.8 + 0.07);
    expect(maxErr).toBeLessThan(20);
  });

  it('rotate input turns the stack; thrust follows the nose', async () => {
    const { run } = await rig('csm');
    let s = run(30, input({ rotateCW: true }));
    expect(s.angle).toBeGreaterThan(0.3);
    s = run(60, input({ thrust: true }));
    expect(s.vel.x).toBeGreaterThan(20);
  });

  it('no thrust without fuel', async () => {
    const r = await rig('csm');
    r.vessel.addFuel(-1, 'refill');
    const s = r.run(30, input({ thrust: true }));
    expect(s.engines.main).toBe(false);
    expect(s.vel.y).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------ crash / land

describe('crash vs soft-land', () => {
  it('a gentle touchdown is a soft landing (no damage)', async () => {
    const { run, events } = await rig('lander', { ground: 100, pos: { x: 0, y: 80 } });
    const s = run(180);
    expect(s.landed).toBe(true);
    expect(s.crashed).toBe(false);
    expect(s.hull).toBe(1);
    expect(ofType(events, 'softLand')).toHaveLength(1);
  });

  it('a firm touchdown damages the hull but lands', async () => {
    const t = resolveTuning().lander;
    const speed = (t.damageSpeed + t.crashSpeed) / 2;
    const { run, events } = await rig('lander', { ground: 100, pos: { x: 0, y: 70 }, vel: { x: 0, y: speed } });
    const s = run(180);
    expect(s.crashed).toBe(false);
    expect(s.hull).toBeLessThan(1);
    expect(s.hull).toBeGreaterThan(0.5);
    expect(s.landed).toBe(true);
    expect(ofType(events, 'hullChanged')[0]?.reason).toBe('impact');
  });

  it('a hard impact crashes', async () => {
    const t = resolveTuning().lander;
    const { run, events } = await rig('lander', { ground: 100, pos: { x: 0, y: 60 }, vel: { x: 0, y: t.crashSpeed + 40 } });
    const s = run(60);
    expect(s.crashed).toBe(true);
    expect(s.hull).toBe(0);
    expect(s.landed).toBe(false);
    const crash = ofType(events, 'crash');
    expect(crash).toHaveLength(1);
    expect(crash[0]!.cause).toBe('impact');
    expect(ofType(events, 'impact').length).toBeGreaterThan(0);
  });

  it('touching down tilted is not a landing', async () => {
    const { vessel, physics, run } = await rig('csm', { ground: 100, pos: { x: 0, y: 70 } });
    physics.setTransform(vessel.body, physics.getTransform(vessel.body), 0.6);
    physics.setAngularVelocity(vessel.body, 0);
    const s = run(20);
    expect(s.landed).toBe(false);
  });
});

// ----------------------------------------------------------------- harpoon

describe('harpoon', () => {
  it('fires, anchors to the ceiling, reels in and releases', async () => {
    const { run, events, vessel } = await rig('harpoon', { ceiling: -200 });
    let s = run(1, input({ fire: true, aim: { x: 0, y: -1 } }));
    expect(ofType(events, 'harpoonFired')).toHaveLength(1);
    s = run(30);
    expect(ofType(events, 'ropeAttached')).toHaveLength(1);
    expect(s.ropeState?.guns[0]?.phase).toBe('anchored');
    const l0 = s.ropeState!.guns[0]!.length!;
    expect(l0).toBeGreaterThan(150);
    s = run(60, input({ reelIn: true }));
    expect(s.ropeState!.guns[0]!.length!).toBeCloseTo(l0 - resolveTuning().harpoon.reelInSpeed, -1);
    expect(s.pos.y).toBeLessThan(-40); // pulled up towards the anchor
    s = run(1, input({ release: true }));
    expect(ofType(events, 'ropeReleased')).toHaveLength(1);
    expect(s.ropeState?.guns[0]?.phase).toBe('idle');
    expect(vessel.state().ropeState?.guns[0]?.head).toBeUndefined();
  });

  it('misses when nothing is in range', async () => {
    const { run, events } = await rig('harpoon', { ceiling: -1000 });
    run(1, input({ fire: true, aim: { x: 0, y: -1 } }));
    run(40);
    expect(ofType(events, 'harpoonMissed')).toHaveLength(1);
    expect(ofType(events, 'ropeAttached')).toHaveLength(0);
  });

  it('a rope pendulum keeps plausible energy', async () => {
    const { run, physics, vessel, g, events } = await rig('harpoon', { ceiling: -150, gravity: 9.8 });
    const aim = { x: Math.SQRT1_2, y: -Math.SQRT1_2 };
    run(1, input({ fire: true, aim }));
    run(40, idle);
    expect(ofType(events, 'ropeAttached')).toHaveLength(1);
    const m = physics.getMass(vessel.body);
    const energy = () => {
      const t = physics.getTransform(vessel.body);
      const v = physics.getLinearVelocity(vessel.body);
      return 0.5 * m * (v.x * v.x + v.y * v.y) - m * g * t.y; // y-down: height = -y
    };
    run(60); // let the catch settle
    const e0 = energy();
    let max = e0;
    let min = e0;
    for (let i = 0; i < 300; i++) {
      run(1);
      max = Math.max(max, energy());
      min = Math.min(min, energy());
    }
    const span = Math.abs(m * g * 5); // normalise by a 5 m drop
    expect((max - e0) / span).toBeLessThan(0.05); // never gains energy
    expect((e0 - min) / span).toBeLessThan(0.35); // loses a little (damping, soft constraint)
    expect(vessel.state().ropeState!.guns[0]!.phase).toBe('anchored');
  });

  it('two guns: firing with both busy re-fires the older one', async () => {
    const { run, events } = await rig('harpoon', { ceiling: -200, guns: 2 });
    run(1, input({ fire: true, aim: { x: -0.3, y: -1 } }));
    run(20);
    run(1, input({ fire: true, aim: { x: 0.3, y: -1 } }));
    let s = run(20);
    expect(s.ropeState!.guns.map((g) => g.phase)).toEqual(['anchored', 'anchored']);
    run(1, input({ fire: true, aim: { x: 0, y: -1 } }));
    s = run(20);
    expect(ofType(events, 'ropeReleased').map((e) => e.gun)).toEqual([0]);
    expect(ofType(events, 'ropeAttached').map((e) => e.gun)).toEqual([0, 1, 0]);
  });

  it('harpoonThrust has both a rope gun and a main engine', async () => {
    const { run, events } = await rig('harpoonThrust', { ceiling: -200 });
    let s = run(30, input({ thrust: true }));
    expect(s.engines.main).toBe(true);
    expect(s.vel.y).toBeLessThan(0);
    run(1, input({ fire: true, aim: { x: 0, y: -1 } }));
    s = run(20);
    expect(ofType(events, 'ropeAttached')).toHaveLength(1);
  });
});

// ------------------------------------------------------------- environment

const CEILING_Y = 1500;
const tunnel = (extra: TerrainPiece[] = []): TerrainPiece[] => [
  { id: 'ground', kind: 'ground', points: [{ x: 0, y: GROUND }, { x: 3000, y: GROUND }], style: { material: 'metal' } },
  { id: 'roof', kind: 'ceiling', points: [{ x: 0, y: CEILING_Y }, { x: 3000, y: CEILING_Y }], style: { material: 'rock' } },
  ...extra,
];

describe('environment: brittle anchors', () => {
  it('a harpoon anchored in a brittle region breaks after its timer', async () => {
    const { s, events, run } = await session(
      lab({
        vesselMode: 'harpoon',
        spawn: { x: 500, y: CEILING_Y + 200 },
        pieces: tunnel(),
        zones: [{ kind: 'brittleRegion', id: 'brittle', rect: { x: 400, y: CEILING_Y - 50, w: 200, h: 100 }, breakAfterSec: 1 }],
      }),
    );
    run(1, input({ fire: true, aim: { x: 0, y: -1 } }));
    run(30);
    const att = ofType(events, 'ropeAttached');
    expect(att).toHaveLength(1);
    expect(att[0]!.brittle).toBe(true);
    expect(s.state.ropeState!.guns[0]!.brittleTimeLeft).toBeGreaterThan(0);
    run(60);
    const broken = ofType(events, 'ropeBroken');
    expect(broken).toHaveLength(1);
    expect(broken[0]!.reason).toBe('brittle');
    expect(s.state.ropeState!.guns[0]!.phase).toBe('idle');
  });

  it('non-anchorable terrain deflects the harpoon', async () => {
    const { events, run } = await session(
      lab({
        vesselMode: 'harpoon',
        spawn: { x: 500, y: CEILING_Y + 200 },
        pieces: [
          { id: 'ground', kind: 'ground', points: [{ x: 0, y: GROUND }, { x: 3000, y: GROUND }], style: { material: 'metal' } },
          { id: 'roof', kind: 'ceiling', points: [{ x: 0, y: CEILING_Y }, { x: 3000, y: CEILING_Y }], style: { material: 'metal' }, anchorable: false },
        ],
      }),
    );
    run(1, input({ fire: true, aim: { x: 0, y: -1 } }));
    run(30);
    expect(ofType(events, 'harpoonMissed')).toHaveLength(1);
    expect(ofType(events, 'ropeAttached')).toHaveLength(0);
  });
});

describe('environment: gravity', () => {
  it('an inverted gravity zone flips the acceleration', async () => {
    const zone: ZoneSpec = { kind: 'gravityZone', id: 'up', rect: { x: 0, y: 0, w: 1000, h: 1800 }, gravity: { x: 0, y: -3.2 } };
    const { s, events, run } = await session(lab({ vesselMode: 'harpoon', spawn: { x: 500, y: 1000 }, zones: [zone] }));
    const st = run(30);
    expect(st.vel.y).toBeLessThan(-mToPx(3.2 * 0.5) * 0.9);
    expect(ofType(events, 'gravityChanged')[0]?.gravity.y).toBeCloseTo(-3.2, 5);
    // outside the zone gravity is normal
    const out = await session(lab({ vesselMode: 'harpoon', spawn: { x: 1500, y: 1000 }, zones: [zone] }));
    expect(out.run(30).vel.y).toBeGreaterThan(0);
    expect(s.physics.getGravity().y).toBeCloseTo(3.2, 5);
  });

  it('a polygon zone only acts inside the polygon', async () => {
    const zone: ZoneSpec = {
      kind: 'gravityZone',
      id: 'tri',
      rect: { x: 0, y: 0, w: 1000, h: 1800 },
      polygon: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 0, y: 1800 }],
      gravity: { x: 0, y: -3.2 },
    };
    const inside = await session(lab({ vesselMode: 'harpoon', spawn: { x: 200, y: 400 }, zones: [zone] }));
    expect(inside.run(30).vel.y).toBeLessThan(0);
    const outside = await session(lab({ vesselMode: 'harpoon', spawn: { x: 900, y: 1500 }, zones: [zone] }));
    expect(outside.run(30).vel.y).toBeGreaterThan(0);
  });

  it('a gravity ramp follows vessel progress and reports it', async () => {
    const { s, events, run } = await session(
      lab({ vesselMode: 'harpoon', spawn: { x: 500, y: 100 }, gravityRamp: { axis: 'y', from: 0, to: 1800, gravityFrom: { x: 0, y: 1 }, gravityTo: { x: 0, y: 10 } } }),
    );
    run(1);
    const g0 = s.physics.getGravity().y;
    run(150);
    expect(s.physics.getGravity().y).toBeGreaterThan(g0 + 0.3);
    const ev = ofType(events, 'gravityChanged');
    expect(ev.length).toBeGreaterThan(0);
    expect(ev.at(-1)!.rampProgress).toBeGreaterThan(0);
  });
});

describe('environment: wind', () => {
  it('telegraphs, blows, and ends on schedule', async () => {
    const wind: ZoneSpec = { kind: 'windGustSchedule', id: 'w', gusts: [{ atSec: 1, warnSec: 0.5, durationSec: 1, accel: { x: 4, y: 0 } }] };
    const { events, run } = await session(lab({ vesselMode: 'harpoon', spawn: { x: 500, y: 300 }, gravity: { x: 0, y: 0 }, zones: [wind] }));
    const times: [string, number][] = [];
    let t = 0;
    let vxAtEnd = 0;
    const seen = new Set<GameEvent>();
    for (let i = 0; i < 180; i++) {
      const st = run(1);
      t += FIXED_DT;
      for (const e of ofType(events, 'windGust')) if (!seen.has(e)) (seen.add(e), times.push([e.phase, t]));
      if (Math.abs(t - 2) < FIXED_DT / 2) vxAtEnd = st.vel.x;
    }
    expect(times.map((x) => x[0])).toEqual(['warning', 'start', 'end']);
    expect(times[0]![1]).toBeCloseTo(0.5, 1);
    expect(times[1]![1]).toBeCloseTo(1, 1);
    expect(times[2]![1]).toBeCloseTo(2, 1);
    expect(vxAtEnd).toBeCloseTo(mToPx(4 * 1), -1); // 4 m/s² for 1 s
  });

  it('repeating schedules wrap', () => {
    const g = { atSec: 1, warnSec: 2, durationSec: 1, accel: { x: 1, y: 0 } };
    expect(gustPhase(g, 10, 0.5)).toBe('warning');
    expect(gustPhase(g, 10, 1.5)).toBe('active');
    expect(gustPhase(g, 10, 5)).toBe('idle');
    expect(gustPhase(g, 10, 9.5)).toBe('warning'); // next cycle's warning
    expect(gustPhase(g, 10, 11.2)).toBe('active');
    expect(gustPhase(g, undefined, 11.2)).toBe('idle');
  });
});

describe('environment: goo', () => {
  const zeroG = { x: 0, y: 0 };
  const spawner = (y: number): EntitySpec => ({ id: 'goo', kind: 'gooSpawner', x: 500, y, triggerRadius: 400, intervalSec: 100, maxAlive: 1, homingAccel: 6 });

  it('homes onto the hull, attaches and increases effective mass', async () => {
    const { s, events, run } = await session(lab({ vesselMode: 'csm', gravity: zeroG, spawn: { x: 500, y: 1000 }, entities: [spawner(900)] }));
    const m0 = s.vessel.totalMass();
    const accel = () => {
      const v0 = s.state.vel.y;
      run(12, input({ thrust: true }));
      const a = (s.state.vel.y - v0) / (12 * FIXED_DT);
      run(12, idle);
      return a;
    };
    // measure dry acceleration with the goo still far away? spawn happens at once; measure after attach vs a dry twin.
    run(240, idle, () => ofType(events, 'gooAttached').length > 0);
    expect(ofType(events, 'gooAttached')).toHaveLength(1);
    expect(s.state.attachedGoo).toBe(1);
    expect(s.vessel.totalMass()).toBeGreaterThan(m0 * 1.05);
    const aGoo = accel();
    const dry = await session(lab({ vesselMode: 'csm', gravity: zeroG, spawn: { x: 500, y: 1000 } }));
    const v0 = dry.s.state.vel.y;
    dry.run(12, input({ thrust: true }));
    const aDry = (dry.s.state.vel.y - v0) / (12 * FIXED_DT);
    expect(Math.abs(aGoo)).toBeLessThan(Math.abs(aDry) * 0.97);
    expect(aGoo).toBeLessThan(0); // still climbing
  });

  it('exhaust burns off a blob stuck under the hull', async () => {
    const { s, events, run } = await session(lab({ vesselMode: 'csm', gravity: zeroG, spawn: { x: 500, y: 1000 }, entities: [spawner(1100)] }));
    run(240, idle, () => ofType(events, 'gooAttached').length > 0);
    expect(s.state.attachedGoo).toBe(1);
    run(20, input({ thrust: true })); // < burnSec
    expect(ofType(events, 'gooBurned')).toHaveLength(0);
    run(20, input({ thrust: true }));
    expect(ofType(events, 'gooBurned')).toHaveLength(1);
    expect(s.state.attachedGoo).toBe(0);
    expect(s.env.goo.balls).toHaveLength(0);
  });

  it('exhaust burns an approaching blob before it latches', async () => {
    const { s, events, run } = await session(lab({ vesselMode: 'csm', gravity: zeroG, spawn: { x: 500, y: 1000 }, entities: [{ ...spawner(1060), homingAccel: 3 } as EntitySpec] }));
    run(1);
    expect(s.env.goo.balls).toHaveLength(1);
    run(60, (i) => input({ thrust: i % 2 === 0 })); // pulsed: 0.4 s in-cone takes ~0.8 s
    expect(ofType(events, 'gooBurned')).toHaveLength(1);
    expect(ofType(events, 'gooAttached')).toHaveLength(0);
  });
});

describe('environment: radiation', () => {
  const sun: ZoneSpec = { kind: 'radiationEmitter', id: 'sun', x: 1000, y: 1000, range: 1500, periodSec: 1, warnSec: 0.5, fuelLoss: 0.3 };
  const wall: TerrainPiece = {
    id: 'wall',
    kind: 'polygon',
    points: [{ x: 700, y: 700 }, { x: 760, y: 700 }, { x: 760, y: GROUND }, { x: 700, y: GROUND }],
    style: { material: 'rock' },
  };

  it('a pulse in line of sight drains 30 % of current fuel', async () => {
    const { s, events, run } = await session(lab({ zones: [sun] }));
    run(70);
    const charging = ofType(events, 'radiationCharging');
    expect(charging.length).toBeGreaterThanOrEqual(1);
    expect(charging[0]!.inSec).toBeCloseTo(0.5, 1);
    const hits = ofType(events, 'radiationHit');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.fuelLost).toBeCloseTo(0.3, 6);
    expect(s.state.fuel).toBeCloseTo(0.7, 6);
    expect(ofType(events, 'fuelChanged').at(-1)!.reason).toBe('radiation');
  });

  it('an occluder between emitter and vessel blocks the pulse', async () => {
    const { s, events, run } = await session(lab({ zones: [sun], pieces: [...tunnel().slice(0, 1), wall] }));
    run(130);
    expect(ofType(events, 'radiationCharging').length).toBeGreaterThanOrEqual(2);
    expect(ofType(events, 'radiationHit')).toHaveLength(0);
    expect(s.state.fuel).toBe(1);
    expect(s.env.radiation.emitters[0]!.last?.blocked).toBe(true);
  });

  it('out of range is safe', async () => {
    const { events, run } = await session(lab({ zones: [{ ...sun, range: 100 } as ZoneSpec] }));
    run(70);
    expect(ofType(events, 'radiationHit')).toHaveLength(0);
  });
});

describe('environment: debris', () => {
  const rain = (over: Partial<EntitySpec> = {}): EntitySpec =>
    ({ id: 'rain', kind: 'debrisSpawner', x: 500, y: 1500, area: { x: 480, y: 1500, w: 40, h: 10 }, ratePerSec: 6, sizeMin: 10, sizeMax: 16, velocity: { x: 0, y: 300 }, ...over }) as EntitySpec;

  it('spawns deterministic debris that damages the hull', async () => {
    const trace = async () => {
      const { s, events, run } = await session(lab({ gravity: { x: 0, y: 9.8 }, entities: [rain()] }));
      run(120);
      return { hull: s.state.hull, n: s.env.debris.pieces.length, dmg: ofType(events, 'hullChanged').filter((e) => e.reason === 'debris').length, s };
    };
    const a = await trace();
    const b = await trace();
    expect(a.n).toBeGreaterThan(5);
    expect(a.dmg).toBeGreaterThan(0);
    expect(a.hull).toBeLessThan(1);
    expect(a.hull).toBe(b.hull);
  });

  it('respects its activation trigger and duration', async () => {
    const { s, run } = await session(lab({ entities: [rain({ activate: { kind: 'time', atSec: 1 }, durationSec: 0.5 } as Partial<EntitySpec>)] }));
    run(55);
    expect(s.env.debris.pieces).toHaveLength(0);
    run(60);
    expect(s.env.debris.pieces).toHaveLength(3);
    run(60);
    expect(s.env.debris.pieces).toHaveLength(3);
  });
});

describe('environment: pickups & beacons', () => {
  it('orbs and fuel pickups are collected once', async () => {
    const { s, events, run } = await session(
      lab({
        startFuel: 0.5,
        entities: [
          { id: 'o', kind: 'orb', x: 500, y: GROUND - 20, points: 50, fuelRefill: 0.1 },
          { id: 'f', kind: 'fuelPickup', x: 500, y: GROUND - 30, amount: 0.25 },
        ],
        objectives: [{ kind: 'collectOrbs', id: 'orbs', count: 1 }],
      }),
    );
    run(10);
    expect(ofType(events, 'orbCollected')).toEqual([{ type: 'orbCollected', entityId: 'o', points: 50, fuelRefill: 0.1 }]);
    expect(ofType(events, 'fuelChanged').map((e) => e.reason).sort()).toEqual(['orb', 'pickup']);
    expect(s.state.fuel).toBeCloseTo(0.85, 6);
    expect(s.orbs).toBe(1);
    expect(ofType(events, 'objectiveComplete')).toEqual([{ type: 'objectiveComplete', objectiveId: 'orbs' }]);
    expect(s.outcome?.kind).toBe('complete');
  });

  it('soft-landing on a beacon site and holding still plants the beacon', async () => {
    const { s, events, run } = await session(
      lab({
        entities: [{ id: 'site', kind: 'beaconSite', x: 500, y: GROUND, w: 80, holdSec: 1 }],
        objectives: [{ kind: 'plantBeacons', id: 'b', count: 1, siteIds: ['site'] }],
      }),
    );
    run(40);
    expect(ofType(events, 'softLand')[0]?.siteId).toBe('site');
    expect(ofType(events, 'beaconPlanted')).toHaveLength(0);
    run(60);
    expect(ofType(events, 'beaconPlanted')).toEqual([{ type: 'beaconPlanted', siteId: 'site', planted: 1, total: 1 }]);
    expect(s.outcome?.kind).toBe('complete');
  });

  it('lifting off resets the hold', async () => {
    const { events, run } = await session(lab({ entities: [{ id: 'site', kind: 'beaconSite', x: 500, y: GROUND, w: 80, holdSec: 1 }] }));
    run(60);
    run(20, input({ thrust: true }));
    run(30);
    expect(ofType(events, 'beaconPlanted')).toHaveLength(0);
  });
});

describe('session: modes, tuning, physlab', () => {
  it('switches vessel mode keeping fuel and hull', async () => {
    const { s, events, run } = await session(lab({ vesselMode: 'csm', startFuel: 0.6 }));
    run(5);
    s.requestModeSwitch('harpoon');
    run(1);
    expect(s.state.mode).toBe('harpoon');
    expect(s.state.fuel).toBeCloseTo(0.6, 6);
    expect(ofType(events, 'vesselModeChanged')).toEqual([{ type: 'vesselModeChanged', from: 'csm', to: 'harpoon' }]);
    expect(s.state.ropeState?.guns).toHaveLength(1);
  });

  it('LevelSpec.modeSwitch fires on its trigger', async () => {
    const { s, run } = await session(lab({ vesselMode: 'csm', modeSwitch: { to: 'lander', trigger: { kind: 'time', atSec: 0.5 } } }));
    run(20);
    expect(s.state.mode).toBe('csm');
    run(20);
    expect(s.state.mode).toBe('lander');
  });

  it('physicsOverrides tune the controllers; unknown keys are flagged', async () => {
    expect(resolveTuning({ 'csm.thrust': 3, 'nope.x': 1 }).csm.thrust).toBe(3);
    expect(PHYSICS_OVERRIDE_KEYS).toContain('lander.thrust');
    expect(validateLevel({ ...physlab, physicsOverrides: { 'csm.thrust': 2 } })).toEqual([]);
    expect(validateLevel({ ...physlab, physicsOverrides: { 'csm.thrustt': 2 } }).join()).toMatch(/not a registered tuning key/);
    const strong = await session(lab({ vesselMode: 'csm', spawn: { x: 500, y: 1000 }, physicsOverrides: { 'csm.thrust': 3 } }));
    const weak = await session(lab({ vesselMode: 'csm', spawn: { x: 500, y: 1000 } }));
    expect(strong.run(30, input({ thrust: true })).vel.y).toBeLessThan(weak.run(30, input({ thrust: true })).vel.y);
  });

  it('physlab is valid, registered as debug, and runs deterministically in every mode', async () => {
    expect(validateLevel(physlab)).toEqual([]);
    expect(physlab.debug).toBe(true);
    const trace = async () => {
      const { s, run } = await session(physlab);
      const out: number[] = [];
      const modes = ['lander', 'csm', 'harpoon', 'harpoonThrust'] as const;
      for (let i = 0; i < 480; i++) {
        if (i % 120 === 0) s.requestModeSwitch(modes[i / 120]!);
        const st = run(1, input({ thrust: i % 5 < 3, engineLeft: i % 40 < 3, fire: i % 60 === 1, aim: { x: 0, y: -1 }, reelIn: i % 90 > 60 }));
        out.push(st.pos.x, st.pos.y, st.angle);
      }
      return out;
    };
    expect(await trace()).toEqual(await trace());
  });
});

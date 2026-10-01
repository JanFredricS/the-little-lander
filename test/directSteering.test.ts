/**
 * Task 9 DIRECT steering prototype: the angle-hold input layer
 * (src/shell/directSteering.ts) against the REAL vessel controllers and
 * physics, plus the plumbing around it (keyboard / pointer steer, touch
 * layout, pause-menu setting, save field, help card).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { FIXED_DT } from '../src/contracts';
import type { InputFrame, InputSampleContext, VesselMode, VesselState } from '../src/contracts';
import { PhysicsWorld } from '../src/physics/engine';
import { resolveTuning } from '../src/physics/tuning';
import { createVessel } from '../src/physics/vessel';
import {
  commandAngle,
  compressTilt,
  DIRECT_BURN_GATE,
  DIRECT_CROSSOVER_HYSTERESIS,
  DIRECT_KEY_RATE_BAND,
  DIRECT_KEY_STOP_BAND,
  DIRECT_KEY_TURN_RATE,
  DIRECT_LANDER_COUPLE_SCALE,
  DIRECT_LANDER_THRUST_SCALE,
  DIRECT_LEAD_SEC,
  DIRECT_THRUST_BAND,
  DIRECT_TILT_CAP,
  DIRECT_TOP_CROSSOVER,
  DirectSteering,
  landerCoupleScale,
  trailingDuty,
  wrapAngle,
} from '../src/shell/directSteering';
import { emptyFrame, InputMapper, KeyboardSource, PointerSource } from '../src/shell/input';
import { DEFAULT_SETTINGS, parseSave } from '../src/story/save';
import { descent } from '../src/levels/descent';
import { getLevel } from '../src/levels/registry';
import { LevelSession } from '../src/game/session';
import { frameHasInput, helpCard } from '../src/ui/controlsHelp';
import { itemAction, screenModel, type ScreenContext } from '../src/ui/screens';
import { touchLayout } from '../src/ui/touch/touchLayout';

const DEG = Math.PI / 180;
const G = 3.2;
/** World direction (y-down) `deg` clockwise from up. */
const dirAt = (deg: number) => ({ x: Math.sin(deg * DEG), y: -Math.cos(deg * DEG) });
const FLIGHT = ['thrust', 'engineLeft', 'engineRight', 'topLeft', 'topRight', 'rotateCW', 'rotateCCW'] as const;
const flightOn = (f: InputFrame) => FLIGHT.filter((k) => f[k]);

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

/** A vessel in open space, flown only through the DirectSteering layer. */
async function rig(mode: VesselMode, spawn: { angle?: number } = {}, tuning = resolveTuning()) {
  const physics = await PhysicsWorld.create({ gravity: { x: 0, y: G }, hitSpeedThreshold: 0.5 });
  cleanup.push(() => physics.destroy());
  const vessel = createVessel(mode, physics, { pos: { x: 0, y: 0 }, ...spawn }, () => {}, { tuning, refGravity: G, harpoonGuns: 1 });
  const layer = new DirectSteering();
  layer.setLanderTuning(tuning.lander);
  let state: VesselState = vessel.state();
  const frames: InputFrame[] = [];
  const states: VesselState[] = [];
  /** n fixed steps feeding `make()` frames through the layer. */
  const run = (make: () => InputFrame, n: number) => {
    for (let i = 0; i < n; i++) {
      const f = layer.apply(make(), state);
      frames.push(f);
      vessel.applyInput(f, FIXED_DT);
      physics.step(FIXED_DT);
      state = vessel.state();
      states.push(state);
    }
    return state;
  };
  /** n fixed steps holding steer `d` (null = released). */
  const hold = (d: { x: number; y: number } | null, n: number) => run(() => ({ ...emptyFrame(), steer: d ?? { x: 0, y: 0 } }), n);
  /** n fixed steps holding keyboard flags (what KeyboardSource emits in DIRECT; no steer). */
  const keys = (flags: Partial<InputFrame>, n: number) => run(() => ({ ...emptyFrame(), ...flags }), n);
  /** Set the spin (rad/s) directly (a knock the keys did not make). */
  const spin = (w: number) => {
    physics.setAngularVelocity(vessel.body, w);
    state = vessel.state();
  };
  return { layer, hold, keys, frames, states, state: () => state, spin };
}

describe('DIRECT steering: angle hold (lander, real physics)', () => {
  it.each([30, 45, -60, 90, -95])('a %i° command pulses the main engines until the lander points there (upper arc compressed), then burns along it', async (deg) => {
    const r = await rig('lander');
    const end = r.hold(dirAt(deg), 180); // 3 s
    expect(Math.abs(wrapAngle(end.angle - compressTilt(deg * DEG))) / DEG).toBeLessThan(5);
    expect(Math.abs(end.angularVel)).toBeLessThan(0.5);
    // pulses: single-engine ticks both ways (turn + brake) and both-engine ticks (push); only main engines
    const f = r.frames;
    expect(f.some((x) => x.engineLeft && !x.engineRight)).toBe(true);
    expect(f.some((x) => x.engineRight && !x.engineLeft)).toBe(true);
    expect(f.some((x) => x.engineLeft && x.engineRight)).toBe(true);
    expect(f.every((x) => !x.topLeft && !x.topRight && !x.thrust && !x.rotateCW && !x.rotateCCW)).toBe(true);
    expect(r.layer.engineSet).toBe('main');
    // the last second: the vessel accelerates along the command (thrust axis ≈ command, gravity aside)
    const a = r.states[179]!;
    const b = r.states[119]!;
    expect(Math.sign(a.vel.x - b.vel.x)).toBe(Math.sign(Math.sin(deg * DEG)));
  });

  it('the same command from any attitude converges (turning the short way)', async () => {
    for (const start of [-70, -20, 40, 80]) {
      const r = await rig('lander', { angle: start * DEG });
      const end = r.hold(dirAt(20), 180);
      expect(Math.abs(wrapAngle(end.angle - 20 * DEG)) / DEG, `from ${start}°`).toBeLessThan(5);
    }
  });

  it('holding straight up fires both main engines every tick with no turn', async () => {
    const r = await rig('lander');
    const end = r.hold(dirAt(0), 60);
    expect(r.frames.every((f) => f.engineLeft && f.engineRight)).toBe(true);
    expect(Math.abs(end.angle)).toBeLessThan(1e-3);
    expect(end.vel.y).toBeLessThan(0); // climbing
  });
});

describe('DIRECT steering: power (Task 11)', () => {
  it('upper-arc compression: identity to 40°, near-horizontal fingers tilt ~55-65°, horizontal capped ~67°; sign kept', () => {
    expect(compressTilt(30 * DEG) / DEG).toBeCloseTo(30, 9);
    expect(compressTilt(-40 * DEG) / DEG).toBeCloseTo(-40, 9);
    for (const deg of [75, 80, 85]) {
      const t = compressTilt(deg * DEG) / DEG;
      expect(t).toBeGreaterThanOrEqual(55);
      expect(t).toBeLessThanOrEqual(65);
      expect(compressTilt(-deg * DEG) / DEG).toBeCloseTo(-t, 9);
    }
    const h = compressTilt(90 * DEG) / DEG;
    expect(h).toBeGreaterThanOrEqual(65);
    expect(h).toBeLessThanOrEqual(70);
    expect(compressTilt(108 * DEG)).toBe(DIRECT_TILT_CAP); // held main set past 100°: still capped
    // monotonic
    let prev = -Infinity;
    for (let d = 0; d <= 110; d += 1) {
      const t = compressTilt(d * DEG);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });

  it('downward arc (top thrusters) is not compressed', () => {
    const l = new DirectSteering();
    // 135° command -> target body angle -45° exactly: on target and still = both top thrusters
    const f = l.apply({ ...emptyFrame(), steer: dirAt(135) }, { mode: 'lander', angle: -45 * DEG, angularVel: 0 });
    expect(f.topLeft && f.topRight).toBe(true);
    expect(f.engineScale).toBeUndefined();
  });

  it('trailing-engine duty: full inside the band, ramps to 0 at the gate (15-20°)', () => {
    expect(DIRECT_BURN_GATE / DEG).toBeGreaterThanOrEqual(15);
    expect(DIRECT_BURN_GATE / DEG).toBeLessThanOrEqual(20);
    expect(trailingDuty(0)).toBe(1);
    expect(trailingDuty(DIRECT_THRUST_BAND)).toBe(1);
    expect(trailingDuty(DIRECT_BURN_GATE)).toBe(0);
    expect(trailingDuty(40 * DEG)).toBe(0);
    const mid = trailingDuty((DIRECT_THRUST_BAND + DIRECT_BURN_GATE) / 2);
    expect(mid).toBeCloseTo(0.5, 9);
  });

  it('differential burn: ~10° off and still, the leading engine always fires and the trailing one joins part-time', () => {
    const l = new DirectSteering();
    const frames = Array.from({ length: 60 }, () => l.apply({ ...emptyFrame(), steer: dirAt(30) }, { mode: 'lander', angle: 20 * DEG, angularVel: 0 }));
    expect(frames.every((f) => f.engineLeft)).toBe(true); // clockwise turn toward +30°: left engine leads
    const both = frames.filter((f) => f.engineLeft && f.engineRight).length / frames.length;
    const expected = trailingDuty(10 * DEG);
    expect(both).toBeGreaterThan(expected - 0.05);
    expect(both).toBeLessThan(expected + 0.05);
  });

  it('no both-engine thrust far off-axis: across a sweep of real turns, both engines fire only within the gate of the target', async () => {
    for (const deg of [45, -60, 80, 135, -150]) {
      const r = await rig('lander');
      r.hold(dirAt(deg), 180);
      const top = Math.abs(deg) > 100;
      const target = top ? wrapAngle(deg * DEG - Math.PI) : compressTilt(deg * DEG);
      let prev = r.states[0]!;
      for (let i = 1; i < r.frames.length; i++) {
        const f = r.frames[i]!;
        if ((f.engineLeft && f.engineRight) || (f.topLeft && f.topRight)) expect(Math.abs(wrapAngle(prev.angle - target)), `${deg}° tick ${i}`).toBeLessThanOrEqual(DIRECT_BURN_GATE + 1e-9);
        prev = r.states[i]!;
      }
    }
  });

  it('a held 45° command delivers most of both-engine thrust quickly and climbs while pushing sideways', async () => {
    const r = await rig('lander');
    r.hold(dirAt(45), 60);
    const firstSecond = r.frames.reduce((a, f) => a + (+f.engineLeft + +f.engineRight) / 2, 0) / 60;
    expect(firstSecond).toBeGreaterThan(0.65);
    const s1 = r.state();
    r.hold(dirAt(45), 120);
    const s3 = r.state();
    // after settling: both engines nearly every tick, and it climbs (y-down: vy decreases) while accelerating right
    const late = r.frames.slice(120).filter((f) => f.engineLeft && f.engineRight).length / 60;
    expect(late).toBeGreaterThan(0.9);
    expect(s3.vel.y).toBeLessThan(s1.vel.y);
    expect(s3.vel.x).toBeGreaterThan(s1.vel.x);
  });

  it('straight up is decisively stronger than gravity: main engines run at DIRECT_LANDER_THRUST_SCALE (≥ 1.2 g net at G 3.2)', async () => {
    expect(DIRECT_LANDER_THRUST_SCALE).toBeGreaterThan(1);
    const r = await rig('lander');
    r.hold(dirAt(0), 60);
    expect(r.frames.every((f) => f.engineScale === DIRECT_LANDER_THRUST_SCALE)).toBe(true);
    const a = r.states[59]!;
    const b = r.states[29]!;
    const netUp = -(a.vel.y - b.vel.y) / 0.5; // px/s², y-down
    // gravity G m/s² at 30 px/m: T/W both = 2 × 0.9 × scale -> net (2 × 0.9 × scale - 1) g
    expect(netUp / (G * 30)).toBeGreaterThan(1.15);
  });

  it('a near-horizontal finger (80°) roughly holds altitude instead of sinking', async () => {
    const r = await rig('lander');
    r.hold(dirAt(80), 60);
    const s1 = r.state();
    r.hold(dirAt(80), 120);
    const s3 = r.state();
    const vertAccel = (s3.vel.y - s1.vel.y) / 2 / (G * 30); // in g, + = sinking
    expect(Math.abs(vertAccel)).toBeLessThan(0.2);
    expect(s3.vel.x - s1.vel.x).toBeGreaterThan(0);
  });

  it('ENGINES scheme thrust is untouched: frames without engineScale fly exactly as before', async () => {
    const run = async (scale?: number) => {
      const physics = await PhysicsWorld.create({ gravity: { x: 0, y: G }, hitSpeedThreshold: 0.5 });
      cleanup.push(() => physics.destroy());
      const v = createVessel('lander', physics, { pos: { x: 0, y: 0 } }, () => {}, { tuning: resolveTuning(), refGravity: G, harpoonGuns: 1 });
      for (let i = 0; i < 60; i++) {
        v.applyInput({ ...emptyFrame(), thrust: true, ...(scale === undefined ? {} : { engineScale: scale }) }, FIXED_DT);
        physics.step(FIXED_DT);
      }
      return v.state().vel.y;
    };
    const plain = await run();
    expect(await run(1)).toBe(plain);
    expect(await run(DIRECT_LANDER_THRUST_SCALE)).toBeLessThan(plain); // faster climb (y-down)
    expect(resolveTuning().lander.thrust).toBeLessThan(1); // one engine alone still must not hover
  });
});

describe('DIRECT steering: downward commands use the top thrusters (no flip)', () => {
  it.each([180, 135, -150, 110])('a %i° command fires only the top thrusters and keeps the lander the right way up', async (deg) => {
    const r = await rig('lander');
    const end = r.hold(dirAt(deg), 180);
    expect(r.layer.engineSet).toBe('top');
    expect(r.frames.every((f) => !f.engineLeft && !f.engineRight && !f.thrust)).toBe(true);
    expect(r.frames.some((f) => f.topLeft || f.topRight)).toBe(true);
    // never turned over: |angle| stays under 90° the whole way (target = command - 180°)
    expect(Math.max(...r.states.map((s) => Math.abs(s.angle))) / DEG).toBeLessThan(90);
    expect(Math.abs(wrapAngle(end.angle - (deg - 180) * DEG)) / DEG).toBeLessThan(5);
    expect(end.vel.y).toBeGreaterThan(0); // pushed downward
  });

  it('straight down fires both top thrusters every tick, upright', async () => {
    const r = await rig('lander');
    r.hold(dirAt(180), 30);
    expect(r.frames.every((f) => f.topLeft && f.topRight)).toBe(true);
    expect(Math.abs(r.state().angle)).toBeLessThan(1e-3);
  });

  it('crossover at 100° from up, decided fresh per press, with hysteresis while held', () => {
    const upright = { mode: 'lander' as const, angle: 0, angularVel: 0 };
    const at = (layer: DirectSteering, deg: number) => layer.apply({ ...emptyFrame(), steer: dirAt(deg) }, upright);
    expect(DIRECT_TOP_CROSSOVER / DEG).toBeCloseTo(100);
    const l = new DirectSteering();
    at(l, 98);
    expect(l.engineSet).toBe('main');
    at(l, 104); // inside the band: stays on the main engines
    expect(l.engineSet).toBe('main');
    at(l, 112);
    expect(l.engineSet).toBe('top');
    at(l, 96); // inside the band: stays on the top thrusters
    expect(l.engineSet).toBe('top');
    at(l, 90);
    expect(l.engineSet).toBe('main');
    // a fresh press at 104° (no held set) goes straight to the top thrusters
    l.apply(emptyFrame(), upright);
    expect(l.engineSet).toBeNull();
    at(l, 104);
    expect(l.engineSet).toBe('top');
  });

  it('an upward command always uses the main engines, righting a tumbled lander (so it can land)', async () => {
    const r = await rig('lander', { angle: 150 * DEG });
    const end = r.hold(dirAt(0), 240);
    expect(r.layer.engineSet).toBe('main');
    expect(Math.abs(end.angle) / DEG).toBeLessThan(5);
  });
});

describe('DIRECT steering: controlled-state gates and crossover edges', () => {
  const lander = (angleDeg: number, angularVel: number) => ({ mode: 'lander' as const, angle: angleDeg * DEG, angularVel });
  const apply = (l: DirectSteering, cmdDeg: number, angleDeg = 0, w = 0) => l.apply({ ...emptyFrame(), steer: dirAt(cmdDeg) }, lander(angleDeg, w));

  it('mid-turn 30° off target with ω toward it (switching signal ≈ 0): both engines must NOT fire', () => {
    const e = 30 * DEG;
    const w = e / DIRECT_LEAD_SEC; // ≈ 2.38 rad/s toward the target: s = e - τω ≈ 0
    expect(Math.abs(e - DIRECT_LEAD_SEC * w)).toBeLessThan(1e-9);
    for (const nudge of [0, 0.01, -0.01]) {
      const f = apply(new DirectSteering(), 30, 0, w + nudge);
      expect(f.engineLeft && f.engineRight, `nudge ${nudge}`).toBe(false);
      expect(f.engineLeft || f.engineRight).toBe(true); // still turning / braking with one engine
    }
    // mirrored: counter-clockwise turn
    const m = apply(new DirectSteering(), -30, 0, -w);
    expect(m.engineLeft && m.engineRight).toBe(false);
    // top-thruster set: 150° command -> target body angle -30°, turning toward it
    const t = apply(new DirectSteering(), 150, 0, -w);
    expect(t.topLeft && t.topRight).toBe(false);
    expect(t.topLeft || t.topRight).toBe(true);
    // on target and still: both fire (the thrust case)
    const on = apply(new DirectSteering(), 30, 30, 0);
    expect(on.engineLeft && on.engineRight).toBe(true);
    const onTop = apply(new DirectSteering(), 150, -30, 0);
    expect(onTop.topLeft && onTop.topRight).toBe(true);
    // on target but spinning through it: brake with one engine, no thrust yet
    const spin = apply(new DirectSteering(), 30, 30, 1);
    expect(spin.engineLeft && spin.engineRight).toBe(false);
  });

  it('crossover: exactly 100° (either side) is main on a fresh press, just past it is top', () => {
    for (const sign of [1, -1]) {
      const at = (deg: number) => {
        const l = new DirectSteering();
        apply(l, sign * deg);
        return l.engineSet;
      };
      expect(at(100), `${sign * 100}°`).toBe('main');
      expect(at(100.01), `${sign * 100.01}°`).toBe('top');
      expect(at(99.99)).toBe('main');
    }
  });

  it('hysteresis edges while held: main switches only past 108°, top returns only at 92° or less (both sides)', () => {
    const X = DIRECT_TOP_CROSSOVER / DEG;
    const H = DIRECT_CROSSOVER_HYSTERESIS / DEG;
    expect([X - H, X + H]).toEqual([92, 108]);
    for (const sign of [1, -1]) {
      const held = (first: number, next: number) => {
        const l = new DirectSteering();
        apply(l, sign * first);
        apply(l, sign * next);
        return l.engineSet;
      };
      expect(held(90, 108)).toBe('main'); // exactly on the upper edge: stays main
      expect(held(90, 108.01)).toBe('top');
      expect(held(120, 92)).toBe('main'); // exactly on the lower edge: back to main
      expect(held(120, 92.01)).toBe('top');
      expect(held(120, 100)).toBe('top'); // inside the band: keeps the held set
      expect(held(90, 100)).toBe('main');
    }
  });

  it('wrap-around through straight down keeps the top set and a continuous target', () => {
    const l = new DirectSteering();
    const seq = [170, 179.9, 180, -179.9, -170, -150];
    for (const deg of seq) {
      apply(l, deg);
      expect(l.engineSet, `${deg}°`).toBe('top');
    }
    // across ±180 the target body angle (command - 180°) moves smoothly through 0: upright + still fires both
    for (const deg of [179.9, -179.9]) {
      const f = apply(new DirectSteering(), deg, 0, 0);
      expect(f.topLeft && f.topRight, `${deg}°`).toBe(true);
    }
    // held top across the wrap, then back up to the lower edge from the negative side
    apply(l, -92.01);
    expect(l.engineSet).toBe('top');
    apply(l, -92);
    expect(l.engineSet).toBe('main');
  });
});

describe('DIRECT steering: release, pass-through, CSM', () => {
  it('releasing turns every engine off (pure coast: no hover, no auto-upright)', async () => {
    const r = await rig('lander');
    r.hold(dirAt(60), 90);
    const tilted = r.state().angle;
    const vel = r.state().vel;
    const n = r.frames.length;
    r.hold(null, 60);
    const after = r.frames.slice(n);
    expect(after.every((f) => flightOn(f).length === 0)).toBe(true);
    expect(r.states.slice(n).every((s) => !s.engines.main && !s.engines.left && !s.engines.right)).toBe(true);
    expect(r.layer.engineSet).toBeNull();
    // coasting ballistically: gravity only, still tilted (nothing rights it)
    expect(r.state().vel.y).toBeGreaterThan(vel.y);
    expect(Math.abs(r.state().angle - tilted)).toBeLessThan(10 * DEG); // attitude left alone: no auto-upright
  });

  it('a steer owns flight: key flags under a held finger are overridden; pause / restart never touched', () => {
    const l = new DirectSteering();
    const f = l.apply({ ...emptyFrame(), steer: dirAt(0), rotateCW: true, topRight: true, pause: true, restart: true }, { mode: 'lander', angle: 0, angularVel: 0 });
    expect(flightOn(f)).toEqual(['engineLeft', 'engineRight']);
    expect(f.pause && f.restart).toBe(true);
    // no steer, no keys: nothing on (coast)
    expect(flightOn(l.apply(emptyFrame(), { mode: 'lander', angle: 0.4, angularVel: 0.1 }))).toEqual([]);
  });

  it('harpoon modes pass through untouched (their normal controls stay)', () => {
    const l = new DirectSteering();
    for (const mode of ['harpoon', 'harpoonThrust'] as const) {
      const f = { ...emptyFrame(), thrust: true, rotateCW: true, fire: true, steer: dirAt(45) };
      const before = JSON.stringify(f);
      expect(JSON.stringify(l.apply(f, { mode, angle: 0, angularVel: 0 }))).toBe(before);
    }
  });

  it('CSM: rotates toward the command and burns only once pointed there', async () => {
    const r = await rig('csm');
    const end = r.hold(dirAt(70), 180);
    expect(Math.abs(wrapAngle(end.angle - 70 * DEG)) / DEG).toBeLessThan(5);
    expect(r.frames[0]!.thrust).toBe(false); // 70° off at first: turn, don't burn the wrong way
    expect(r.frames[0]!.rotateCW).toBe(true);
    expect(r.frames.slice(-30).every((f) => f.thrust)).toBe(true);
    expect(r.frames.every((f) => !f.engineLeft && !f.engineRight && !f.topLeft && !f.topRight)).toBe(true);
  });

  it('is deterministic: the same command sequence gives the same frames', async () => {
    const run = async () => {
      const r = await rig('lander');
      r.hold(dirAt(40), 50);
      r.hold(null, 10);
      r.hold(dirAt(170), 50);
      return JSON.stringify(r.frames.map(flightOn));
    };
    expect(await run()).toBe(await run());
  });

  it('commandAngle: clockwise from up, y-down world', () => {
    expect(commandAngle({ x: 0, y: -1 })).toBeCloseTo(0);
    expect(commandAngle({ x: 1, y: 0 })).toBeCloseTo(Math.PI / 2);
    expect(commandAngle({ x: -1, y: 0 })).toBeCloseTo(-Math.PI / 2);
    expect(Math.abs(commandAngle({ x: 0, y: 1 }))).toBeCloseTo(Math.PI);
  });
});

describe('DIRECT steering: input sources', () => {
  const ctx = (mode: VesselMode, vessel = { x: 100, y: 100 }): InputSampleContext => ({ mode, vesselWorldPos: vessel, clientToWorld: (x, y) => ({ x: x * 2, y: y * 2 }) });

  it('keyboard (lander): ← / A rotate CCW, → / D rotate CW, ↑ / W / Space thrust, ↓ / S both top thrusters; no steer; pause / restart kept', () => {
    const kb = new KeyboardSource(null);
    kb.setDirectSteering(true);
    kb.setSwapEngines(true); // does not apply to DIRECT
    const m = new InputMapper();
    m.add(kb);
    const press = (codes: string[], mode: VesselMode = 'lander') => {
      codes.forEach((c) => kb.keyDown(c));
      const f = m.sample(ctx(mode));
      codes.forEach((c) => kb.keyUp(c));
      m.sample(ctx(mode)); // flush latched presses
      return f;
    };
    for (const c of ['KeyA', 'ArrowLeft']) expect(flightOn(press([c])), c).toEqual(['rotateCCW']);
    for (const c of ['KeyD', 'ArrowRight']) expect(flightOn(press([c])), c).toEqual(['rotateCW']);
    for (const c of ['KeyW', 'ArrowUp', 'Space']) expect(flightOn(press([c])), c).toEqual(['thrust']);
    for (const c of ['KeyS', 'ArrowDown']) expect(flightOn(press([c])), c).toEqual(['topLeft', 'topRight']);
    for (const c of ['KeyJ', 'KeyK', 'KeyL', 'KeyQ', 'KeyE', 'KeyU', 'KeyO']) expect(flightOn(press([c])), c).toEqual([]);
    expect(press(['KeyW', 'KeyD']).steer).toEqual({ x: 0, y: 0 }); // keys never steer by direction
    expect(press(['Escape']).pause).toBe(true);
    expect(press(['Backspace']).restart).toBe(true);
    // harpoon modes keep their bindings
    const h = press(['Space', 'KeyW'], 'harpoon');
    expect(h.fire && h.reelIn).toBe(true);
    // a tap shorter than a tick still turns one tick
    kb.keyDown('KeyD');
    kb.keyUp('KeyD');
    expect(m.sample(ctx('lander')).rotateCW).toBe(true);
    expect(m.sample(ctx('lander')).rotateCW).toBe(false);
  });

  it('keyboard (CSM): DIRECT changes nothing - every key gives the classic ENGINE frame, and the layer passes it through', () => {
    const sample = (direct: boolean, codes: string[]) => {
      const kb = new KeyboardSource(null);
      kb.setDirectSteering(direct);
      const m = new InputMapper();
      m.add(kb);
      codes.forEach((c) => kb.keyDown(c));
      const f = m.sample(ctx('csm'));
      return direct ? new DirectSteering().apply(f, { mode: 'csm', angle: 0.3, angularVel: -0.5 }) : f;
    };
    const all = ['KeyW', 'ArrowUp', 'Space', 'KeyA', 'ArrowLeft', 'KeyD', 'ArrowRight', 'KeyS', 'ArrowDown', 'KeyQ', 'KeyE', 'KeyJ', 'KeyL', 'Escape', 'Backspace'];
    for (const c of all) expect(sample(true, [c]), c).toEqual(sample(false, [c]));
    expect(sample(true, ['KeyW', 'KeyD']), 'W+D').toEqual(sample(false, ['KeyW', 'KeyD']));
    expect(flightOn(sample(true, ['KeyW', 'KeyA']))).toEqual(['thrust', 'rotateCCW']);
  });

  it('keyboard: ENGINES scheme (default) is unchanged and reports no steer', () => {
    const kb = new KeyboardSource(null);
    const m = new InputMapper();
    m.add(kb);
    kb.keyDown('KeyW');
    const f = m.sample(ctx('lander'));
    expect(f.thrust).toBe(true);
    expect(f.steer).toEqual({ x: 0, y: 0 });
  });

  it('pointer: a finger held on the canvas steers vessel -> finger, follows it, and stops on release', () => {
    const p = new PointerSource(null);
    p.setDirectSteering(true);
    const m = new InputMapper();
    m.add(p);
    // vessel at world (100,100); clientToWorld doubles, so client (80,50) = world (160,100): straight right
    p.simulate({ type: 'down', pointerType: 'touch', x: 80, y: 50 });
    expect(m.sample(ctx('lander')).steer).toEqual({ x: 1, y: 0 });
    p.simulate({ type: 'move', pointerType: 'touch', x: 50, y: 20 }); // world (100,40): straight up
    const up = m.sample(ctx('lander'));
    expect(up.steer).toEqual({ x: 0, y: -1 });
    expect(up.aim).toEqual({ x: 0, y: 0 }); // no drag-aim in DIRECT
    p.simulate({ type: 'up', pointerType: 'touch', x: 50, y: 20 });
    expect(m.sample(ctx('lander')).steer).toEqual({ x: 0, y: 0 });
    // a tap within one tick still steers once
    p.simulate({ type: 'down', pointerType: 'touch', x: 50, y: 80 });
    p.simulate({ type: 'up', pointerType: 'touch', x: 50, y: 80 });
    expect(m.sample(ctx('lander')).steer).toEqual({ x: 0, y: 1 });
    expect(m.sample(ctx('lander')).steer).toEqual({ x: 0, y: 0 });
    // clear() (pause / blur) drops a held finger
    p.simulate({ type: 'down', pointerType: 'touch', x: 80, y: 50 });
    m.clear();
    expect(m.sample(ctx('lander')).steer).toEqual({ x: 0, y: 0 });
  });

  it('pointer: the held left mouse button steers too; hovering alone does not', () => {
    const p = new PointerSource(null);
    p.setDirectSteering(true);
    const m = new InputMapper();
    m.add(p);
    p.simulate({ type: 'move', pointerType: 'mouse', x: 20, y: 50 });
    expect(m.sample(ctx('lander')).steer).toEqual({ x: 0, y: 0 });
    p.simulate({ type: 'down', pointerType: 'mouse', x: 20, y: 50 });
    expect(m.sample(ctx('lander')).steer).toEqual({ x: -1, y: 0 });
    p.simulate({ type: 'up', pointerType: 'mouse', x: 20, y: 50 });
    expect(m.sample(ctx('lander')).steer).toEqual({ x: 0, y: 0 });
  });

  it('pointer: harpoon modes keep drag-aim (no steer)', () => {
    const p = new PointerSource(null);
    p.setDirectSteering(true);
    const m = new InputMapper();
    m.add(p);
    p.simulate({ type: 'down', pointerType: 'touch', x: 50, y: 50 });
    p.simulate({ type: 'move', pointerType: 'touch', x: 80, y: 50 });
    const f = m.sample(ctx('harpoon'));
    expect(f.steer).toEqual({ x: 0, y: 0 });
    expect(f.aim).toEqual({ x: 1, y: 0 });
  });

  it('a steer is "first input" for the level-start help card', () => {
    expect(frameHasInput({ ...emptyFrame(), steer: { x: 0, y: -1 } })).toBe(true);
  });
});

describe('DIRECT steering: UI, touch layout, setting', () => {
  it('touch layout: lander / csm keep only pause + restart (taps there never steer); harpoon modes unchanged', () => {
    for (const mode of ['lander', 'csm'] as const) {
      const l = touchLayout(mode, 844, 390, { direct: true });
      expect(l.buttons.map((b) => b.control).sort()).toEqual(['pause', 'restart']);
      expect(l.aimZone).toBeNull();
    }
    for (const mode of ['harpoon', 'harpoonThrust'] as const) expect(touchLayout(mode, 844, 390, { direct: true })).toEqual(touchLayout(mode, 844, 390));
  });

  it('pause menu STEERING item toggles and reflects the setting (default ENGINES)', () => {
    const c = (p: Partial<ScreenContext> = {}): ScreenContext => ({ levels: {}, save: null, showDebug: false, touchPref: 'auto', lastHull: null, ...p });
    const label = (ctx: ScreenContext) => screenModel({ id: 'paused', levelId: 'testpad' }, ctx).items.find((i) => i.id === 'steering')!.label;
    expect(label(c())).toBe('STEERING: ENGINES');
    expect(label(c({ steering: 'engines' }))).toBe('STEERING: ENGINES');
    expect(label(c({ steering: 'direct' }))).toBe('STEERING: DIRECT');
    expect(itemAction({ id: 'paused', levelId: 'testpad' }, 'steering', c())).toEqual({ ui: 'toggleSteering' });
  });

  it('Settings.steering defaults to engines, old / bad saves read engines, direct round-trips', () => {
    expect(DEFAULT_SETTINGS.steering).toBe('engines');
    expect(parseSave({ settings: { swapEngineButtons: false } })!.settings.steering).toBe('engines');
    expect(parseSave({ settings: { steering: 'wheel' } })!.settings.steering).toBe('engines');
    expect(parseSave({ settings: { steering: 'direct' } })!.settings.steering).toBe('direct');
  });

  it('help card: DIRECT lines for lander (keys + touch) and csm (touch only); swap does not apply; harpoon cards unchanged', () => {
    const keys = helpCard('lander', false, true, true, true);
    expect(keys.title).toBe('LANDER CONTROLS (DIRECT)');
    const k = keys.lines.join(' ');
    expect(k).toMatch(/A \/ ←\s+ROTATE LEFT/);
    expect(k).toMatch(/D \/ →\s+ROTATE RIGHT/);
    expect(k).toMatch(/W \/ ↑ \/ SPACE\s+THRUST/);
    expect(k).toMatch(/S \/ ↓\s+TOP THRUSTERS/);
    expect(k).not.toMatch(/ENGINE \(TILT|THRUST THAT WAY/);
    // Descent / CSM on a keyboard: the classic ENGINE card in both settings
    expect(helpCard('csm', false, true, false, true)).toEqual(helpCard('csm', false, true, false, false));
    expect(helpCard('csm', false, true, false, true).title).toBe('CSM CONTROLS');
    const touch = helpCard('lander', true, true, false, true);
    expect(touch.lines.join(' ')).toMatch(/HOLD ANYWHERE: THRUST TOWARD FINGER/);
    expect(touch.lines.at(-1)).toMatch(/PAUSE/);
    expect(helpCard('csm', true, true, false, true).lines.join(' ')).toMatch(/TOWARD FINGER/);
    expect(helpCard('harpoon', true, true, false, true)).toEqual(helpCard('harpoon', true, true, false, false));
  });
});

describe('DIRECT keyboard: lander rotate + thrust (real physics)', () => {
  it.each([1, -1])('a held rotate key (%i) spins up fast to the turn rate on an RCS couple that costs ~no altitude', async (dir) => {
    const r = await rig('lander');
    const coast = await rig('lander');
    r.keys(dir > 0 ? { rotateCW: true } : { rotateCCW: true }, 30); // 0.5 s
    coast.keys({}, 30);
    const st = r.state();
    // crisp: at the rate within 0.3 s, held there (bang-bang inside the band)
    const at = r.states.findIndex((x) => Math.abs(x.angularVel - dir * DIRECT_KEY_TURN_RATE) <= DIRECT_KEY_RATE_BAND + 1e-6);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(18);
    for (const x of r.states.slice(at + 1)) expect(Math.abs(x.angularVel - dir * DIRECT_KEY_TURN_RATE)).toBeLessThan(DIRECT_KEY_RATE_BAND + 0.15);
    expect((dir * st.angle) / DEG).toBeGreaterThan(35);
    // the couple: one main (scaled down) + the opposite top thruster, never both mains
    const cw = dir > 0;
    const pulses = r.frames.filter((f) => flightOn(f).length > 0);
    expect(pulses.length).toBeGreaterThan(5);
    for (const f of pulses) {
      expect(flightOn(f)).toEqual(cw ? ['engineLeft', 'topRight'] : ['engineRight', 'topLeft']);
      expect(f.engineScale).toBe(landerCoupleScale(resolveTuning().lander)); // ≈ DIRECT_LANDER_COUPLE_SCALE
    }
    // altitude: within 2 px of a pure coast after half a second of turning
    expect(Math.abs(st.pos.y - coast.state().pos.y)).toBeLessThan(2);
  });

  it('releasing the key stops the spin it made, then everything is off and the attitude is left alone (no auto-upright)', async () => {
    const r = await rig('lander');
    r.keys({ rotateCW: true }, 30);
    const n = r.frames.length;
    r.keys({}, 90);
    const after = r.frames.slice(n);
    // braking pulses first (the opposite couple), then nothing at all
    const firstOff = after.findIndex((f) => flightOn(f).length === 0);
    expect(firstOff).toBeGreaterThan(0);
    expect(firstOff).toBeLessThan(20);
    for (const f of after.slice(0, firstOff)) expect(flightOn(f)).toEqual(['engineRight', 'topLeft']);
    expect(after.slice(firstOff).every((f) => flightOn(f).length === 0)).toBe(true);
    const end = r.state();
    expect(Math.abs(end.angularVel)).toBeLessThan(DIRECT_KEY_STOP_BAND);
    expect(end.angle / DEG).toBeGreaterThan(40); // stays turned: nothing rights it
    const settled = r.states[n + firstOff]!.angle;
    expect(Math.abs(end.angle - settled) / DEG).toBeLessThan(4);
  });

  it('a spin the key did not make is never braked (no input = no power)', () => {
    const l = new DirectSteering();
    for (let i = 0; i < 30; i++) expect(flightOn(l.apply(emptyFrame(), { mode: 'lander', angle: 1, angularVel: 3 }))).toEqual([]);
  });

  it.each([
    ['tap D while spinning +3 (the key brakes it to the rate)', 3, { rotateCW: true }],
    ['tap A while spinning +3 (the key brakes it)', 3, { rotateCCW: true }],
    ['tap D while spinning -3 (the key brakes it)', -3, { rotateCW: true }],
    ['tap A while spinning -3', -3, { rotateCCW: true }],
  ] as const)('the release brake removes at most what the key added: %s', async (_n, w0, key) => {
    // the hull's angular damping slows any spin: compare with the same spin left alone
    const r = await rig('lander');
    const alone = await rig('lander');
    r.spin(w0);
    alone.spin(w0);
    r.keys(key, 1); // one tick
    alone.keys({}, 1);
    const added = r.state().angularVel - alone.state().angularVel; // the key's own contribution
    const n = r.frames.length;
    r.keys({}, 60);
    alone.keys({}, 60);
    // released: the brake never takes away more than the key added (here every tap moved the spin
    // TOWARD zero - the key's rate is below 3 - so there is nothing to take back: no brake at all)
    expect(Math.sign(added)).toBe(-Math.sign(w0));
    expect(r.frames.slice(n).every((f) => flightOn(f).length === 0)).toBe(true);
    const diff = r.state().angularVel - alone.state().angularVel;
    expect(Math.abs(diff)).toBeLessThanOrEqual(Math.abs(added) + 1e-6);
    expect(Math.sign(diff)).toBe(Math.sign(added)); // the spin it took off stays off; nothing re-added
  });

  it('a tap that added spin is braked back to the spin it found, not to zero', async () => {
    const r = await rig('lander');
    const alone = await rig('lander');
    r.spin(1);
    alone.spin(1);
    r.keys({ rotateCW: true }, 6); // spins up toward the 2.2 rate
    alone.keys({}, 6);
    expect(r.state().angularVel - alone.state().angularVel).toBeGreaterThan(0.3);
    const n = r.frames.length;
    r.keys({}, 60);
    alone.keys({}, 60);
    // braked (the opposite couple) only until the key's extra spin is gone - never through the spin it found
    const after = r.frames.slice(n);
    expect(after.some((f) => f.engineRight && f.topLeft)).toBe(true);
    expect(after.every((f) => !f.engineLeft && !f.topRight)).toBe(true);
    expect(r.state().angularVel).toBeGreaterThan(alone.state().angularVel - DIRECT_KEY_STOP_BAND - 0.05);
  });

  it('L7: the couple scale comes from the level tuning (hangarRun: lighter mains) and a pure turn still costs ~no altitude', async () => {
    const t = resolveTuning(getLevel('hangarRun')!.physicsOverrides);
    expect(t.lander.thrust).not.toBe(resolveTuning().lander.thrust);
    const scale = landerCoupleScale(t.lander);
    expect(scale).toBeCloseTo(t.lander.topThrust / t.lander.thrust, 9);
    expect(scale).not.toBeCloseTo(DIRECT_LANDER_COUPLE_SCALE, 3);
    expect(landerCoupleScale(resolveTuning().lander)).toBeCloseTo(DIRECT_LANDER_COUPLE_SCALE, 2);
    const r = await rig('lander', {}, t);
    const coast = await rig('lander', {}, t);
    r.keys({ rotateCW: true }, 30);
    coast.keys({}, 30);
    expect(r.frames.filter((f) => flightOn(f).length > 0).every((f) => f.engineScale === scale)).toBe(true);
    expect(r.state().angle / DEG).toBeGreaterThan(35);
    expect(Math.abs(r.state().pos.y - coast.state().pos.y)).toBeLessThan(2);
  });

  it('thrust alone = both mains at DIRECT_LANDER_THRUST_SCALE (climbs); S / ↓ alone = both top thrusters (pushes down); ↑ wins over ↓', async () => {
    const up = await rig('lander');
    up.keys({ thrust: true }, 60);
    expect(up.frames.every((f) => f.engineLeft && f.engineRight && !f.topLeft && !f.topRight && f.engineScale === DIRECT_LANDER_THRUST_SCALE)).toBe(true);
    expect(up.state().vel.y).toBeLessThan(0);
    const down = await rig('lander');
    const coast = await rig('lander');
    down.keys({ topLeft: true, topRight: true }, 30);
    coast.keys({}, 30);
    expect(down.frames.every((f) => flightOn(f).join() === 'topLeft,topRight')).toBe(true);
    expect(down.state().vel.y).toBeGreaterThan(coast.state().vel.y + 10);
    expect(Math.abs(down.state().angle)).toBeLessThan(1e-3);
    const both = new DirectSteering().apply({ ...emptyFrame(), thrust: true, topLeft: true, topRight: true }, { mode: 'lander', angle: 0, angularVel: 0 });
    expect(flightOn(both)).toEqual(['engineLeft', 'engineRight']);
  });

  it('thrust + rotate: only the leading main engine while the turn rate is short, both once at rate; climbs while turning', async () => {
    const r = await rig('lander');
    r.keys({ thrust: true, rotateCCW: true }, 45);
    const f = r.frames;
    expect(flightOn(f[0]!)).toEqual(['engineRight']); // counter-clockwise: right engine leads
    expect(f.some((x) => x.engineLeft && x.engineRight)).toBe(true);
    expect(f.every((x) => !x.engineLeft || x.engineRight)).toBe(true); // never the clockwise-only engine
    expect(f.every((x) => !x.topLeft && !x.topRight)).toBe(true);
    expect(r.state().angle).toBeLessThan(-30 * DEG);
    expect(r.state().vel.x).toBeLessThan(0); // tilted left and burning: drifts left
  });

  it('↓ + rotate: only the leading top thruster while the rate is short', () => {
    const f = new DirectSteering().apply({ ...emptyFrame(), topLeft: true, topRight: true, rotateCW: true }, { mode: 'lander', angle: 0, angularVel: 0 });
    expect(flightOn(f)).toEqual(['topRight']); // top-right pushes the right side down = clockwise
  });
});

describe('Descent on a keyboard: the ENGINE scheme in both steering settings', () => {
  it('the same key script flies the Descent CSM identically with DIRECT on or off', async () => {
    const script = (t: number): string[] => (t < 40 ? ['KeyW'] : t < 70 ? ['KeyD'] : t < 90 ? ['KeyW', 'ArrowLeft'] : t < 120 ? [] : ['ArrowUp', 'KeyA']);
    const fly = async (direct: boolean) => {
      const s = await LevelSession.create(descent);
      s.start();
      expect(s.state.mode).toBe('csm');
      const kb = new KeyboardSource(null);
      kb.setDirectSteering(direct);
      const m = new InputMapper();
      m.add(kb);
      const layer = new DirectSteering();
      let held: string[] = [];
      const trace: string[] = [];
      for (let t = 0; t < 150; t++) {
        const want = script(t);
        held.filter((c) => !want.includes(c)).forEach((c) => kb.keyUp(c));
        want.filter((c) => !held.includes(c)).forEach((c) => kb.keyDown(c));
        held = want;
        const f = m.sample({ mode: s.state.mode, vesselWorldPos: s.state.pos, clientToWorld: (x, y) => ({ x, y }) });
        if (direct) layer.apply(f, s.state); // what App.step does under Settings.steering = 'direct'
        s.step(f);
        trace.push(`${flightOn(f).join('+')}@${s.state.pos.x.toFixed(3)},${s.state.pos.y.toFixed(3)},${s.state.angle.toFixed(4)}`);
      }
      s.destroy();
      return trace;
    };
    const engines = await fly(false);
    const direct = await fly(true);
    expect(direct).toEqual(engines);
    expect(engines[10]).toMatch(/^thrust@/);
    expect(engines[50]).toMatch(/^rotateCW@/);
  });
});

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
import { commandAngle, DIRECT_CROSSOVER_HYSTERESIS, DIRECT_LEAD_SEC, DIRECT_TOP_CROSSOVER, DirectSteering, wrapAngle } from '../src/shell/directSteering';
import { emptyFrame, InputMapper, KeyboardSource, PointerSource } from '../src/shell/input';
import { DEFAULT_SETTINGS, parseSave } from '../src/story/save';
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
async function rig(mode: VesselMode, spawn: { angle?: number } = {}) {
  const physics = await PhysicsWorld.create({ gravity: { x: 0, y: G }, hitSpeedThreshold: 0.5 });
  cleanup.push(() => physics.destroy());
  const vessel = createVessel(mode, physics, { pos: { x: 0, y: 0 }, ...spawn }, () => {}, { tuning: resolveTuning(), refGravity: G, harpoonGuns: 1 });
  const layer = new DirectSteering();
  let state: VesselState = vessel.state();
  const frames: InputFrame[] = [];
  const states: VesselState[] = [];
  /** n fixed steps holding steer `d` (null = released). */
  const hold = (d: { x: number; y: number } | null, n: number) => {
    for (let i = 0; i < n; i++) {
      const f = layer.apply({ ...emptyFrame(), steer: d ?? { x: 0, y: 0 } }, state);
      frames.push(f);
      vessel.applyInput(f, FIXED_DT);
      physics.step(FIXED_DT);
      state = vessel.state();
      states.push(state);
    }
    return state;
  };
  return { layer, hold, frames, states, state: () => state };
}

describe('DIRECT steering: angle hold (lander, real physics)', () => {
  it.each([30, 45, -60, 90, -95])('a %i° command pulses the main engines until the lander points there, then burns along it', async (deg) => {
    const r = await rig('lander');
    const end = r.hold(dirAt(deg), 180); // 3 s
    expect(Math.abs(wrapAngle(end.angle - deg * DEG)) / DEG).toBeLessThan(5);
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

  it('with no command the layer overrides stray flight flags (it owns flight) but never pause / restart', () => {
    const l = new DirectSteering();
    const f = l.apply({ ...emptyFrame(), thrust: true, engineLeft: true, topRight: true, rotateCW: true, pause: true, restart: true }, { mode: 'lander', angle: 0, angularVel: 0 });
    expect(flightOn(f)).toEqual([]);
    expect(f.pause && f.restart).toBe(true);
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

  it('keyboard: W A S D / arrows give an 8-way steer; flight keys unbound; pause / restart kept', () => {
    const kb = new KeyboardSource(null);
    kb.setDirectSteering(true);
    const m = new InputMapper();
    m.add(kb);
    const press = (codes: string[], mode: VesselMode = 'lander') => {
      codes.forEach((c) => kb.keyDown(c));
      const f = m.sample(ctx(mode));
      codes.forEach((c) => kb.keyUp(c));
      m.sample(ctx(mode)); // flush latched presses
      return f;
    };
    expect(press(['KeyW']).steer).toEqual({ x: 0, y: -1 });
    expect(press(['ArrowDown']).steer).toEqual({ x: 0, y: 1 });
    const ne = press(['KeyW', 'KeyD']).steer;
    expect(ne.x).toBeCloseTo(Math.SQRT1_2);
    expect(ne.y).toBeCloseTo(-Math.SQRT1_2);
    expect(press(['ArrowLeft', 'KeyS']).steer.x).toBeLessThan(0);
    expect(press(['KeyW', 'KeyS']).steer).toEqual({ x: 0, y: 0 }); // opposite keys cancel: coast
    for (const code of ['Space', 'KeyJ', 'KeyK', 'KeyL', 'KeyQ', 'KeyE', 'KeyA']) expect(flightOn(press([code])), code).toEqual([]);
    expect(press(['Escape']).pause).toBe(true);
    expect(press(['Backspace']).restart).toBe(true);
    expect(press(['KeyA'], 'csm').steer).toEqual({ x: -1, y: 0 });
    // harpoon modes keep their bindings (no steer)
    const h = press(['Space', 'KeyW'], 'harpoon');
    expect(h.fire && h.reelIn).toBe(true);
    expect(h.steer).toEqual({ x: 0, y: 0 });
    // a tap shorter than a tick still steers one tick
    kb.keyDown('KeyD');
    kb.keyUp('KeyD');
    expect(m.sample(ctx('lander')).steer).toEqual({ x: 1, y: 0 });
    expect(m.sample(ctx('lander')).steer).toEqual({ x: 0, y: 0 });
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

  it('help card: DIRECT lines for lander / csm (keys + touch); swap does not apply; harpoon cards unchanged', () => {
    const keys = helpCard('lander', false, true, true, true);
    expect(keys.title).toBe('LANDER CONTROLS (DIRECT)');
    expect(keys.lines.join(' ')).toMatch(/W A S D \/ ARROWS\s+THRUST THAT WAY/);
    expect(keys.lines.join(' ')).toMatch(/TOP THRUSTERS/);
    expect(keys.lines.join(' ')).not.toMatch(/ENGINE \(TILT/);
    const touch = helpCard('lander', true, true, false, true);
    expect(touch.lines.join(' ')).toMatch(/HOLD ANYWHERE: THRUST TOWARD FINGER/);
    expect(touch.lines.at(-1)).toMatch(/PAUSE/);
    expect(helpCard('csm', true, true, false, true).lines.join(' ')).toMatch(/TOWARD FINGER/);
    expect(helpCard('harpoon', true, true, false, true)).toEqual(helpCard('harpoon', true, true, false, false));
  });
});

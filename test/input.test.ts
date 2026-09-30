import { describe, expect, it } from 'vitest';
import type { InputSampleContext, VesselMode } from '../src/contracts';
import { InputMapper, KeyboardSource, PointerSource, TOUCH_AIM_DEADZONE, VirtualControlsSource, emptyFrame } from '../src/shell/input';

function ctx(mode: VesselMode, vessel = { x: 100, y: 100 }): InputSampleContext {
  // identity client -> world mapping for tests
  return { mode, vesselWorldPos: vessel, clientToWorld: (x, y) => ({ x, y }) };
}

function setup() {
  const mapper = new InputMapper();
  const kb = new KeyboardSource(null);
  const touch = new VirtualControlsSource();
  const pointer = new PointerSource(null);
  mapper.add(kb);
  mapper.add(touch);
  mapper.add(pointer);
  return { mapper, kb, touch, pointer };
}

describe('InputMapper + KeyboardSource', () => {
  it('produces an all-false frame with no input', () => {
    const { mapper } = setup();
    expect(mapper.sample(ctx('csm'))).toEqual(emptyFrame());
  });

  it('holds while down', () => {
    const { mapper, kb } = setup();
    kb.keyDown('KeyW');
    expect(mapper.sample(ctx('csm')).thrust).toBe(true);
    expect(mapper.sample(ctx('csm')).thrust).toBe(true);
    kb.keyUp('KeyW');
    expect(mapper.sample(ctx('csm')).thrust).toBe(false);
  });

  it('a tap shorter than one tick still burns exactly one tick', () => {
    const { mapper, kb } = setup();
    kb.keyDown('Space');
    kb.keyUp('Space');
    expect(mapper.sample(ctx('csm')).thrust).toBe(true);
    expect(mapper.sample(ctx('csm')).thrust).toBe(false);
  });

  it('edges fire on exactly one tick (catch-up steps see no edge)', () => {
    const { mapper, kb } = setup();
    kb.keyDown('Escape');
    expect(mapper.sample(ctx('csm')).pause).toBe(true);
    expect(mapper.sample(ctx('csm')).pause).toBe(false); // still held, no new edge
    kb.keyUp('Escape');
    kb.keyDown('Space');
    expect(mapper.sample(ctx('harpoon')).fire).toBe(true);
    expect(mapper.sample(ctx('harpoon')).fire).toBe(false);
  });

  it('Backspace restarts the level in every mode (one-tick edge)', () => {
    const { mapper, kb } = setup();
    for (const mode of ['csm', 'lander', 'harpoon', 'harpoonThrust'] as const) {
      kb.keyDown('Backspace');
      const f = mapper.sample(ctx(mode));
      expect(f.restart, mode).toBe(true);
      expect(f.pause).toBe(false);
      expect(mapper.sample(ctx(mode)).restart).toBe(false); // held: no new edge
      kb.keyUp('Backspace');
    }
  });

  it('swapped engines (Settings.swapEngineButtons) apply to the lander keys only', () => {
    const { mapper, kb } = setup();
    kb.setSwapEngines(true);
    kb.keyDown('ArrowLeft');
    kb.keyDown('KeyQ');
    const l = mapper.sample(ctx('lander'));
    expect(l.engineRight).toBe(true);
    expect(l.engineLeft).toBe(false);
    expect(l.topRight).toBe(true);
    expect(l.topLeft).toBe(false);
    expect(mapper.sample(ctx('csm')).rotateCCW).toBe(true); // CSM rotation is not swapped
    kb.keyUp('ArrowLeft');
    kb.keyUp('KeyQ');
    kb.keyDown('KeyW');
    expect(mapper.sample(ctx('lander')).thrust).toBe(true); // both-engines key is symmetric
    kb.keyUp('KeyW');
    kb.setSwapEngines(false);
    kb.keyDown('ArrowLeft');
    expect(mapper.sample(ctx('lander')).engineLeft).toBe(true);
  });

  it('resolves keys per vessel mode', () => {
    const { mapper, kb } = setup();
    kb.keyDown('ArrowLeft');
    const csm = mapper.sample(ctx('csm'));
    expect(csm.rotateCCW).toBe(true);
    expect(csm.engineLeft).toBe(false);
    const lander = mapper.sample(ctx('lander'));
    expect(lander.engineLeft).toBe(true);
    expect(lander.rotateCCW).toBe(false);
    const harpoon = mapper.sample(ctx('harpoon'));
    expect(harpoon.engineLeft || harpoon.rotateCCW).toBe(false);
    expect(harpoon.aim).toEqual({ x: -1, y: 0 });
  });

  it('lander: J and L drive the two engines independently', () => {
    const { mapper, kb } = setup();
    kb.keyDown('KeyJ');
    let f = mapper.sample(ctx('lander'));
    expect([f.engineLeft, f.engineRight]).toEqual([true, false]);
    kb.keyDown('KeyL');
    f = mapper.sample(ctx('lander'));
    expect([f.engineLeft, f.engineRight]).toEqual([true, true]);
  });

  it('arrow aim is normalised (8-way)', () => {
    const { mapper, kb } = setup();
    kb.keyDown('ArrowUp');
    kb.keyDown('ArrowRight');
    const f = mapper.sample(ctx('harpoonThrust'));
    expect(f.aim.x).toBeCloseTo(Math.SQRT1_2);
    expect(f.aim.y).toBeCloseTo(-Math.SQRT1_2);
    expect(f.aimTarget).toBeNull();
  });

  it('clear() drops held keys and latched presses', () => {
    const { mapper, kb } = setup();
    kb.keyDown('KeyW');
    kb.keyDown('Escape');
    mapper.clear();
    expect(mapper.sample(ctx('csm'))).toEqual(emptyFrame());
  });
});

describe('VirtualControlsSource (on-screen touch controls)', () => {
  it('merges with the keyboard (OR) and taps last one tick', () => {
    const { mapper, kb, touch } = setup();
    touch.press('engineRight');
    kb.keyDown('KeyJ');
    let f = mapper.sample(ctx('lander'));
    expect([f.engineLeft, f.engineRight]).toEqual([true, true]);
    touch.release('engineRight');
    touch.tap('fire');
    f = mapper.sample(ctx('lander'));
    expect(f.engineRight).toBe(false);
    expect(f.fire).toBe(true);
    expect(mapper.sample(ctx('lander')).fire).toBe(false);
  });

  it('supplies aim; the first source with an aim wins', () => {
    const { mapper, kb, touch } = setup();
    touch.setAim({ x: 0, y: 3 });
    expect(mapper.sample(ctx('harpoon')).aim).toEqual({ x: 0, y: 1 });
    kb.keyDown('ArrowLeft'); // keyboard registered first -> wins
    expect(mapper.sample(ctx('harpoon')).aim).toEqual({ x: -1, y: 0 });
  });
});

describe('PointerSource', () => {
  it('mouse hover aims from the vessel at the pointer and sets aimTarget', () => {
    const { mapper, pointer } = setup();
    pointer.simulate({ type: 'move', pointerType: 'mouse', x: 100, y: 200 });
    const f = mapper.sample(ctx('harpoon', { x: 100, y: 100 }));
    expect(f.aim).toEqual({ x: 0, y: 1 });
    expect(f.aimTarget).toEqual({ x: 100, y: 200 });
  });

  it('mouse buttons fire (left) and release (right) as edges', () => {
    const { mapper, pointer } = setup();
    pointer.simulate({ type: 'down', pointerType: 'mouse', button: 0, x: 0, y: 0 });
    expect(mapper.sample(ctx('harpoon')).fire).toBe(true);
    expect(mapper.sample(ctx('harpoon')).fire).toBe(false);
    pointer.simulate({ type: 'down', pointerType: 'mouse', button: 2, x: 0, y: 0 });
    expect(mapper.sample(ctx('harpoon')).release).toBe(true);
  });

  it('touch drag aims along the drag, after a dead zone', () => {
    const { mapper, pointer } = setup();
    pointer.simulate({ type: 'down', pointerType: 'touch', pointerId: 7, x: 50, y: 50 });
    pointer.simulate({ type: 'move', pointerType: 'touch', pointerId: 7, x: 50 + TOUCH_AIM_DEADZONE / 2, y: 50 });
    expect(mapper.sample(ctx('harpoon')).aim).toEqual({ x: 0, y: 0 });
    pointer.simulate({ type: 'move', pointerType: 'touch', pointerId: 7, x: 80, y: 90 });
    const f = mapper.sample(ctx('harpoon'));
    expect(f.aim.x).toBeCloseTo(0.6);
    expect(f.aim.y).toBeCloseTo(0.8);
    expect(f.aimTarget).toBeNull();
    // other fingers do not move the drag
    pointer.simulate({ type: 'move', pointerType: 'touch', pointerId: 8, x: 0, y: 0 });
    expect(mapper.sample(ctx('harpoon')).aim.x).toBeCloseTo(0.6);
    pointer.simulate({ type: 'up', pointerType: 'touch', pointerId: 7, x: 80, y: 90 });
    expect(mapper.sample(ctx('harpoon')).aim).toEqual({ x: 0, y: 0 });
  });
});

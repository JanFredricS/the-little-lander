/**
 * Round 8 audit (M2): a relayout mid-drag (mobile Safari's toolbar resizing the
 * viewport under the left thumb, rotation, a settings rebuild) must not drop
 * the virtual stick. Drives the REAL TouchLayer on a minimal fake DOM.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InputSampleContext } from '../src/contracts';
import { InputMapper, VirtualControlsSource } from '../src/shell/input';
import { TouchLayer } from '../src/ui/touch/touchLayer';
import { FakeDom, type FakeElement } from './support/fakeDom';

const ctx: InputSampleContext = { mode: 'lander', vesselWorldPos: { x: 0, y: 0 }, clientToWorld: (x, y) => ({ x, y }) };

describe('TouchLayer: the stick survives a relayout mid-drag', () => {
  let dom: FakeDom;
  let host: FakeElement;
  let canvas: FakeElement;
  beforeEach(() => {
    dom = new FakeDom();
    vi.stubGlobal('document', dom.document());
    vi.stubGlobal('window', dom.window());
    host = dom.body.appendChild(dom.document().createElement('div'));
    host.clientWidth = 844;
    host.clientHeight = 390;
    canvas = host.appendChild(dom.document().createElement('canvas')); // what a finger off the layer would hit
  });
  afterEach(() => vi.unstubAllGlobals());

  const setup = () => {
    const v = new VirtualControlsSource();
    const m = new InputMapper();
    m.add(v);
    const layer = new TouchLayer(host as unknown as HTMLElement, v);
    layer.setSteering('joystick');
    layer.show('lander');
    const zone = () => (layer.el as unknown as FakeElement).children.find((c) => c.dataset.testid === 'joystick-zone')!;
    return { m, layer, zone };
  };

  it('viewport shrinks under the thumb: same finger keeps steering on the rebuilt stick, capture moves to the new zone', () => {
    const { m, layer, zone } = setup();
    const st = layer.getLayout()!.stick!;
    const z0 = zone();
    dom.pointer('pointerdown', 7, st.cx, st.cy - st.r, z0);
    expect(z0.hasPointerCapture(7)).toBe(true);
    const up = m.sample(ctx).steer;
    expect(up.y).toBeCloseTo(-1);

    host.clientHeight = 330; // toolbar appears
    dom.fireWindow('resize');
    const st2 = layer.getLayout()!.stick!;
    expect(st2.cy).not.toBe(st.cy); // really a new layout
    const z1 = zone();
    expect(z1).not.toBe(z0);
    expect(z0.isConnected).toBe(false);
    expect(z1.hasPointerCapture(7)).toBe(true); // re-captured on the new element
    expect(layer.model.stickHeld()).not.toBeNull();
    // the steer continues on the next tick without any move (re-read against the new stick)
    const still = m.sample(ctx).steer;
    expect(Math.hypot(still.x, still.y)).toBeCloseTo(1);

    // the thumb slides far right, off the zone (it would hit the canvas): capture still routes it to the layer
    dom.pointer('pointermove', 7, st2.cx + 300, st2.cy, canvas);
    for (let i = 0; i < 3; i++) expect(m.sample(ctx).steer).toEqual({ x: 1, y: 0 });
    // a stray lostpointercapture reaching the layer for the re-captured finger does not drop it
    (layer.el as unknown as FakeElement).dispatch({ type: 'lostpointercapture', pointerId: 7, pointerType: 'touch', button: 0, clientX: 0, clientY: 0, target: null, preventDefault() {}, stopPropagation() {} });
    expect(layer.model.stickHeld()).not.toBeNull();
    dom.pointer('pointerup', 7, st2.cx + 300, st2.cy, canvas);
    m.sample(ctx);
    expect(m.sample(ctx).steer).toEqual({ x: 0, y: 0 });
    expect(layer.model.stickHeld()).toBeNull();
    layer.dispose();
  });

  it('an unchanged layout is not rebuilt (same DOM, the drag untouched); a change without a stick releases it', () => {
    const { m, layer, zone } = setup();
    const st = layer.getLayout()!.stick!;
    const z0 = zone();
    dom.pointer('pointerdown', 3, st.cx + st.r, st.cy, z0);
    dom.fireWindow('resize'); // nothing changed
    layer.setSwapEngines(false); // a setting that does not touch the joystick layout
    layer.setSwapEngines(true);
    expect(zone()).toBe(z0);
    expect(z0.hasPointerCapture(3)).toBe(true);
    expect(m.sample(ctx).steer).toEqual({ x: 1, y: 0 });
    layer.setSteering('engines'); // flight buttons now: the stick is gone, the finger is released
    expect(layer.getLayout()!.stick).toBeNull();
    expect(layer.model.stickHeld()).toBeNull();
    m.sample(ctx);
    expect(m.sample(ctx).steer).toEqual({ x: 0, y: 0 });
    layer.dispose();
  });
});

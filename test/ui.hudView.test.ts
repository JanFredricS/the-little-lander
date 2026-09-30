/**
 * HudView redraw economy: the vector layer (panel, bars, badge, arrow) is
 * rebuilt only when something it shows changed. Pixi re-tessellates a
 * Graphics after every clear(), and doing that each frame was the largest
 * per-frame garbage source in gameplay (GC hitches on iPhone).
 * PixelText needs a DOM canvas, so it is stubbed (fixed-width glyphs).
 */

import { describe, expect, it, vi } from 'vitest';
import type { Graphics } from 'pixi.js';
import { HudView } from '../src/ui/hud/hudView';
import { initHud, type HudState } from '../src/ui/hud/hudState';

vi.mock('../src/ui/pixelText', async () => {
  const { Container } = await import('pixi.js');
  // keeps the raster options like the real one: a colour-only change is a (counted) re-raster
  class PixelText extends Container {
    text = '';
    opts: Record<string, unknown>;
    setTexts = 0;
    constructor(text = '', opts: Record<string, unknown> = {}) {
      super();
      this.text = text;
      this.opts = { ...opts };
    }
    setText(text: string, opts?: Record<string, unknown>): this {
      const next = opts ? { ...this.opts, ...opts } : this.opts;
      const optsChanged = Object.keys(next).some((k) => next[k] !== this.opts[k]);
      if (text !== this.text || optsChanged) this.setTexts++;
      this.text = text;
      this.opts = next;
      return this;
    }
    override get width(): number {
      return this.text.length * 6;
    }
    override set width(_v: number) {}
    override get height(): number {
      return 7;
    }
    override set height(_v: number) {}
  }
  return { PixelText };
});

function setup() {
  const hud = new HudView();
  const g = (hud as unknown as { g: Graphics }).g;
  const clear = vi.spyOn(g, 'clear');
  return { hud, clear };
}

const base = (): HudState => ({ ...initHud({ id: 'descent', vesselMode: 'csm', objectives: [{ id: 'exit', kind: 'reachExit', exitId: 'dock' }], startFuel: 1 }) });

describe('HudView redraws', () => {
  it('rebuilds the vector layer only when a shown value changes', () => {
    const { hud, clear } = setup();
    const s = base();
    hud.render(s, 0);
    expect(clear).toHaveBeenCalledTimes(1); // first frame draws
    hud.render(s, 16);
    hud.render({ ...s, time: 5 }, 33);
    expect(clear).toHaveBeenCalledTimes(1); // nothing visible changed
    hud.render({ ...s, fuel: 0.999 }, 50); // < 1 bar pixel
    expect(clear).toHaveBeenCalledTimes(1);
    hud.render({ ...s, fuel: 0.9 }, 66);
    expect(clear).toHaveBeenCalledTimes(2);
    hud.render({ ...s, fuel: 0.9, hull: 0.2 }, 83); // bar length + colour
    expect(clear).toHaveBeenCalledTimes(3);
    hud.leftInset = 40; // touch RESTART button: panel moves
    hud.render({ ...s, fuel: 0.9, hull: 0.2 }, 100);
    expect(clear).toHaveBeenCalledTimes(4);
  });

  it('low fuel blinks at the blink rate (4 Hz), not every frame', () => {
    const { hud, clear } = setup();
    const s = { ...base(), fuel: 0.1 };
    const label = (hud as unknown as { fuelLabel: { setTexts: number; opts: { color?: number } } }).fuelLabel;
    const colors = new Set<number | undefined>();
    const before = label.setTexts;
    for (let t = 0; t < 1000; t += 1000 / 60) {
      hud.render(s, t);
      colors.add(label.opts.color);
    }
    // 250 ms phases in one second: first draw + 3 phase flips
    expect(clear).toHaveBeenCalledTimes(4);
    // the FUEL label blinks by colour only: flips on phase changes, never re-set in between
    expect(colors.size).toBe(2);
    expect(label.setTexts - before).toBe(4);
  });

  it('objective / extras texts are rebuilt only when their inputs change', () => {
    const { hud } = setup();
    const s = { ...base(), orbTarget: 3 };
    const extra = (hud as unknown as { extra: { setTexts: number } }).extra;
    const obj = (hud as unknown as { objTexts: { setTexts: number; text: string }[] }).objTexts[0]!;
    hud.render(s, 0);
    const [e0, o0] = [extra.setTexts, obj.setTexts];
    for (let t = 16; t < 500; t += 16) hud.render({ ...s, time: t / 1000 }, t);
    expect([extra.setTexts, obj.setTexts]).toEqual([e0, o0]);
    hud.render({ ...s, orbs: 1 }, 600);
    expect(extra.setTexts).toBe(e0 + 1);
    expect(obj.text).toContain('REACH THE EXIT');
  });
});

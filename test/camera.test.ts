import { describe, expect, it } from 'vitest';
import { VIEW_HEIGHT, VIEW_WIDTH } from '../src/contracts';
import { Camera } from '../src/shell/camera';
import { clientToView, computeViewScale } from '../src/shell/scaler';

describe('Camera', () => {
  const world = { worldW: 4000, worldH: 1000 };

  it('clamps the view inside the world', () => {
    const c = new Camera(world);
    expect(c.clamp({ x: 0, y: 0 })).toEqual({ x: VIEW_WIDTH / 2, y: VIEW_HEIGHT / 2 });
    expect(c.clamp({ x: 9999, y: 9999 })).toEqual({ x: 4000 - VIEW_WIDTH / 2, y: 1000 - VIEW_HEIGHT / 2 });
    expect(c.clamp({ x: 1234, y: 500 })).toEqual({ x: 1234, y: 500 });
  });

  it('centres a world smaller than the view', () => {
    const c = new Camera({ worldW: 300, worldH: 200 });
    expect(c.clamp({ x: 10, y: 999 })).toEqual({ x: 150, y: 100 });
  });

  it('snaps, then eases toward the target by the smoothing fraction per step', () => {
    const c = new Camera({ ...world, smoothing: 0.5, lookAheadMax: 0 });
    c.snap({ x: 1000, y: 500 });
    expect(c.position).toEqual({ x: 1000, y: 500 });
    c.step({ x: 1100, y: 500 });
    expect(c.position.x).toBeCloseTo(1050);
    c.step({ x: 1100, y: 500 });
    expect(c.position.x).toBeCloseTo(1075);
    for (let i = 0; i < 60; i++) c.step({ x: 1100, y: 500 });
    expect(c.position.x).toBeCloseTo(1100, 3);
  });

  it('looks ahead along velocity, capped, with the bias axis getting the full distance', () => {
    const c = new Camera({ ...world, lookAheadTime: 1, lookAheadMax: 60, bias: 'horizontal' });
    expect(c.targetFor({ x: 1000, y: 500 }, { x: 30, y: 0 })).toEqual({ x: 1030, y: 500 });
    expect(c.targetFor({ x: 1000, y: 500 }, { x: 1000, y: 1000 })).toEqual({ x: 1060, y: 530 });
    const v = new Camera({ ...world, lookAheadTime: 1, lookAheadMax: 60, bias: 'vertical' });
    expect(v.targetFor({ x: 1000, y: 500 }, { x: 1000, y: 1000 })).toEqual({ x: 1030, y: 560 });
  });

  it('interpolates between the last two steps', () => {
    const c = new Camera({ ...world, smoothing: 1, lookAheadMax: 0 });
    c.snap({ x: 1000, y: 500 });
    c.step({ x: 1100, y: 500 });
    expect(c.interpolated(0).x).toBe(1000);
    expect(c.interpolated(0.5).x).toBe(1050);
    expect(c.interpolated(1).x).toBe(1100);
    expect(c.interpolated(7).x).toBe(1100);
  });

  it('holds still without a target and maps view px to world px', () => {
    const c = new Camera({ ...world, smoothing: 1, lookAheadMax: 0 });
    c.snap({ x: 1000.4, y: 500 });
    c.step(null);
    expect(c.position.x).toBeCloseTo(1000.4);
    const o = c.viewOrigin(c.position);
    expect(o).toEqual({ x: Math.round(1000.4 - 320), y: 500 - 180 });
    expect(c.viewToWorld(c.position, { x: 320, y: 180 })).toEqual({ x: o.x + 320, y: o.y + 180 });
  });

  it('writes into caller-owned scratch vectors when given one (render path: no allocation)', () => {
    const c = new Camera({ ...world, smoothing: 1, lookAheadMax: 0 });
    c.snap({ x: 1000, y: 500 });
    c.step({ x: 1100, y: 500 });
    const cam = { x: 0, y: 0 };
    const o = { x: 0, y: 0 };
    expect(c.interpolated(0.5, cam)).toBe(cam);
    expect(cam).toEqual(c.interpolated(0.5));
    expect(c.viewOrigin(cam, o)).toBe(o);
    expect(o).toEqual(c.viewOrigin(cam));
  });
});

describe('computeViewScale', () => {
  it('uses the largest integer device scale that fits (desktop 1080p, DPR 1)', () => {
    const s = computeViewScale(1920, 1080, 1);
    expect(s).toMatchObject({ deviceScale: 3, fractional: false, cssWidth: 1920, cssHeight: 1080, offsetX: 0, offsetY: 0 });
  });

  it('letterboxes when the window is not 16:9', () => {
    const s = computeViewScale(1440, 900, 1);
    expect(s.deviceScale).toBe(2);
    expect(s.cssWidth).toBe(1280);
    expect(s.offsetX).toBe(80);
    expect(s.offsetY).toBe(90);
  });

  it('scales in device pixels on high-DPR phones (landscape)', () => {
    const s = computeViewScale(844, 390, 3); // 2532x1170 device px
    expect(s.deviceScale).toBe(3);
    expect(s.cssWidth).toBeCloseTo(640);
    expect(s.cssHeight).toBeCloseTo(360);
    expect(s.cssPerVirtual).toBeCloseTo(1);
  });

  it('portrait (S9): fractional scale so the view spans the full width, bars top and bottom', () => {
    const s = computeViewScale(390, 844, 3); // 1170 device px wide
    expect(s.fractional).toBe(true);
    expect(s.deviceScale).toBeCloseTo(1170 / 640);
    expect(s.cssWidth).toBeCloseTo(390);
    expect(s.offsetX).toBeCloseTo(0);
    expect(s.offsetY).toBeGreaterThan(0);
    expect(s.cssHeight + 2 * s.offsetY).toBeCloseTo(844);
    expect(s.cssPerVirtual).toBeCloseTo(390 / 640);
  });

  it('portrait fills the width at every common phone / tablet size and DPR', () => {
    for (const [w, h, dpr] of [
      [375, 667, 2],
      [390, 844, 3],
      [430, 932, 3],
      [360, 800, 3],
      [412, 915, 2.625],
      [768, 1024, 2],
      [820, 1180, 2],
    ] as const) {
      const s = computeViewScale(w, h, dpr);
      expect(s.cssWidth, `${w}x${h}@${dpr}`).toBeCloseTo(w);
      expect(s.cssHeight).toBeLessThanOrEqual(h);
    }
  });

  it('portrait keeps an exact integer scale when the width happens to fit one', () => {
    const s = computeViewScale(640, 900, 1);
    expect(s).toMatchObject({ deviceScale: 1, fractional: false, cssWidth: 640 });
  });

  it('landscape keeps integer scaling (unchanged by S9)', () => {
    for (const [w, h, dpr] of [
      [844, 390, 3],
      [667, 375, 2],
      [1920, 1080, 1],
      [1024, 768, 2],
    ] as const) {
      const s = computeViewScale(w, h, dpr);
      expect(s.fractional).toBe(false);
      expect(Number.isInteger(s.deviceScale)).toBe(true);
    }
  });

  it('falls back to a fractional scale when even 1x does not fit', () => {
    const s = computeViewScale(320, 568, 1);
    expect(s.fractional).toBe(true);
    expect(s.deviceScale).toBeCloseTo(0.5);
    expect(s.cssWidth).toBeCloseTo(320);
  });

  it('maps client points to virtual view px', () => {
    const rect = { left: 80, top: 90, width: 1280, height: 720 };
    expect(clientToView(80, 90, rect)).toEqual({ x: 0, y: 0 });
    expect(clientToView(80 + 640, 90 + 360, rect)).toEqual({ x: 320, y: 180 });
  });
});

describe('low-res render mode', () => {
  it('caps the renderer at 1 device px per virtual px (CSS upscales); off = the full device scale', async () => {
    const { renderResolution } = await import('../src/render/pixiApp');
    const phone = computeViewScale(844, 390, 3); // iPhone landscape: k = 3
    expect(renderResolution(phone.deviceScale, false)).toBe(3);
    expect(renderResolution(phone.deviceScale, true)).toBe(1);
    expect(renderResolution(0.8, true)).toBe(0.8); // never upscales a tiny view
  });
});

describe('RenderResolutionState (the Pixi host resize path)', () => {
  it('allocates the low-res buffer from the first resize and re-sizes only on real changes', async () => {
    const { RenderResolutionState } = await import('../src/render/pixiApp');
    const calls: number[] = [];
    const r = new RenderResolutionState((res) => calls.push(res), true);
    r.setLowRes(true); // no scale yet: nothing to allocate
    expect(calls).toEqual([]);
    r.setDeviceScale(3); // first allocation on a DPR-3 phone: already the 640×360 buffer
    expect(calls).toEqual([1]);
    r.setLowRes(false);
    expect(calls).toEqual([1, 3]);
    r.setLowRes(false);
    expect(calls).toEqual([1, 3]);
    r.setLowRes(true);
    expect(calls).toEqual([1, 3, 1]);
    r.setDeviceScale(2); // resize / rotation: the scaler's new scale is applied (still capped)
    expect(calls).toEqual([1, 3, 1, 1]);
    expect(r.lowRes).toBe(true);
  });
});

describe('detectTouch', () => {
  it('needs touch points: a coarse pointer alone does not count', async () => {
    const { detectTouch } = await import('../src/ui/touch/touchLayer');
    const win = (points: number, coarse: boolean, anyCoarse = coarse) =>
      ({ navigator: { maxTouchPoints: points }, matchMedia: (q: string) => ({ matches: q.startsWith('(pointer') ? coarse : anyCoarse }) }) as unknown as Window;
    expect(detectTouch(win(5, true))).toBe(true); // phone
    expect(detectTouch(win(5, false, true))).toBe(true); // touch laptop / iPad with a trackpad
    expect(detectTouch(win(0, true))).toBe(false); // coarse pointer, no touch points
    expect(detectTouch(win(0, false))).toBe(false); // desktop
    expect(detectTouch(win(10, false, false))).toBe(false); // touch points but only fine pointers
  });
});

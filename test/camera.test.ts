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

  it('handles portrait: fits the width, letterboxes top and bottom', () => {
    const s = computeViewScale(390, 844, 3); // 1170 device px wide
    expect(s.deviceScale).toBe(1);
    expect(s.cssWidth).toBeCloseTo(640 / 3);
    expect(s.offsetY).toBeGreaterThan(0);
    expect(s.cssHeight + 2 * s.offsetY).toBeCloseTo(844);
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

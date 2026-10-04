/**
 * Round 20 - The Hollow's roof crystal (user: "the white stalactites or what they are - they
 * visually dont look very nice"). The crust spires are drawn by their own render layer
 * (src/render/crystalSpires.ts) as translucent faceted crystal instead of the flat tile fill.
 * Visual only: the physics outline, material and sun-transparency are untouched.
 */

import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/levels/registry';
import { HOLLOW_FALLS_LOOK, HOLLOW_SPIRES, hollow } from '../src/levels/hollow';
import { CRYSTAL_GLOW_RM_MAX, crystalGeometry, crystalGlowAlpha, isCrystalSpire } from '../src/render/crystalSpires';
import { setupPainter } from './support/pixelCtx';

const lum = (c: number) => 0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255);

describe('Hollow crystal spires (round 20)', () => {
  const crystal = hollow.terrain.pieces.filter(isCrystalSpire);
  const roof = HOLLOW_SPIRES.filter((s) => s.from === 'ceiling');

  it('exactly the crust spires take the crystal look; they stay sun-transparent crystal polygons', () => {
    expect(roof.length).toBeGreaterThan(40);
    expect(crystal.map((p) => p.id).sort()).toEqual(roof.map((s) => s.id).sort());
    for (const p of crystal) {
      expect(p.kind).toBe('polygon');
      expect(p.style.material).toBe('crystal');
      expect(p.castsShadow).toBe(false);
    }
    // floor spires keep the rock tiles
    const floorIds = new Set(HOLLOW_SPIRES.filter((s) => s.from === 'floor').map((s) => s.id));
    for (const p of hollow.terrain.pieces) if (floorIds.has(p.id)) expect(isCrystalSpire(p)).toBe(false);
  });

  it('no other level opts in (the look is Hollow-only for now)', () => {
    for (const lv of Object.values(LEVELS)) if (lv && lv.id !== hollow.id) expect(lv.terrain.pieces.some(isCrystalSpire), lv.id).toBe(false);
  });

  it('the tile painter skips them (no double draw), and still paints every other piece', () => {
    const { pieces } = setupPainter(hollow);
    expect(pieces.length).toBe(hollow.terrain.pieces.length - crystal.length);
  });

  it('geometry: 4 facet columns per row, lit flank brighter than the shade flank, all inside the outline box', () => {
    for (const p of crystal) {
      const g = crystalGeometry(p.id, p.points!);
      const rows = p.points!.length / 2 - 1;
      expect(g.quads.length).toBe(4 * rows);
      const xs = p.points!.map((q) => q.x);
      const ys = p.points!.map((q) => q.y);
      expect(g.bbox).toEqual({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
      const inBox = (x: number, y: number) => x >= g.bbox.x0 - 2 && x <= g.bbox.x1 + 2 && y >= g.bbox.y0 - 2 && y <= g.bbox.y1 + 2;
      for (const q of g.quads) for (let i = 0; i < q.pts.length; i += 2) expect(inBox(q.pts[i]!, q.pts[i + 1]!)).toBe(true);
      for (let i = 0; i < g.glow.length; i += 2) expect(inBox(g.glow[i]!, g.glow[i + 1]!)).toBe(true);
      for (const gl of g.glints) expect(inBox(gl.x, gl.y)).toBe(true);
      // in every row the lit column (0) is brighter than the deep shade column (3)
      for (let r = 0; r < rows; r++) expect(lum(g.quads[r * 4]!.color)).toBeGreaterThan(lum(g.quads[r * 4 + 3]!.color));
      // translucent, not opaque tiles
      for (const q of g.quads) {
        expect(q.alpha).toBeGreaterThan(0.6);
        expect(q.alpha).toBeLessThan(1);
      }
      expect(g.lines.length).toBeGreaterThan(5);
    }
  });

  it('deterministic: the same spire always gets the same facets', () => {
    const p = crystal[0]!;
    expect(crystalGeometry(p.id, p.points!)).toEqual(crystalGeometry(p.id, p.points!));
  });
});

describe('round-20 audit LOW-1: crystal glow under reduced motion', () => {
  /** A 13 s sun cycle: charge ramps 0 -> 1 over 3.5 s, then snaps back to 0 (the pulse). */
  const charge = (t: number) => {
    const c = t % 13;
    return c > 9.5 ? (c - 9.5) / 3.5 : 0;
  };
  const run = (rm: boolean) => {
    const st = { level: -1, lastMs: -1 };
    const out: number[] = [];
    for (let ms = 0; ms <= 26_000; ms += 1000 / 60) out.push(crystalGlowAlpha(st, ms, charge(ms / 1000), rm));
    return out;
  };

  it('normal motion: unchanged 0.2 + 0.8 x charge (full telegraph)', () => {
    const st = { level: -1, lastMs: -1 };
    expect(crystalGlowAlpha(st, 0, 0, false)).toBeCloseTo(0.2);
    expect(crystalGlowAlpha(st, 16, 1, false)).toBeCloseTo(1);
    expect(crystalGlowAlpha(st, 32, 0, false)).toBeCloseTo(0.2);
  });

  it('reduced motion: still telegraphs, capped, and eases down instead of snapping off', () => {
    const a = run(true);
    const max = Math.max(...a);
    expect(max).toBeGreaterThan(0.4); // the telegraph is still visible
    expect(max).toBeLessThanOrEqual(CRYSTAL_GLOW_RM_MAX + 1e-9);
    let maxDrop = 0;
    for (let i = 1; i < a.length; i++) maxDrop = Math.max(maxDrop, a[i - 1]! - a[i]!);
    expect(maxDrop).toBeLessThan(0.01); // per frame (normal motion drops 0.8 in one frame)
    expect(Math.min(...a)).toBeGreaterThanOrEqual(0.2 - 1e-9);
    const n = run(false);
    let nDrop = 0;
    for (let i = 1; i < n.length; i++) nDrop = Math.max(nDrop, n[i - 1]! - n[i]!);
    expect(nDrop).toBeGreaterThan(0.7);
  });
});

describe('round-20 audit: the Hollow waterfalls are tinted water, Hollow only', () => {
  it('all six falls carry the blue see-through animated look; no other level tints a waterfall', () => {
    const falls = hollow.entities.filter((e) => e.kind === 'staticProp' && e.sprite === 'prop.waterfallWide');
    expect(falls.length).toBe(6);
    for (const f of falls) {
      if (f.kind !== 'staticProp') continue;
      expect(f.tint).toBe(HOLLOW_FALLS_LOOK.tint);
      expect(f.alpha).toBeGreaterThan(0.5);
      expect(f.alpha).toBeLessThan(1);
      expect(f.animFps).toBeGreaterThan(0);
      // blue-dominant multiply over the cream 'core' water ramp
      const t = HOLLOW_FALLS_LOOK.tint;
      expect(t & 255).toBeGreaterThan((t >> 16) & 255);
    }
    for (const lv of Object.values(LEVELS))
      if (lv && lv.id !== hollow.id) for (const e of lv.entities) if (e.kind === 'staticProp') expect(e.tint, `${lv.id} ${e.id}`).toBeUndefined();
  });
});

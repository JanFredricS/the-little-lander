/**
 * Band painting identity (stutter round 2 audit): painting a chunk in
 * TERRAIN_BAND_ROWS-row bands (each clipped to its band) must give exactly
 * the pixels of one full-chunk paint - including brittle-zone cracks on
 * vertical walls, whose anchors used to restart at every band boundary.
 *
 * The real painter runs on the pixel-model canvas stub (support/pixelCtx.ts).
 * Band vs full compares the optimised painter with itself; the reference
 * comparison (terrainTiles.reference.test.ts) pins it to the plain painter.
 */
import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/levels/registry';
import { paintPieces, type PaintRect } from '../src/render/terrainTiles';
import { PixelCtx, setupPainter } from './support/pixelCtx';
import { TERRAIN_BAND_ROWS, TERRAIN_CHUNK } from '../src/render/terrainView';
import type { LevelSpec } from '../src/contracts';

const setup = setupPainter;

/** One full-chunk paint vs the same chunk painted band by band (each band clipped like TerrainView.paintBand). */
function compare(spec: LevelSpec, i: number, j: number, s: ReturnType<typeof setup>, bottomUp = false): { same: boolean; pixels: number; diff: number } {
  const C = TERRAIN_CHUNK;
  const full = new Map<number, string>();
  const f = new PixelCtx(full, C, C);
  f.setTransform(1, 0, 0, 1, -i * C, -j * C);
  paintPieces(f as never, s.pieces, s.src, { x: i * C, y: j * C, w: C, h: C }, s.cracks);
  const banded = new Map<number, string>();
  const b = new PixelCtx(banded, C, C);
  const r: PaintRect = { x: i * C, y: 0, w: C, h: TERRAIN_BAND_ROWS };
  const bands = C / TERRAIN_BAND_ROWS;
  for (let k = 0; k < bands; k++) {
    const band = bottomUp ? bands - 1 - k : k; // TerrainView paints chunks above the view bottom-up
    r.y = j * C + band * TERRAIN_BAND_ROWS;
    b.setTransform(1, 0, 0, 1, -r.x, -j * C);
    b.save();
    b.beginPath();
    b.rect(r.x, r.y, r.w, r.h);
    b.clip();
    paintPieces(b as never, s.pieces, s.src, r, s.cracks);
    b.restore();
  }
  let diff = 0;
  for (const [k, v] of full) if (banded.get(k) !== v) diff++;
  for (const k of banded.keys()) if (!full.has(k)) diff++;
  return { same: diff === 0, pixels: full.size, diff };
}

describe('terrain band painting is pixel-identical to a full-chunk paint', () => {
  it('every chunk touching a brittle zone (cracks on floors AND vertical walls), every level that has one', () => {
    let checked = 0;
    for (const spec of Object.values(LEVELS)) {
      const s = setup(spec);
      if (s.cracks.length === 0) continue;
      const C = TERRAIN_CHUNK;
      for (const z of s.cracks)
        for (let j = Math.floor((z.y - 32) / C); j <= Math.floor((z.y + z.h + 32) / C); j++)
          for (let i = Math.floor((z.x - 32) / C); i <= Math.floor((z.x + z.w + 32) / C); i++) {
            const r = compare(spec, i, j, s);
            expect(r.diff, `${spec.id} chunk ${i},${j}`).toBe(0);
            if (r.pixels > 0) checked++;
          }
    }
    expect(checked).toBeGreaterThan(3);
  });

  it('a sample of ordinary chunks on every level', () => {
    for (const spec of Object.values(LEVELS)) {
      const s = setup(spec);
      const C = TERRAIN_CHUNK;
      const ni = Math.ceil(spec.worldSize.w / C);
      const nj = Math.ceil(spec.worldSize.h / C);
      for (let k = 0; k < 6; k++) {
        const i = (k * 7 + 3) % ni;
        const j = (k * 11 + 5) % nj;
        expect(compare(spec, i, j, s).diff, `${spec.id} chunk ${i},${j}`).toBe(0);
      }
    }
  });

  it('a synthetic tall brittle wall: cracks crossing band boundaries on vertical surfaces are identical', () => {
    const base = LEVELS.vaults!;
    const style = base.terrain.pieces[0]!.style;
    // a 200 px wide pillar, 1024 tall, fully inside a brittle zone: two long vertical walls
    const spec = {
      ...base,
      worldSize: { w: 512, h: 1024 },
      terrain: { pieces: [{ id: 'pillar', kind: 'polygon', points: [{ x: 100, y: 40 }, { x: 300, y: 40 }, { x: 300, y: 1000 }, { x: 100, y: 1000 }], style }] },
      zones: [{ kind: 'brittleRegion', id: 'b', rect: { x: 0, y: 0, w: 512, h: 1024 }, breakAfterSec: 1 }],
    } as unknown as LevelSpec;
    const s = setup(spec);
    let pixels = 0;
    for (let j = 0; j < 4; j++)
      for (let i = 0; i < 2; i++) {
        const r = compare(spec, i, j, s);
        expect(r.diff, `chunk ${i},${j}`).toBe(0);
        expect(compare(spec, i, j, s, true).diff, `chunk ${i},${j} bottom-up`).toBe(0);
        pixels += r.pixels;
      }
    expect(pixels).toBeGreaterThan(0);
  });
});

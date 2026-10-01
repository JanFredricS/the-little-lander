/**
 * The optimised terrain painter (slab-culled fill rows, merged strip /
 * outline runs, cached outline Path2D, precise "did anything land" result)
 * against the plain reference painter (support/terrainTilesReference.ts:
 * per-cell fill over the whole bbox, per-column / per-row strips, per-pixel
 * outline, path re-issued per clip), pixel for pixel on the stub canvas -
 * not circular: a culling or run-merging bug that drops pixels shows up
 * here even though it would paint full and banded chunks alike.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { LEVELS } from '../src/levels/registry';
import { paintPieces, piecesTouch, type PaintRect } from '../src/render/terrainTiles';
import { TERRAIN_BAND_ROWS, TERRAIN_CHUNK } from '../src/render/terrainView';
import type { LevelSpec } from '../src/contracts';
import { imageKinds, installPath2D, PixelCtx, setupPainter } from './support/pixelCtx';
import { paintPiecesReference } from './support/terrainTilesReference';

const C = TERRAIN_CHUNK;
type Setup = ReturnType<typeof setupPainter>;

/** Paint chunk (i, j) with `paint` (whole chunk, or band by band like TerrainView.paintBand). */
function paintChunk(paint: typeof paintPieces, s: Setup, i: number, j: number, banded: boolean): { px: Map<number, string>; ctx: PixelCtx; drew: boolean } {
  const px = new Map<number, string>();
  const ctx = new PixelCtx(px, C, C);
  let drew = false;
  if (!banded) {
    ctx.setTransform(1, 0, 0, 1, -i * C, -j * C);
    drew = paint(ctx as never, s.pieces, s.src, { x: i * C, y: j * C, w: C, h: C }, s.cracks);
  } else {
    const r: PaintRect = { x: i * C, y: 0, w: C, h: TERRAIN_BAND_ROWS };
    for (let k = 0; k < C / TERRAIN_BAND_ROWS; k++) {
      r.y = j * C + k * TERRAIN_BAND_ROWS;
      ctx.setTransform(1, 0, 0, 1, -r.x, -j * C);
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      if (paint(ctx as never, s.pieces, s.src, r, s.cracks)) drew = true;
      ctx.restore();
    }
  }
  return { px, ctx, drew };
}

interface Tally {
  chunks: number;
  pixels: number;
  kinds: Set<string>;
  styles: Set<string>;
  calls: number;
  refCalls: number;
}

/** Optimised vs reference on chunk (i, j): identical pixels; "nothing landed" only when the reference has no pixel. */
function check(spec: LevelSpec, s: Setup, i: number, j: number, t: Tally, banded = false): void {
  const ref = paintChunk(paintPiecesReference as typeof paintPieces, s, i, j, false);
  const opt = paintChunk(paintPieces, s, i, j, banded);
  let diff = 0;
  for (const [k, v] of ref.px) if (opt.px.get(k) !== v) diff++;
  for (const k of opt.px.keys()) if (!ref.px.has(k)) diff++;
  expect(diff, `${spec.id} chunk ${i},${j}${banded ? ' banded' : ''}: ${diff} of ${ref.px.size} pixels differ`).toBe(0);
  if (!opt.drew) expect(ref.px.size, `${spec.id} chunk ${i},${j}: reported empty but has pixels`).toBe(0);
  t.chunks++;
  t.pixels += ref.px.size;
  t.calls += opt.ctx.calls;
  t.refCalls += ref.ctx.calls;
  for (const v of ref.px.values()) {
    const id = Number(v.split(':')[0]);
    const kind = imageKinds.get(id);
    if (kind) t.kinds.add(kind.split(':')[1]!);
  }
  for (const st of ref.ctx.styles) t.styles.add(st);
}

/** Every chunk of `spec` the bbox test says may hold terrain, thinned to at most `max` (evenly spread). */
function terrainChunks(spec: LevelSpec, s: Setup, max: number): Array<[number, number]> {
  const all: Array<[number, number]> = [];
  for (let j = 0; j < Math.ceil(spec.worldSize.h / C); j++)
    for (let i = 0; i < Math.ceil(spec.worldSize.w / C); i++) if (piecesTouch(s.pieces, { x: i * C, y: j * C, w: C, h: C })) all.push([i, j]);
  if (all.length <= max) return all;
  const step = all.length / max;
  return Array.from({ length: max }, (_, k) => all[Math.floor(k * step)]!);
}

const newTally = (): Tally => ({ chunks: 0, pixels: 0, kinds: new Set(), styles: new Set(), calls: 0, refCalls: 0 });

let uninstall: (() => void) | null = null;
afterEach(() => {
  uninstall?.();
  uninstall = null;
});

describe('optimised terrain painter == plain reference painter', () => {
  it('chunks across every level (walls, slopes, floors, ceilings, decor), whole-chunk paint', () => {
    const t = newTally();
    for (const spec of Object.values(LEVELS)) {
      const s = setupPainter(spec);
      for (const [i, j] of terrainChunks(spec, s, 16)) check(spec, s, i, j, t);
    }
    expect(t.chunks).toBeGreaterThan(100);
    expect(t.pixels).toBeGreaterThan(1_000_000);
    for (const k of ['fill', 'top', 'bottom', 'side', 'decor']) expect(t.kinds, `tile kind ${k} exercised`).toContain(k);
    expect(t.calls).toBeLessThan(t.refCalls); // the optimisations really ran
  });

  it('every chunk touching a brittle zone (cracks), whole-chunk and banded', () => {
    const t = newTally();
    for (const spec of Object.values(LEVELS)) {
      const s = setupPainter(spec);
      for (const z of s.cracks)
        for (let j = Math.floor((z.y - 32) / C); j <= Math.floor((z.y + z.h + 32) / C); j++)
          for (let i = Math.floor((z.x - 32) / C); i <= Math.floor((z.x + z.w + 32) / C); i++) {
            check(spec, s, i, j, t);
            check(spec, s, i, j, t, true);
          }
    }
    expect(t.chunks).toBeGreaterThan(6);
    // crack colours (beyond the outline + fill tiles) were drawn
    expect(t.styles.size).toBeGreaterThan(3);
  });

  it('banded painting matches the reference too (descent: the streamed level)', () => {
    const t = newTally();
    const spec = LEVELS.descent!;
    const s = setupPainter(spec);
    for (const [i, j] of terrainChunks(spec, s, 40)) check(spec, s, i, j, t, true);
    expect(t.chunks).toBeGreaterThan(30);
  });

  it('with Path2D available (the browser branch: cached outline paths), still identical', () => {
    uninstall = installPath2D();
    const t = newTally();
    for (const id of ['descent', 'vaults'] as const) {
      const spec = LEVELS[id]!;
      const s = setupPainter(spec); // fresh pieces: no path cached from the branch without Path2D
      for (const [i, j] of terrainChunks(spec, s, 16)) {
        check(spec, s, i, j, t);
        check(spec, s, i, j, t, true);
      }
    }
    expect(t.chunks).toBeGreaterThan(30);
  });
});

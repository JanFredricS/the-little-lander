/**
 * Band painting identity (stutter round 2 audit): painting a chunk in
 * TERRAIN_BAND_ROWS-row bands (each clipped to its band) must give exactly
 * the pixels of one full-chunk paint - including brittle-zone cracks on
 * vertical walls, whose anchors used to restart at every band boundary.
 *
 * The real painter runs on a pixel-model canvas stub: fillRect / drawImage
 * write per-pixel source ids (last write wins), rect clips are honoured,
 * polygon clips are ignored in BOTH runs (the comparison is band-vs-full,
 * so it stays exact).
 */
import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/levels/registry';
import { PALETTES } from '../src/art/palettes';
import { paintPieces, preparePiece, TileSource, type PaintRect } from '../src/render/terrainTiles';
import { TERRAIN_BAND_ROWS, TERRAIN_CHUNK } from '../src/render/terrainView';
import type { LevelSpec } from '../src/contracts';

let nextImg = 1;
class StubImage {
  readonly id = nextImg++;
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext() {
    return new PixelCtx(null, 0, 0);
  }
}

interface Clip {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Pixel-model 2D context: chunk-local pixels -> source id. Translation-only transforms. */
class PixelCtx {
  fillStyle: unknown = '#000';
  imageSmoothingEnabled = true;
  private tx = 0;
  private ty = 0;
  private clipR: Clip = { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity };
  private stack: Array<{ tx: number; ty: number; clip: Clip }> = [];
  private pathRect: Clip | null = null;
  constructor(
    readonly px: Map<number, string> | null,
    readonly w: number,
    readonly h: number,
  ) {}
  setTransform(_a: number, _b: number, _c: number, _d: number, e: number, f: number) {
    this.tx = e;
    this.ty = f;
  }
  translate(x: number, y: number) {
    this.tx += x;
    this.ty += y;
  }
  scale() {}
  save() {
    this.stack.push({ tx: this.tx, ty: this.ty, clip: { ...this.clipR } });
  }
  restore() {
    const s = this.stack.pop()!;
    this.tx = s.tx;
    this.ty = s.ty;
    this.clipR = s.clip;
  }
  beginPath() {
    this.pathRect = null;
  }
  rect(x: number, y: number, w: number, h: number) {
    this.pathRect = { x0: x + this.tx, y0: y + this.ty, x1: x + w + this.tx, y1: y + h + this.ty };
  }
  moveTo() {
    this.pathRect = null; // polygon: ignored as a clip (in both runs)
  }
  lineTo() {}
  closePath() {}
  clip() {
    const r = this.pathRect;
    if (!r) return;
    const c = this.clipR;
    this.clipR = { x0: Math.max(c.x0, r.x0), y0: Math.max(c.y0, r.y0), x1: Math.min(c.x1, r.x1), y1: Math.min(c.y1, r.y1) };
  }
  clearRect() {}
  private write(dx: number, dy: number, w: number, h: number, id: (i: number, j: number) => string) {
    if (!this.px) return;
    const x0 = Math.round(dx + this.tx);
    const y0 = Math.round(dy + this.ty);
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const x = x0 + i;
        const y = y0 + j;
        const c = this.clipR;
        if (x < c.x0 || x >= c.x1 || y < c.y0 || y >= c.y1 || x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
        this.px.set(y * this.w + x, id(i, j));
      }
  }
  fillRect(x: number, y: number, w: number, h: number) {
    const s = String(this.fillStyle);
    this.write(x, y, w, h, () => s);
  }
  drawImage(img: StubImage, ...a: number[]) {
    if (a.length === 2) this.write(a[0]!, a[1]!, img.width, img.height, (i, j) => `${img.id}:${i},${j}`);
    else {
      const [sx, sy, sw, sh, dx, dy] = a as [number, number, number, number, number, number];
      this.write(dx, dy, sw, sh, (i, j) => `${img.id}:${sx + i},${sy + j}`);
    }
  }
}

const tiles = new Map<string, StubImage>();
const art = {
  palettes: PALETTES,
  getTile: (theme: string, kind: string, v: number) => {
    const k = `${theme}|${kind}|${v}`;
    let t = tiles.get(k);
    if (!t) tiles.set(k, (t = new StubImage(16, 16)));
    return t;
  },
} as never;

function setup(spec: LevelSpec) {
  const pieces = spec.terrain.pieces.map((p) => preparePiece(p, spec.worldSize.h));
  const cracks = spec.zones.flatMap((z) => (z.kind === 'brittleRegion' ? [z.rect] : []));
  const src = new TileSource(art, spec.themeId, (w, h) => new StubImage(w, h) as never);
  return { pieces, cracks, src };
}

/** One full-chunk paint vs the same chunk painted band by band (each band clipped like TerrainView.paintBand). */
function compare(spec: LevelSpec, i: number, j: number, s: ReturnType<typeof setup>): { same: boolean; pixels: number; diff: number } {
  const C = TERRAIN_CHUNK;
  const full = new Map<number, string>();
  const f = new PixelCtx(full, C, C);
  f.setTransform(1, 0, 0, 1, -i * C, -j * C);
  paintPieces(f as never, s.pieces, s.src, { x: i * C, y: j * C, w: C, h: C }, s.cracks);
  const banded = new Map<number, string>();
  const b = new PixelCtx(banded, C, C);
  const r: PaintRect = { x: i * C, y: 0, w: C, h: TERRAIN_BAND_ROWS };
  for (let band = 0; band < C / TERRAIN_BAND_ROWS; band++) {
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
        pixels += r.pixels;
      }
    expect(pixels).toBeGreaterThan(0);
  });
});

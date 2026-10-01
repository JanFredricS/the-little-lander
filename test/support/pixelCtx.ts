/**
 * Pixel-model canvas stub for the terrain painter tests (Node has no
 * canvas): fillRect / drawImage write per-pixel source ids (last write
 * wins); translation-only transforms; rect AND polygon clips are honoured
 * (a pixel is inside a polygon clip when its centre is - no anti-aliasing;
 * the real-canvas check covers that). Polygon clips come from moveTo/lineTo
 * paths or from a StubPath2D passed to clip(path) (install it as the global
 * Path2D with installPath2D() to exercise the painter's cached-path branch).
 */
import { PALETTES } from '../../src/art/palettes';
import { preparePiece, TileSource } from '../../src/render/terrainTiles';
import type { LevelSpec } from '../../src/contracts';

let nextImg = 1;
/** Tile kind of every stub tile image, by id (coverage checks). */
export const imageKinds = new Map<number, string>();

export class StubImage {
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

/** Path2D stand-in: records one polygon (untransformed; the context applies its transform at clip time). */
export class StubPath2D {
  pts: number[] = [];
  moveTo(x: number, y: number) {
    this.pts = [x, y];
  }
  lineTo(x: number, y: number) {
    this.pts.push(x, y);
  }
  closePath() {}
}

/** Install StubPath2D as the global Path2D; returns the uninstaller. */
export function installPath2D(): () => void {
  const g = globalThis as { Path2D?: unknown };
  const had = 'Path2D' in g;
  const prev = g.Path2D;
  g.Path2D = StubPath2D;
  return () => {
    if (had) g.Path2D = prev;
    else delete g.Path2D;
  };
}

/** Pixel-model 2D context: canvas-local pixels -> source id. */
export class PixelCtx {
  fillStyle: unknown = '#000';
  imageSmoothingEnabled = true;
  private tx = 0;
  private ty = 0;
  private clipR: Clip = { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity };
  private polys: number[][] = [];
  private stack: Array<{ tx: number; ty: number; clip: Clip; polys: number[][] }> = [];
  private pathRect: Clip | null = null;
  private path: number[] | null = null;
  /** Per polygon (by content) inside-test results per pixel: 0 unknown, 1 in, 2 out. */
  private insideCache = new Map<string, Uint8Array>();
  private byPoly = new WeakMap<number[], Uint8Array>();
  /** Draw calls issued (drawImage + fillRect). */
  calls = 0;
  /** Fill styles written (coverage checks). */
  readonly styles = new Set<string>();
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
    this.stack.push({ tx: this.tx, ty: this.ty, clip: { ...this.clipR }, polys: this.polys });
  }
  restore() {
    const s = this.stack.pop()!;
    this.tx = s.tx;
    this.ty = s.ty;
    this.clipR = s.clip;
    this.polys = s.polys;
  }
  beginPath() {
    this.pathRect = null;
    this.path = null;
  }
  rect(x: number, y: number, w: number, h: number) {
    this.pathRect = { x0: x + this.tx, y0: y + this.ty, x1: x + w + this.tx, y1: y + h + this.ty };
  }
  moveTo(x: number, y: number) {
    this.pathRect = null;
    this.path = [x + this.tx, y + this.ty];
  }
  lineTo(x: number, y: number) {
    this.path?.push(x + this.tx, y + this.ty);
  }
  closePath() {}
  clip(p?: StubPath2D) {
    if (p) {
      this.polys = [...this.polys, p.pts.map((v, k) => v + (k % 2 === 0 ? this.tx : this.ty))];
      return;
    }
    if (this.path) {
      this.polys = [...this.polys, this.path];
      return;
    }
    const r = this.pathRect;
    if (!r) return;
    const c = this.clipR;
    this.clipR = { x0: Math.max(c.x0, r.x0), y0: Math.max(c.y0, r.y0), x1: Math.min(c.x1, r.x1), y1: Math.min(c.y1, r.y1) };
  }
  clearRect() {}
  private insidePoly(poly: number[], x: number, y: number): boolean {
    let cache = this.byPoly.get(poly);
    if (!cache) {
      const key = poly.join(',');
      cache = this.insideCache.get(key);
      if (!cache) this.insideCache.set(key, (cache = new Uint8Array(this.w * this.h)));
      this.byPoly.set(poly, cache);
    }
    const k = y * this.w + x;
    // sample just off the pixel centre: centres exactly ON an edge (common - integer outline
    // vertices) would otherwise flip on 1e-13 float noise of a recomputed endpoint
    if (cache[k] === 0) cache[k] = inside(poly, x + 0.5 + 3.1e-7, y + 0.5 + 1.7e-7) ? 1 : 2;
    return cache[k] === 1;
  }
  private write(dx: number, dy: number, w: number, h: number, id: (i: number, j: number) => string) {
    this.calls++;
    if (!this.px) return;
    const x0 = Math.round(dx + this.tx);
    const y0 = Math.round(dy + this.ty);
    const c = this.clipR;
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const x = x0 + i;
        const y = y0 + j;
        if (x < c.x0 || x >= c.x1 || y < c.y0 || y >= c.y1 || x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
        if (!this.polys.every((poly) => this.insidePoly(poly, x, y))) continue;
        this.px.set(y * this.w + x, id(i, j));
      }
  }
  fillRect(x: number, y: number, w: number, h: number) {
    const s = String(this.fillStyle);
    this.styles.add(s);
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

/** Even-odd point-in-polygon (flat x,y list). */
function inside(poly: number[], px: number, py: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i]!;
    const yi = poly[i + 1]!;
    const xj = poly[j]!;
    const yj = poly[j + 1]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

const tiles = new Map<string, StubImage>();
export const stubArt = {
  palettes: PALETTES,
  getTile: (theme: string, kind: string, v: number) => {
    const k = `${theme}|${kind}|${v}`;
    let t = tiles.get(k);
    if (!t) {
      tiles.set(k, (t = new StubImage(16, 16)));
      imageKinds.set(t.id, kind);
    }
    return t;
  },
} as never;

/** Prepared pieces, brittle rects and a tile source for `spec` on the stub canvas. */
export function setupPainter(spec: LevelSpec) {
  const pieces = spec.terrain.pieces.map((p) => preparePiece(p, spec.worldSize.h));
  const cracks = spec.zones.flatMap((z) => (z.kind === 'brittleRegion' ? [z.rect] : []));
  const src = new TileSource(stubArt, spec.themeId, (w, h) => new StubImage(w, h) as never);
  return { pieces, cracks, src };
}

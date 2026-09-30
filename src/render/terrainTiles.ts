/**
 * Terrain tile painter: draws LevelSpec terrain with the S2 tile set
 * (ArtApi.getTile per theme + material) instead of flat polygons. Pure
 * Canvas2D, no Pixi, so it can paint chunk canvases for the scrolling world
 * (terrainView.ts) and standalone canvases for moving islands.
 *
 * Per piece (clipped to its solid outline):
 *  - 'fill' tiles on the world 16 px grid (variant hashed per cell);
 *  - surface strips along every exposed edge (style.surface, default on):
 *    edges facing up get 'top' tiles, facing down 'bottom', steep edges
 *    'side' (mirrored for right-facing walls). Strips follow the slope one
 *    pixel column (or row) at a time, so slopes stay crisp stair-steps;
 *  - after the clip: a 1 px outline (palette outline colour) just outside
 *    each surface, and 'decor' tiles standing on flat-ish top edges at
 *    style.decorDensity (default 0.2).
 * Ground pieces fill down to the world bottom and ceilings up to the top
 * (contract), and those closing edges get no surface.
 */

import { TILE_SIZE } from '../contracts';
import type { ArtApi, PixelCanvas, TerrainPiece, TerrainStyle, ThemeId, TileKind, Vec2 } from '../contracts';

const T = TILE_SIZE;

export interface SurfaceEdge {
  a: Vec2;
  b: Vec2;
  /** Outward unit normal (away from the solid). */
  n: Vec2;
  role: 'top' | 'bottom' | 'side';
}

export interface PreparedPiece {
  id: string;
  style: TerrainStyle;
  /** Closed solid outline (world px). */
  fill: Vec2[];
  surfaces: SurfaceEdge[];
  bbox: { x0: number; y0: number; x1: number; y1: number };
  seed: number;
}

function hash(...n: number[]): number {
  let h = 0x811c9dc5;
  for (const v of n) {
    h ^= v | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function contains(poly: readonly Vec2[], p: Vec2): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function edgeRole(n: Vec2): SurfaceEdge['role'] {
  if (n.y <= -0.5) return 'top';
  if (n.y >= 0.5) return 'bottom';
  return 'side';
}

/** Outline + exposed surface edges of a terrain piece (or a moving-island outline: kind 'polygon'). */
export function preparePiece(piece: Pick<TerrainPiece, 'id' | 'kind' | 'points' | 'style'>, worldH: number): PreparedPiece {
  const pts = piece.points.map((p) => ({ x: p.x, y: p.y }));
  let fill = pts;
  if (piece.kind !== 'polygon') {
    const edgeY = piece.kind === 'ground' ? worldH : 0;
    fill = [...pts, { x: pts[pts.length - 1]!.x, y: edgeY }, { x: pts[0]!.x, y: edgeY }];
  }
  const surfaces: SurfaceEdge[] = [];
  const count = piece.kind === 'polygon' ? pts.length : pts.length - 1;
  for (let i = 0; i < count; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy);
    if (l < 0.5) continue;
    let n = { x: dy / l, y: -dx / l }; // ground rule: solid below a left->right walk
    if (piece.kind === 'ceiling') n = { x: -n.x, y: -n.y };
    else if (piece.kind === 'polygon') {
      const mid = { x: (a.x + b.x) / 2 + n.x, y: (a.y + b.y) / 2 + n.y };
      if (contains(pts, mid)) n = { x: -n.x, y: -n.y };
    }
    surfaces.push({ a, b, n, role: edgeRole(n) });
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of fill) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { id: piece.id, style: piece.style, fill, surfaces, bbox: { x0, y0, x1, y1 }, seed: piece.style.variantSeed ?? hashStr(piece.id) };
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Img = CanvasImageSource;

/** Tile lookup with mirrored side tiles cached. */
export class TileSource {
  private readonly mirrored = new Map<string, PixelCanvas>();
  readonly outline: string;

  constructor(
    private readonly art: ArtApi,
    readonly theme: ThemeId,
    private readonly makeCanvas: (w: number, h: number) => PixelCanvas,
  ) {
    const pal = art.palettes[theme];
    this.outline = '#' + (pal.colors[pal.outline] ?? 0x000000).toString(16).padStart(6, '0');
  }

  tile(kind: TileKind, v: number): Img {
    return this.art.getTile(this.theme, kind, v) as Img;
  }

  sideMirrored(kind: TileKind, v: number): Img {
    const key = `${kind}|${v % 4}`;
    let c = this.mirrored.get(key);
    if (!c) {
      c = this.makeCanvas(T, T);
      const ctx = c.getContext('2d') as Ctx;
      ctx.translate(T, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(this.tile(kind, v), 0, 0);
      this.mirrored.set(key, c);
    }
    return c as Img;
  }
}

/** Visible rect (world px) being painted. */
export interface PaintRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlaps(p: PreparedPiece, r: PaintRect, pad: number): boolean {
  return p.bbox.x1 + pad >= r.x && p.bbox.x0 - pad <= r.x + r.w && p.bbox.y1 + pad >= r.y && p.bbox.y0 - pad <= r.y + r.h;
}

/**
 * Paint `pieces` into `ctx` (already translated so world coords draw in
 * place), limited to `r`. Returns whether anything was drawn.
 */
export function paintPieces(ctx: Ctx, pieces: readonly PreparedPiece[], tiles: TileSource, r: PaintRect): boolean {
  let drew = false;
  ctx.imageSmoothingEnabled = false;
  for (const p of pieces) {
    if (!overlaps(p, r, T * 2)) continue;
    drew = true;
    const mat = p.style.material;
    ctx.save();
    ctx.beginPath();
    p.fill.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
    ctx.closePath();
    ctx.clip();
    // fill grid
    const gx0 = Math.floor(Math.max(r.x, p.bbox.x0) / T);
    const gx1 = Math.floor(Math.min(r.x + r.w, p.bbox.x1) / T);
    const gy0 = Math.floor(Math.max(r.y, p.bbox.y0) / T);
    const gy1 = Math.floor(Math.min(r.y + r.h, p.bbox.y1) / T);
    const fillKind = `${mat}:fill` as TileKind;
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) ctx.drawImage(tiles.tile(fillKind, hash(gx, gy, p.seed) & 3), gx * T, gy * T);
    if (p.style.surface !== false) for (const e of p.surfaces) paintStrip(ctx, e, mat, p.seed, tiles, r);
    ctx.restore();
    if (p.style.surface !== false) {
      ctx.fillStyle = tiles.outline;
      for (const e of p.surfaces) paintOutline(ctx, e, r);
      const density = p.style.decorDensity ?? 0.2;
      if (density > 0) for (const e of p.surfaces) if (e.n.y <= -0.85) paintDecor(ctx, e, mat, p.seed, density, tiles, r);
    }
  }
  return drew;
}

function paintStrip(ctx: Ctx, e: SurfaceEdge, mat: string, seed: number, tiles: TileSource, r: PaintRect): void {
  const { a, b } = e;
  if (e.role !== 'side') {
    const xa = Math.min(a.x, b.x);
    const xb = Math.max(a.x, b.x);
    const x0 = Math.max(Math.floor(xa), Math.floor(r.x) - 1);
    const x1 = Math.min(Math.ceil(xb), Math.ceil(r.x + r.w) + 1);
    const kind = `${mat}:${e.role}` as TileKind;
    for (let x = x0; x < x1; x++) {
      const y = lerpAt(a, b, x + 0.5, 'x');
      const img = tiles.tile(kind, hash(Math.floor(x / T), seed, 7) & 3);
      const sx = ((x % T) + T) % T;
      if (e.role === 'top') ctx.drawImage(img, sx, 0, 1, T, x, Math.floor(y), 1, T);
      else ctx.drawImage(img, sx, 0, 1, T, x, Math.ceil(y) - T, 1, T);
    }
  } else {
    const ya = Math.min(a.y, b.y);
    const yb = Math.max(a.y, b.y);
    const y0 = Math.max(Math.floor(ya), Math.floor(r.y) - 1);
    const y1 = Math.min(Math.ceil(yb), Math.ceil(r.y + r.h) + 1);
    const kind = `${mat}:side` as TileKind;
    const right = e.n.x > 0; // surface faces right: mirror (side tiles face left)
    for (let y = y0; y < y1; y++) {
      const x = lerpAt(a, b, y + 0.5, 'y');
      const v = hash(Math.floor(y / T), seed, 11) & 3;
      const sy = ((y % T) + T) % T;
      if (right) ctx.drawImage(tiles.sideMirrored(kind, v), 0, sy, T, 1, Math.ceil(x) - T, y, T, 1);
      else ctx.drawImage(tiles.tile(kind, v), 0, sy, T, 1, Math.floor(x), y, T, 1);
    }
  }
}

function paintOutline(ctx: Ctx, e: SurfaceEdge, r: PaintRect): void {
  const { a, b } = e;
  if (e.role !== 'side') {
    const x0 = Math.max(Math.floor(Math.min(a.x, b.x)), Math.floor(r.x) - 1);
    const x1 = Math.min(Math.ceil(Math.max(a.x, b.x)), Math.ceil(r.x + r.w) + 1);
    for (let x = x0; x < x1; x++) {
      const y = lerpAt(a, b, x + 0.5, 'x');
      if (e.role === 'top') ctx.fillRect(x, Math.floor(y) - 1, 1, 1);
      else ctx.fillRect(x, Math.ceil(y), 1, 1);
    }
  } else {
    const y0 = Math.max(Math.floor(Math.min(a.y, b.y)), Math.floor(r.y) - 1);
    const y1 = Math.min(Math.ceil(Math.max(a.y, b.y)), Math.ceil(r.y + r.h) + 1);
    for (let y = y0; y < y1; y++) {
      const x = lerpAt(a, b, y + 0.5, 'y');
      if (e.n.x > 0) ctx.fillRect(Math.ceil(x), y, 1, 1);
      else ctx.fillRect(Math.floor(x) - 1, y, 1, 1);
    }
  }
}

function paintDecor(ctx: Ctx, e: SurfaceEdge, mat: string, seed: number, density: number, tiles: TileSource, r: PaintRect): void {
  const xa = Math.min(e.a.x, e.b.x);
  const xb = Math.max(e.a.x, e.b.x);
  const c0 = Math.ceil(Math.max(xa, r.x - T) / T);
  const c1 = Math.floor((Math.min(xb, r.x + r.w + T) - T) / T);
  const kind = `${mat}:decor` as TileKind;
  for (let c = c0; c <= c1; c++) {
    const h = hash(c, seed, 23);
    if ((h % 1000) / 1000 >= density) continue;
    const x = c * T;
    const y = Math.floor(Math.max(lerpAt(e.a, e.b, x + 1, 'x'), lerpAt(e.a, e.b, x + T - 1, 'x')));
    ctx.drawImage(tiles.tile(kind, (h >>> 10) & 3), x, y - T + 1);
  }
}

/** Point on segment a-b at coordinate `v` along `axis` (clamped). Returns the other coordinate. */
function lerpAt(a: Vec2, b: Vec2, v: number, axis: 'x' | 'y'): number {
  const av = axis === 'x' ? a.x : a.y;
  const bv = axis === 'x' ? b.x : b.y;
  const ao = axis === 'x' ? a.y : a.x;
  const bo = axis === 'x' ? b.y : b.x;
  if (Math.abs(bv - av) < 1e-9) return ao;
  const t = Math.min(1, Math.max(0, (v - av) / (bv - av)));
  return ao + (bo - ao) * t;
}

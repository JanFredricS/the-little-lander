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
 *    pixel column (or row) at a time, so slopes stay crisp stair-steps
 *    (runs of columns / rows at the same offset are drawn as ONE drawImage:
 *    same pixels, a fraction of the calls - CPU canvases pay per call);
 *  - after the clip: a 1 px outline (palette outline colour) just outside
 *    each surface, and 'decor' tiles standing on flat-ish top edges at
 *    style.decorDensity (default 0.2).
 * Ground pieces fill down to the world bottom and ceilings up to the top
 * (contract), and those closing edges get no surface.
 */

import { TILE_SIZE } from '../contracts';
import type { ArtApi, PixelCanvas, RampName, TerrainPiece, TerrainStyle, ThemeId, TileKind, Vec2 } from '../contracts';

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
  /** `fill` as a flat [x0, y0, x1, y1, ...] list. */
  flat: number[];
  surfaces: SurfaceEdge[];
  bbox: { x0: number; y0: number; x1: number; y1: number };
  seed: number;
}

/** 4x4 ordered-dither thresholds (0..1). */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

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
  const flat: number[] = [];
  for (const p of fill) flat.push(p.x, p.y);
  return { id: piece.id, style: piece.style, fill, flat, surfaces, bbox: { x0, y0, x1, y1 }, seed: piece.style.variantSeed ?? hashStr(piece.id) };
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Img = CanvasImageSource;

/**
 * Tile lookup with mirrored side tiles cached.
 * Canvas backing (audit round 3, L12): the chunk canvases are CPU-backed (willReadFrequently,
 * terrainView.ts), so every drawImage source should be CPU-side too or the browser may read a
 * GPU canvas back per draw. The mirrored tiles are ours: created willReadFrequently. The art
 * tiles (art.getTile -> pixToCanvas) are left as they are: tiny (16 px) canvases written once by
 * putImageData and never drawn into, below the size browsers accelerate canvases at, and shared
 * with the sprite pipeline - copying them here would only add a cache.
 */
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

  /** CSS colour of shade `i` (clamped, dark -> light) of the theme's `ramp`. */
  rampColor(ramp: RampName, i: number): string {
    const pal = this.art.palettes[this.theme];
    const r = pal.ramps[ramp];
    const idx = r[Math.max(0, Math.min(r.length - 1, i))] ?? pal.outline;
    return '#' + (pal.colors[idx] ?? 0x000000).toString(16).padStart(6, '0');
  }

  tile(kind: TileKind, v: number): Img {
    return this.art.getTile(this.theme, kind, v) as Img;
  }

  sideMirrored(kind: TileKind, v: number): Img {
    const key = `${kind}|${v % 4}`;
    let c = this.mirrored.get(key);
    if (!c) {
      c = this.makeCanvas(T, T);
      const ctx = c.getContext('2d', { willReadFrequently: true }) as Ctx; // CPU-backed like the chunk canvases it is drawn into
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

/** Whether paintPieces could draw anything inside `r` (cheap bbox test; lets callers skip empty chunks). */
export function piecesTouch(pieces: readonly PreparedPiece[], r: PaintRect): boolean {
  for (const p of pieces) if (overlaps(p, r, T * 2)) return true;
  return false;
}

/**
 * Paint `pieces` into `ctx` (already translated so world coords draw in
 * place), limited to `r`. Returns whether anything was drawn. `cracks`:
 * world rects (brittle regions) whose rock surfaces get crack art, painted
 * inside the piece clip so it never spills into open air.
 */
/**
 * Reach (px) of anything painted for a surface edge beyond the edge line
 * itself: strip tiles (T), decor standing on it (T), outline (1), cracks
 * (≤ 19 px into the solid). Edges farther than this from the paint rect
 * contribute no pixels and are skipped (frame budget: a long edge above or
 * below a chunk used to issue one clipped-away drawImage per pixel column).
 */
const EDGE_REACH = 2 * T + 4;
/**
 * Reach (px) of one crack ALONG its surface from its anchor: up to 19 steps
 * with ±1 sideways jitter each, plus a 3 px branch (+ the 1 px highlight).
 */
const CRACK_REACH = 24;

/** Whether anything painted for edge `e` can land inside `r`. */
function edgeNear(e: SurfaceEdge, r: PaintRect): boolean {
  const { a, b } = e;
  return (
    Math.max(a.x, b.x) + EDGE_REACH >= r.x &&
    Math.min(a.x, b.x) - EDGE_REACH <= r.x + r.w &&
    Math.max(a.y, b.y) + EDGE_REACH >= r.y &&
    Math.min(a.y, b.y) - EDGE_REACH <= r.y + r.h
  );
}

export function paintPieces(ctx: Ctx, pieces: readonly PreparedPiece[], tiles: TileSource, r: PaintRect, cracks: readonly PaintRect[] = []): boolean {
  draws = 0;
  hitR = r;
  ctx.imageSmoothingEnabled = false;
  for (const p of pieces) {
    if (!overlaps(p, r, T * 2)) continue;
    const mat = p.style.material;
    paintClipped(ctx, p, mat, tiles, r, cracks);
    if (p.style.surface !== false) {
      ctx.fillStyle = tiles.outline;
      for (const e of p.surfaces) if (edgeNear(e, r)) paintOutline(ctx, e, r);
      const density = p.style.decorDensity ?? 0.2;
      if (density > 0) for (const e of p.surfaces) if (e.n.y <= -0.85 && edgeNear(e, r)) paintDecor(ctx, e, mat, p.seed, density, tiles, r);
    }
  }
  return draws > 0;
}

/** Everything painted inside the piece's solid outline. */
function paintClipped(ctx: Ctx, p: PreparedPiece, mat: string, tiles: TileSource, r: PaintRect, cracks: readonly PaintRect[]): void {
  const poly = p.flat;
  ctx.save();
  // the outline as a cached Path2D: a long wall is ~300 vertices, and re-issuing them per band
  // was a measurable share of a band on CPU canvases (same geometry -> same pixels)
  const path = outlinePath(p);
  if (path) ctx.clip(path);
  else {
    ctx.beginPath();
    ctx.moveTo(poly[0]!, poly[1]!);
    for (let k = 2; k < poly.length; k += 2) ctx.lineTo(poly[k]!, poly[k + 1]!);
    ctx.closePath();
    ctx.clip();
  }
  // fill grid
  const gx0 = Math.floor(Math.max(r.x, p.bbox.x0) / T);
  const gx1 = Math.floor(Math.min(r.x + r.w, p.bbox.x1) / T);
  const gy0 = Math.floor(Math.max(r.y, p.bbox.y0) / T);
  const gy1 = Math.floor(Math.min(r.y + r.h, p.bbox.y1) / T);
  const fillKind = `${mat}:fill` as TileKind;
  for (let gy = gy0; gy <= gy1; gy++) {
    // only the tiles the outline can reach in this tile row (x-extent of the outline inside the
    // row, +1 px for anti-aliasing): a wall's bbox spans the open shaft beside it, and tiles there
    // would be clipped away entirely - same pixels, far fewer draws
    slabExtent(poly, gy * T - 1, gy * T + T + 1);
    if (!(slabLo <= slabHi)) continue;
    const ax = Math.max(gx0, Math.floor((slabLo - 1) / T));
    const bx = Math.min(gx1, Math.floor((slabHi + 1) / T));
    for (let gx = ax; gx <= bx; gx++) ctx.drawImage(tiles.tile(fillKind, hash(gx, gy, p.seed) & 3), gx * T, gy * T);
    // counted only when the solid really reaches the rect in this row (+1 px anti-aliasing): a
    // drawn tile can lie wholly outside the rect or the outline (the drawn range is inclusive)
    if (draws === 0 && ax <= bx) {
      const x0 = Math.max(ax * T, r.x) - 1;
      const x1 = Math.min(bx * T + T, r.x + r.w) + 1;
      const y0 = Math.max(gy * T, r.y) - 1;
      const y1 = Math.min(gy * T + T, r.y + r.h) + 1;
      if (x0 < x1 && y0 < y1 && polyTouchesRect(poly, x0, y0, x1, y1)) draws++;
    }
  }
  if (p.style.surface !== false) for (const e of p.surfaces) if (edgeNear(e, r)) paintStrip(ctx, e, mat, p.seed, tiles, r);
  for (const z of cracks) for (const e of p.surfaces) if (edgeNear(e, r)) paintCracks(ctx, e, z, p.seed, tiles, r);
  ctx.restore();
}

/** slabExtent() result: x-range of the outline within a horizontal slab (lo > hi = none). */
let slabLo = 0;
let slabHi = 0;

/**
 * X-extent of closed polygon `poly` (flat x,y list) inside the slab
 * y0..y1. A bounded region's horizontal extremes inside a slab lie on its
 * edges, so the extent of the edge pieces within the slab is exact.
 */
function slabExtent(poly: readonly number[], y0: number, y1: number): void {
  let lo = Infinity;
  let hi = -Infinity;
  const n = poly.length;
  for (let k = 0, j = n - 2; k < n; j = k, k += 2) {
    const ax = poly[j]!;
    const ay = poly[j + 1]!;
    const bx = poly[k]!;
    const by = poly[k + 1]!;
    if ((ay < y0 && by < y0) || (ay > y1 && by > y1)) continue;
    let xa = ax;
    let xb = bx;
    if (ay !== by) {
      // the segment's part inside the slab
      const ta = Math.min(1, Math.max(0, (y0 - ay) / (by - ay)));
      const tb = Math.min(1, Math.max(0, (y1 - ay) / (by - ay)));
      xa = ax + (bx - ax) * ta;
      xb = ax + (bx - ax) * tb;
    }
    lo = Math.min(lo, xa, xb);
    hi = Math.max(hi, xa, xb);
  }
  slabLo = lo;
  slabHi = hi;
}

/** Draws by the current paintPieces() that land in its rect (its return value: did anything land). */
let draws = 0;
/** The current paintPieces() rect. */
let hitR: PaintRect = { x: 0, y: 0, w: 0, h: 0 };

/** Count a draw whose destination rect overlaps the paint rect (a draw wholly outside it changes no pixel there). */
function hit(x: number, y: number, w: number, h: number): void {
  const r = hitR;
  if (x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y) draws++;
}

/** Whether closed polygon `poly` (flat x,y list) overlaps the rect x0..x1 × y0..y1. */
function polyTouchesRect(poly: readonly number[], x0: number, y0: number, x1: number, y1: number): boolean {
  const n = poly.length;
  let inside = false;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  for (let k = 0, j = n - 2; k < n; j = k, k += 2) {
    const ax = poly[j]!;
    const ay = poly[j + 1]!;
    const bx = poly[k]!;
    const by = poly[k + 1]!;
    // segment a-b vs the rect (Liang-Barsky)
    let t0 = 0;
    let t1 = 1;
    const dx = bx - ax;
    const dy = by - ay;
    const clipT = (pp: number, q: number): boolean => {
      if (pp === 0) return q >= 0;
      const t = q / pp;
      if (pp < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
      return true;
    };
    if (clipT(-dx, ax - x0) && clipT(dx, x1 - ax) && clipT(-dy, ay - y0) && clipT(dy, y1 - ay)) return true;
    // even-odd: the rect centre inside the polygon (the rect lies wholly inside when no edge crosses it)
    if (ay > cy !== by > cy && cx < ((bx - ax) * (cy - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

const paths = new WeakMap<PreparedPiece, Path2D>();
/** The piece's outline as a Path2D (built once); null where Path2D does not exist (Node tests). */
function outlinePath(p: PreparedPiece): Path2D | null {
  if (typeof Path2D === 'undefined') return null;
  let path = paths.get(p);
  if (!path) {
    path = new Path2D();
    const f = p.flat;
    path.moveTo(f[0]!, f[1]!);
    for (let k = 2; k < f.length; k += 2) path.lineTo(f[k]!, f[k + 1]!);
    path.closePath();
    paths.set(p, path);
  }
  return path;
}

function paintStrip(ctx: Ctx, e: SurfaceEdge, mat: string, seed: number, tiles: TileSource, r: PaintRect): void {
  const { a, b } = e;
  if (e.role !== 'side') {
    const xa = Math.min(a.x, b.x);
    const xb = Math.max(a.x, b.x);
    const x0 = Math.max(Math.floor(xa), Math.floor(r.x) - 1);
    const x1 = Math.min(Math.ceil(xb), Math.ceil(r.x + r.w) + 1);
    const kind = `${mat}:${e.role}` as TileKind;
    const top = e.role === 'top';
    const ry0 = r.y - T - 1;
    const ry1 = r.y + r.h + 1;
    // a run of adjacent columns with the same tile and target row is one drawImage
    let runImg: Img | null = null;
    let runX = 0;
    let runSx = 0;
    let runY = 0;
    let runN = 0;
    for (let x = x0; x < x1; x++) {
      const y = lerpAt(a, b, x + 0.5, 'x');
      if (y < ry0 || y > ry1 + T) continue; // this column's T px strip misses the rect
      const img = tiles.tile(kind, hash(Math.floor(x / T), seed, 7) & 3);
      const sx = ((x % T) + T) % T;
      const dy = top ? Math.floor(y) : Math.ceil(y) - T;
      if (runN > 0 && img === runImg && dy === runY && x === runX + runN && sx === runSx + runN) {
        runN++;
        continue;
      }
      if (runN > 0) {
        ctx.drawImage(runImg!, runSx, 0, runN, T, runX, runY, runN, T);
        hit(runX, runY, runN, T);
      }
      runImg = img;
      runX = x;
      runSx = sx;
      runY = dy;
      runN = 1;
    }
    if (runN > 0) {
      ctx.drawImage(runImg!, runSx, 0, runN, T, runX, runY, runN, T);
      hit(runX, runY, runN, T);
    }
  } else {
    const ya = Math.min(a.y, b.y);
    const yb = Math.max(a.y, b.y);
    const y0 = Math.max(Math.floor(ya), Math.floor(r.y) - 1);
    const y1 = Math.min(Math.ceil(yb), Math.ceil(r.y + r.h) + 1);
    const kind = `${mat}:side` as TileKind;
    const right = e.n.x > 0; // surface faces right: mirror (side tiles face left)
    const rx0 = r.x - T - 1;
    const rx1 = r.x + r.w + T + 1;
    // a run of adjacent rows with the same tile and target column is one drawImage
    let runImg: Img | null = null;
    let runY = 0;
    let runSy = 0;
    let runX = 0;
    let runN = 0;
    for (let y = y0; y < y1; y++) {
      const x = lerpAt(a, b, y + 0.5, 'y');
      if (x < rx0 || x > rx1) continue; // this row's T px strip misses the rect
      const v = hash(Math.floor(y / T), seed, 11) & 3;
      const sy = ((y % T) + T) % T;
      const img = right ? tiles.sideMirrored(kind, v) : tiles.tile(kind, v);
      const dx = right ? Math.ceil(x) - T : Math.floor(x);
      if (runN > 0 && img === runImg && dx === runX && y === runY + runN && sy === runSy + runN) {
        runN++;
        continue;
      }
      if (runN > 0) {
        ctx.drawImage(runImg!, 0, runSy, T, runN, runX, runY, T, runN);
        hit(runX, runY, T, runN);
      }
      runImg = img;
      runY = y;
      runSy = sy;
      runX = dx;
      runN = 1;
    }
    if (runN > 0) {
      ctx.drawImage(runImg!, 0, runSy, T, runN, runX, runY, T, runN);
      hit(runX, runY, T, runN);
    }
  }
}

function paintOutline(ctx: Ctx, e: SurfaceEdge, r: PaintRect): void {
  const { a, b } = e;
  if (e.role !== 'side') {
    const x0 = Math.max(Math.floor(Math.min(a.x, b.x)), Math.floor(r.x) - 1);
    const x1 = Math.min(Math.ceil(Math.max(a.x, b.x)), Math.ceil(r.x + r.w) + 1);
    // a run of adjacent pixels on the same row is one fillRect
    let runX = x0;
    let runY = 0;
    let runN = 0;
    for (let x = x0; x < x1; x++) {
      const y = lerpAt(a, b, x + 0.5, 'x');
      const py = e.role === 'top' ? Math.floor(y) - 1 : Math.ceil(y);
      if (runN > 0 && py === runY) {
        runN++;
        continue;
      }
      if (runN > 0) {
        ctx.fillRect(runX, runY, runN, 1);
        hit(runX, runY, runN, 1);
      }
      runX = x;
      runY = py;
      runN = 1;
    }
    if (runN > 0) {
      ctx.fillRect(runX, runY, runN, 1);
      hit(runX, runY, runN, 1);
    }
  } else {
    const y0 = Math.max(Math.floor(Math.min(a.y, b.y)), Math.floor(r.y) - 1);
    const y1 = Math.min(Math.ceil(Math.max(a.y, b.y)), Math.ceil(r.y + r.h) + 1);
    // a run of adjacent pixels in the same column is one fillRect
    let runY = y0;
    let runX = 0;
    let runN = 0;
    for (let y = y0; y < y1; y++) {
      const x = lerpAt(a, b, y + 0.5, 'y');
      const px = e.n.x > 0 ? Math.ceil(x) : Math.floor(x) - 1;
      if (runN > 0 && px === runX) {
        runN++;
        continue;
      }
      if (runN > 0) {
        ctx.fillRect(runX, runY, 1, runN);
        hit(runX, runY, 1, runN);
      }
      runY = y;
      runX = px;
      runN = 1;
    }
    if (runN > 0) {
      ctx.fillRect(runX, runY, 1, runN);
      hit(runX, runY, 1, runN);
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
    hit(x, y - T + 1, T, T);
  }
}

/**
 * Brittle rock (S8): along the part of surface `e` inside zone `z`, a
 * crumbling rim (a warm dithered band + glints just inside the surface)
 * and hashed pixel cracks running 8-19 px into the solid, some
 * with a short branch. Deterministic per edge / seed; clipped by the caller.
 *
 * Every pixel is a pure function of the edge, zone and seed - never of the
 * paint rect `r`, which only bounds the work: the crack walk always starts
 * at the zone / edge start (skipping, without drawing, the anchors too far
 * from `r` to reach it), so a chunk painted in bands, or split differently
 * into chunks, gets exactly the same pixels as one full-chunk paint.
 */
function paintCracks(ctx: Ctx, e: SurfaceEdge, z: PaintRect, seed: number, tiles: TileSource, r: PaintRect): void {
  const horiz = e.role !== 'side';
  const axis = horiz ? 'x' : 'y';
  const ea = horiz ? e.a.x : e.a.y;
  const eb = horiz ? e.b.x : e.b.y;
  const za = horiz ? z.x : z.y;
  const zb = horiz ? z.x + z.w : z.y + z.h;
  // the art's own extent along the surface: independent of the paint rect
  const lo0 = Math.max(Math.min(ea, eb), za);
  const hi0 = Math.min(Math.max(ea, eb), zb);
  // anchors farther than CRACK_REACH along the surface from `r` cannot touch it
  const ra = (horiz ? r.x : r.y) - CRACK_REACH;
  const rb = (horiz ? r.x + r.w : r.y + r.h) + CRACK_REACH;
  const lo = Math.max(lo0, ra);
  const hi = Math.min(hi0, rb);
  if (!(lo < hi)) return;
  const ix = -e.n.x; // into the solid
  const iy = -e.n.y;
  const inZone = (x: number, y: number) => x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h;
  const at = (u: number): Vec2 => {
    const o = lerpAt(e.a, e.b, u, axis);
    return horiz ? { x: u, y: o } : { x: o, y: u };
  };
  const dark = tiles.outline;
  const shade = tiles.rampColor('shadow', 2);
  const warm = tiles.rampColor('light', 0);
  const glint = tiles.rampColor('light', 2);
  const hilite = tiles.rampColor('primary', 3);
  const dot = (x: number, y: number) => {
    ctx.fillRect(x, y, 1, 1);
    hit(x, y, 1, 1);
  };
  // crumbling rim: a warm dithered band fading 5 px into the rock, dark
  // speckles on the surface row, and sparse glints
  for (let u = Math.floor(lo); u < hi; u++) {
    const q = at(u + 0.5);
    const h = hash(u, seed, 31);
    for (let k = 1; k <= 5; k++) {
      const x = Math.floor(q.x + ix * k);
      const y = Math.floor(q.y + iy * k);
      if (!inZone(x, y)) continue;
      const b = BAYER[(y & 3) * 4 + (x & 3)]!;
      if (k === 1 && (u & 1) === 0) {
        ctx.fillStyle = shade;
        dot(x, y);
      } else if (b < 0.6 * (1 - k / 6)) {
        ctx.fillStyle = warm;
        dot(x, y);
      }
    }
    if ((h & 7) === 0) {
      ctx.fillStyle = glint;
      dot(Math.floor(q.x + ix * (2 + (h >>> 3) % 4)), Math.floor(q.y + iy * (2 + (h >>> 3) % 4)));
    }
  }
  // cracks
  const px = -iy; // along the surface
  const py = ix;
  let u = Math.floor(lo0) + (hash(seed, Math.floor(za), 41) % 6);
  while (u < hi) {
    const h = hash(u, seed, 37);
    const q = at(u + 0.5);
    if (u >= ra && inZone(q.x, q.y)) {
      const depth = 8 + (h % 12);
      let x = q.x + ix;
      let y = q.y + iy;
      for (let k = 0; k < depth; k++) {
        ctx.fillStyle = dark;
        dot(Math.floor(x), Math.floor(y));
        ctx.fillStyle = hilite;
        dot(Math.floor(x + px), Math.floor(y + py));
        const j = (h >>> (4 + k)) & 3; // jitter sideways now and then
        const side = j === 1 ? 1 : j === 2 ? -1 : 0;
        x += ix + px * side;
        y += iy + py * side;
        if (k === (depth >> 1) && (h & 0x40000) !== 0) {
          // short branch
          const bs = h & 0x80000 ? 1 : -1;
          ctx.fillStyle = dark;
          for (let b = 1; b <= 3; b++) dot(Math.floor(x + (ix + px * bs) * b), Math.floor(y + (iy + py * bs) * b));
        }
      }
    }
    u += 6 + ((h >>> 12) % 8);
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

/**
 * TEST-ONLY reference terrain painter: the straightforward inner loops of the
 * terrain painter as of commit 830854b (before the stutter-round-3
 * optimisations) - per-column / per-row strips, per-cell fill over the whole
 * bbox, no slab culling, no run merging, outline clip re-issued as a path.
 * terrainTiles.reference.test.ts compares the optimised painter against it
 * pixel for pixel. Do not optimise this file.
 */
/* eslint-disable */
import { TILE_SIZE } from '../../src/contracts';
import type { TileKind, Vec2 } from '../../src/contracts';
import type { PaintRect, PreparedPiece, SurfaceEdge, TileSource } from '../../src/render/terrainTiles';

const T = TILE_SIZE;
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

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

function overlaps(p: PreparedPiece, r: PaintRect, pad: number): boolean {
  return p.bbox.x1 + pad >= r.x && p.bbox.x0 - pad <= r.x + r.w && p.bbox.y1 + pad >= r.y && p.bbox.y0 - pad <= r.y + r.h;
}


const EDGE_REACH = 2 * T + 4;
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

export function paintPiecesReference(ctx: Ctx, pieces: readonly PreparedPiece[], tiles: TileSource, r: PaintRect, cracks: readonly PaintRect[] = []): boolean {
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
    if (p.style.surface !== false) for (const e of p.surfaces) if (edgeNear(e, r)) paintStrip(ctx, e, mat, p.seed, tiles, r);
    for (const z of cracks) for (const e of p.surfaces) if (edgeNear(e, r)) paintCracks(ctx, e, z, p.seed, tiles, r);
    ctx.restore();
    if (p.style.surface !== false) {
      ctx.fillStyle = tiles.outline;
      for (const e of p.surfaces) if (edgeNear(e, r)) paintOutline(ctx, e, r);
      const density = p.style.decorDensity ?? 0.2;
      if (density > 0) for (const e of p.surfaces) if (e.n.y <= -0.85 && edgeNear(e, r)) paintDecor(ctx, e, mat, p.seed, density, tiles, r);
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
    const ry0 = r.y - T - 1;
    const ry1 = r.y + r.h + 1;
    for (let x = x0; x < x1; x++) {
      const y = lerpAt(a, b, x + 0.5, 'x');
      if (y < ry0 || y > ry1 + T) continue; // this column's T px strip misses the rect
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
    const rx0 = r.x - T - 1;
    const rx1 = r.x + r.w + T + 1;
    for (let y = y0; y < y1; y++) {
      const x = lerpAt(a, b, y + 0.5, 'y');
      if (x < rx0 || x > rx1) continue; // this row's T px strip misses the rect
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
        ctx.fillRect(x, y, 1, 1);
      } else if (b < 0.6 * (1 - k / 6)) {
        ctx.fillStyle = warm;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    if ((h & 7) === 0) {
      ctx.fillStyle = glint;
      ctx.fillRect(Math.floor(q.x + ix * (2 + (h >>> 3) % 4)), Math.floor(q.y + iy * (2 + (h >>> 3) % 4)), 1, 1);
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
        ctx.fillRect(Math.floor(x), Math.floor(y), 1, 1);
        ctx.fillStyle = hilite;
        ctx.fillRect(Math.floor(x + px), Math.floor(y + py), 1, 1);
        const j = (h >>> (4 + k)) & 3; // jitter sideways now and then
        const side = j === 1 ? 1 : j === 2 ? -1 : 0;
        x += ix + px * side;
        y += iy + py * side;
        if (k === (depth >> 1) && (h & 0x40000) !== 0) {
          // short branch
          const bs = h & 0x80000 ? 1 : -1;
          ctx.fillStyle = dark;
          for (let b = 1; b <= 3; b++) ctx.fillRect(Math.floor(x + (ix + px * bs) * b), Math.floor(y + (iy + py * bs) * b), 1, 1);
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

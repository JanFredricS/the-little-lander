/**
 * Nature generators shared by props, backdrops and cutscene stills:
 * cluster-dithered foliage clumps (pixel-jungle ref), floating islands with
 * striated karst rock, hanging roots and waterfalls (floating-islands refs),
 * puffy clouds, palm trees, mountains/ridges.
 *
 * They take explicit RAMPS (index lists) rather than a palette so the same
 * code draws into theme palettes and per-still palettes alike.
 */

import { Pix } from './core/pix';
import { bayer, rampAt } from './core/palette';
import { fbm, valueNoise } from './core/noise';
import { hash2, mulberry32 } from './core/rng';

export interface NatureRamps {
  rock: readonly number[];
  foliage: readonly number[];
  water: readonly number[];
  /** Outline / deepest shadow. */
  out: number;
}

/**
 * A clump of foliage: many small lit balls, drawn bottom-up so the upper
 * ones overlap (reads as leafy canopy). Light from the upper left.
 */
export function foliageClump(p: Pix, cx: number, cy: number, w: number, h: number, ramp: readonly number[], seed: number, opts: { ball?: number; count?: number; dark?: number } = {}): void {
  const rng = mulberry32(seed);
  const ball = opts.ball ?? Math.max(2, Math.min(w, h) / 5);
  const count = opts.count ?? Math.max(4, Math.floor((w * h) / (ball * ball * 1.6)));
  const balls: [number, number, number][] = [];
  for (let i = 0; i < count; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(rng.next());
    balls.push([cx + Math.cos(a) * r * (w / 2 - ball * 0.6), cy + Math.sin(a) * r * (h / 2 - ball * 0.6), ball * rng.range(0.7, 1.25)]);
  }
  balls.sort((a, b) => b[1] - a[1]);
  const dark = opts.dark ?? 0;
  for (const [bx, by, br] of balls) {
    const vert = (by - (cy - h / 2)) / h; // 0 top .. 1 bottom
    p.ellipse(bx, by, br, br * 0.85, (x, y, nx, ny) => {
      const leaf = (hash2(x, y, seed) - 0.5) * 0.35;
      const t = 0.62 - nx * 0.3 - ny * 0.45 - vert * 0.45 - dark + leaf;
      return rampAt(ramp, t, x, y, 0.45);
    });
  }
}

/** Hanging strand (root / vine) with a gentle sway, from (x, y) down `len` px. */
export function strand(p: Pix, x: number, y: number, len: number, c: number, seed: number, sway = 1.2, leaf?: number): void {
  const ph = hash2(1, 2, seed) * 6;
  for (let i = 0; i < len; i++) {
    const xx = x + Math.sin(ph + i * 0.18) * sway * (i / len);
    p.set(xx, y + i, c);
    if (leaf !== undefined && i > 2 && hash2(i, 3, seed) > 0.8) p.set(xx + (hash2(i, 4, seed) > 0.5 ? 1 : -1), y + i, leaf);
  }
}

/** Waterfall strip. `frame` scrolls the streaks. Draws only where `mask` passes (default everywhere). */
export function waterfall(p: Pix, x: number, y: number, w: number, h: number, water: readonly number[], frame: number, seed: number): void {
  for (let yy = 0; yy < h; yy++) {
    const spread = yy / h;
    const ww = w * (0.8 + spread * 0.5);
    const x0 = x + (w - ww) / 2;
    for (let xx = 0; xx < ww; xx++) {
      const px = Math.floor(x0 + xx);
      const col = Math.floor(xx);
      const streak = valueNoise(col * 0.9, (yy - frame * 4) / 6, seed);
      const edge = Math.min(xx, ww - 1 - xx) / Math.max(1, ww / 2);
      let t = 0.35 + streak * 0.6 + edge * 0.2;
      if (spread > 0.8 && bayer(px, y + yy) > 1 - (spread - 0.8) * 4) continue; // dissolves into mist
      if (xx < 1 || xx > ww - 2) t -= 0.25;
      p.set(px, y + yy, rampAt(water, t, px, y + yy, 0.5));
    }
  }
}

export interface IslandOpts {
  /** Canopy thickness (px). */
  canopy?: number;
  /** Number of hanging roots. */
  roots?: number;
  waterfall?: boolean;
  frame?: number;
  /** Depth of the rock body relative to width (default 0.8). */
  depth?: number;
  /** Draw the 1px outline. */
  outline?: boolean;
  /** Far islands: no detail, flat shading. */
  far?: boolean;
}

/**
 * A floating island: jungle canopy on top, striated rock tapering to a
 * point, hanging roots, optional waterfall. (cx, top) = centre of the top
 * surface; w = width.
 */
export function floatingIsland(p: Pix, cx: number, top: number, w: number, r: NatureRamps, seed: number, opts: IslandOpts = {}): void {
  const depth = w * (opts.depth ?? 0.8);
  const rng = mulberry32(seed);
  const tilt = rng.jitter(0.25);
  const body = new Pix(p.w, p.h);
  const rows = Math.ceil(depth);
  const halfAt = (t: number) => (w / 2) * (1 - Math.pow(t, 1.7)) * (1 - 0.35 * t);
  for (let i = 0; i < rows; i++) {
    const t = i / rows;
    const jitterL = (valueNoise(i / 3, 1, seed) - 0.5) * w * 0.14;
    const jitterR = (valueNoise(i / 3, 5, seed) - 0.5) * w * 0.14;
    const c = cx + tilt * i * 0.5;
    const hw = halfAt(t);
    for (let x = Math.floor(c - hw + jitterL); x <= Math.ceil(c + hw + jitterR); x++) {
      const nx = (x - c) / Math.max(1, hw);
      const stri = fbm(x / 1.5, i / 10, seed + 3, { scale: 4, octaves: 2 });
      let tt = opts.far ? 0.5 - nx * 0.2 - t * 0.2 : 0.62 - nx * 0.42 - t * 0.35 + (stri - 0.5) * 0.7;
      if (!opts.far && hash2(x, i, seed) > 0.97) tt -= 0.3;
      body.set(x, top + i, rampAt(r.rock, tt, x, top + i, 0.4));
    }
  }
  if (opts.outline !== false && !opts.far) body.outline(r.out);
  p.blit(body, 0, 0);

  // hanging roots from the underside
  const roots = opts.roots ?? Math.floor(w / 6);
  for (let i = 0; i < roots; i++) {
    const t = rng.range(0.05, 0.7);
    const side = rng.jitter(1);
    const x = cx + tilt * t * depth * 0.5 + side * halfAt(t) * 0.9;
    const y = top + t * depth;
    const len = rng.range(0.25, 0.7) * depth;
    strand(p, x, y, len, opts.far ? r.rock[0]! : r.foliage[0]!, seed + i, 2, opts.far ? undefined : r.foliage[1]);
  }

  // waterfall off one edge
  if (opts.waterfall) {
    const wx = cx + (rng.chance(0.5) ? -1 : 1) * w * rng.range(0.15, 0.3);
    waterfall(p, wx - 2, top + 1, Math.max(3, Math.round(w / 16)), Math.round(depth * 1.6), r.water, opts.frame ?? 0, seed + 9);
  }

  // canopy along the top
  const canopy = opts.canopy ?? Math.max(4, w * 0.16);
  const clumps = Math.max(2, Math.floor(w / Math.max(6, canopy)));
  for (let i = 0; i <= clumps; i++) {
    const fx = cx - w / 2 + (i / clumps) * w + rng.jitter(2);
    const size = canopy * rng.range(0.9, 1.6);
    if (opts.far) p.ellipse(fx, top - size * 0.1, size * 0.7, size * 0.45, r.foliage[1]!);
    else foliageClump(p, fx, top - size * 0.15, size * 1.3, size, r.foliage, seed + 100 + i);
  }
  if (!opts.far) {
    // grass lip overhanging the rock edge
    for (let x = Math.floor(cx - w / 2); x < cx + w / 2; x++) if (hash2(x, 7, seed) > 0.55) p.set(x, top + 1 + Math.floor(hash2(x, 8, seed) * 3), r.foliage[1]!);
  }
}

/** Puffy cumulus cloud (pixel-jungle ref): stacked balls, lit top, flat-ish base. */
export function cloud(p: Pix, cx: number, cy: number, w: number, h: number, ramp: readonly number[], seed: number): void {
  const rng = mulberry32(seed);
  const n = Math.max(3, Math.floor(w / (h * 0.6)));
  const balls: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const bump = Math.sin(t * Math.PI);
    balls.push([cx - w / 2 + t * w, cy - bump * h * 0.35 + rng.jitter(h * 0.1), (h / 2) * (0.55 + bump * 0.6) * rng.range(0.85, 1.1)]);
  }
  for (const [bx, by, br] of balls)
    p.ellipse(bx, by, br, br * 0.9, (x, y, nx, ny) => {
      if (y > cy + h * 0.3) return -1; // flat base
      return rampAt(ramp, 0.75 - ny * 0.35 - nx * 0.12, x, y, 0.5);
    });
}

/** Palm-like tropical tree: curved trunk + drooping fronds. Base at (x, base). */
export function palm(p: Pix, x: number, base: number, h: number, trunk: readonly number[], leaf: readonly number[], seed: number): void {
  const rng = mulberry32(seed);
  const lean = rng.jitter(0.35);
  let tx = x,
    ty = base;
  for (let i = 0; i < h; i++) {
    tx = x + lean * i + Math.sin(i / h * 2) * lean * 4;
    ty = base - i;
    p.set(tx, ty, trunk[i % 3 === 0 ? 0 : 1]!);
    p.set(tx + 1, ty, trunk[trunk.length - 1]!);
  }
  const fronds = 6;
  for (let f = 0; f < fronds; f++) {
    const a = -Math.PI / 2 + (f - (fronds - 1) / 2) * 0.55 + rng.jitter(0.1);
    const len = h * rng.range(0.45, 0.6);
    for (let k = 0; k < len; k++) {
      const t = k / len;
      const fx = tx + Math.cos(a) * k * 1.1;
      const fy = ty + Math.sin(a) * k * 0.7 + t * t * len * 0.7;
      p.set(fx, fy, rampAt(leaf, 0.8 - t * 0.6, Math.floor(fx), Math.floor(fy), 0.4));
      p.set(fx, fy + 1, leaf[0]!);
      if (k % 2 === 0) p.set(fx, fy + 2, leaf[Math.min(1, leaf.length - 1)]!);
    }
  }
}

/** A ridge line silhouette across [0,w): returns the top y per column (periodic when tile=true). */
export function ridgeProfile(w: number, base: number, amp: number, seed: number, scale: number, tile = true): number[] {
  const out: number[] = [];
  for (let x = 0; x < w; x++) out.push(base - fbm(x, 0.5, seed, { scale, octaves: 4, tileW: tile ? w : undefined }) * amp);
  return out;
}

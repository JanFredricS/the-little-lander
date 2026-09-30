/**
 * Reusable shaded shapes (all palette-index based): lit spheres, noisy rock
 * blobs, dithered gradients, glow halos, light overlays.
 */

import { Pix } from './pix';
import { bayer, rampAt } from './palette';
import { fbm, valueNoise } from './noise';
import { hash2 } from './rng';

export interface Light {
  /** Direction TO the light (screen space, y down). Default upper-left. */
  lx?: number;
  ly?: number;
  /** Dither band width 0..1 (rampAt). */
  bands?: number;
  /** Ambient floor 0..1. */
  ambient?: number;
}

/** Lambert-ish shaded ellipse. */
export function sphere(p: Pix, cx: number, cy: number, rx: number, ry: number, ramp: readonly number[], light: Light = {}): void {
  const lx = light.lx ?? -0.6;
  const ly = light.ly ?? -0.7;
  const ll = Math.hypot(lx, ly, 0.6);
  const amb = light.ambient ?? 0.12;
  p.ellipse(cx, cy, rx, ry, (x, y, nx, ny) => {
    const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    const d = (nx * lx + ny * ly + nz * 0.6) / ll;
    return rampAt(ramp, amb + (1 - amb) * Math.max(0, d), x, y, light.bands ?? 0.5);
  });
}

/**
 * Noise-perturbed rock blob with lighting from the upper left, a few cracks,
 * speckles. Returns nothing; draws in place. `rough` 0..1.
 */
export function rockBlob(
  p: Pix,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  seed: number,
  ramp: readonly number[],
  opts: { rough?: number; crack?: number; light?: Light; flatBottom?: boolean } = {},
): void {
  const rough = opts.rough ?? 0.35;
  const lx = opts.light?.lx ?? -0.6;
  const ly = opts.light?.ly ?? -0.75;
  const x0 = Math.floor(cx - rx - 2),
    x1 = Math.ceil(cx + rx + 2);
  const y0 = Math.floor(cy - ry - 2),
    y1 = Math.ceil(cy + ry + 2);
  const inside = (x: number, y: number) => {
    const nx = (x + 0.5 - cx) / rx;
    let ny = (y + 0.5 - cy) / ry;
    if (opts.flatBottom && ny > 0) ny *= 0.6;
    const a = Math.atan2(ny, nx);
    const n = valueNoise(Math.cos(a) * 1.8 + 10, Math.sin(a) * 1.8 + 10, seed) - 0.5;
    return nx * nx + ny * ny <= 1 + n * rough * 2;
  };
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (!inside(x, y)) continue;
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      // pseudo-normal from position + surface noise (faceted look)
      const facet = fbm(x, y, seed + 5, { scale: Math.max(3, Math.min(rx, ry) * 0.6), octaves: 2 }) - 0.5;
      let t = 0.55 + (nx * lx + ny * ly) * 0.55 + facet * 0.55;
      // edge-dark (ambient occlusion toward the rim, away from light)
      if (!inside(x - Math.sign(lx), y - Math.sign(ly))) t += 0.18;
      if (!inside(x + Math.sign(lx), y + Math.sign(ly))) t -= 0.15;
      p.set(x, y, rampAt(ramp, t, x, y, opts.light?.bands ?? 0.4));
    }
  // cracks: short random walks in the darkest shade
  const cracks = opts.crack ?? 0;
  for (let i = 0; i < cracks; i++) {
    let x = cx + (hash2(i, 1, seed) - 0.5) * rx;
    let y = cy + (hash2(i, 2, seed) - 0.5) * ry;
    let a = hash2(i, 3, seed) * Math.PI * 2;
    const len = 3 + hash2(i, 4, seed) * Math.min(rx, ry);
    for (let k = 0; k < len; k++) {
      if (!inside(Math.floor(x), Math.floor(y))) break;
      p.set(x, y, ramp[0]!);
      a += (hash2(i, k + 10, seed) - 0.5) * 1.2;
      x += Math.cos(a);
      y += Math.sin(a);
    }
  }
}

/** Vertical dithered gradient over a rect through a ramp (t from top to bottom). */
export function vGradient(p: Pix, x: number, y: number, w: number, h: number, ramp: readonly number[], t0 = 0, t1 = 1, bands = 0.8): void {
  for (let yy = 0; yy < h; yy++) {
    const t = t0 + (t1 - t0) * (yy / Math.max(1, h - 1));
    for (let xx = 0; xx < w; xx++) p.set(x + xx, y + yy, rampAt(ramp, t, x + xx, y + yy, bands));
  }
}

/** Solid radial halo painted (not remapped) through a ramp: bright centre -> dithered edge. */
export function halo(p: Pix, cx: number, cy: number, r: number, ramp: readonly number[], opts: { core?: number; onlyOver?: boolean } = {}): void {
  p.apply(
    (x, y, cur) => {
      if (opts.onlyOver && cur === 0) return -1;
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
      if (d >= 1) return -1;
      const t = 1 - d;
      if (t < 0.35 && t / 0.35 < bayer(x, y)) return -1;
      return rampAt(ramp, Math.min(1, t * (opts.core ?? 1.3)), x, y, 0.7);
    },
    cx - r - 1,
    cy - r - 1,
    r * 2 + 2,
    r * 2 + 2,
  );
}

/** A new buffer (helper to keep call sites short). */
export const pix = (w: number, h: number) => new Pix(w, h);

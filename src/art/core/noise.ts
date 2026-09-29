/**
 * Value noise (optionally periodic, for seamless tiles and tiling backdrop
 * strips) + fractal sum. Deterministic via hash2.
 */

import { hash2 } from './rng';

const smooth = (t: number) => t * t * (3 - 2 * t);
const mod = (a: number, n: number) => ((a % n) + n) % n;

/**
 * Value noise in [0,1]. Lattice spacing 1. If `periodX`/`periodY` (in lattice
 * cells) are given, the noise repeats with that period.
 */
export function valueNoise(x: number, y: number, seed: number, periodX = 0, periodY = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = smooth(x - xi);
  const fy = smooth(y - yi);
  const wx = (i: number) => (periodX > 0 ? mod(i, periodX) : i);
  const wy = (j: number) => (periodY > 0 ? mod(j, periodY) : j);
  const a = hash2(wx(xi), wy(yi), seed);
  const b = hash2(wx(xi + 1), wy(yi), seed);
  const c = hash2(wx(xi), wy(yi + 1), seed);
  const d = hash2(wx(xi + 1), wy(yi + 1), seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/**
 * Fractal value noise in [0,1]. `scale` = pixels per lattice cell at the base
 * octave. With `tileW`/`tileH` (px) the result tiles seamlessly at that size
 * (tileW must be a multiple of scale for exact periodicity).
 */
export function fbm(
  x: number,
  y: number,
  seed: number,
  opts: { scale?: number; octaves?: number; gain?: number; tileW?: number; tileH?: number } = {},
): number {
  const scale = opts.scale ?? 8;
  const octaves = opts.octaves ?? 3;
  const gain = opts.gain ?? 0.5;
  let amp = 1;
  let sum = 0;
  let norm = 0;
  let s = scale;
  for (let o = 0; o < octaves; o++) {
    const px = opts.tileW ? Math.max(1, Math.round(opts.tileW / s)) : 0;
    const py = opts.tileH ? Math.max(1, Math.round(opts.tileH / s)) : 0;
    sum += amp * valueNoise(x / s, y / s, seed + o * 1013, px, py);
    norm += amp;
    amp *= gain;
    s /= 2;
  }
  return sum / norm;
}

/** 1D periodic ridge profile helper: fbm sampled along x only. */
export function ridge(x: number, seed: number, scale: number, octaves = 4, tileW = 0): number {
  return fbm(x, 0.5, seed, { scale, octaves, tileW: tileW || undefined });
}

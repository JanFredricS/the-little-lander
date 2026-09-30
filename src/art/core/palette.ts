/**
 * Palette helpers: the generic palette shape used by every generator (theme
 * palettes, the shared craft palette, per-still palettes), ramp walking,
 * ordered dithering, and derived remap tables (lighten / darken / nearest).
 */

import type { Rgb } from '../../contracts';

/** Minimal palette shape shared by theme palettes and non-theme palettes. */
export interface ArtPalette {
  name: string;
  /** Index 0 is transparent. */
  colors: readonly Rgb[];
  /** Named ramps, dark -> light. */
  ramps: Readonly<Record<string, readonly number[]>>;
  outline: number;
}

// --------------------------------------------------------------- dithering

/** 4×4 Bayer matrix, values 0..15. */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Ordered-dither threshold in (0,1) for pixel (x, y). */
export function bayer(x: number, y: number): number {
  return (BAYER4[(y & 3) * 4 + (x & 3)]! + 0.5) / 16;
}

/** True with "probability" t, as an ordered-dither pattern. */
export function dither(x: number, y: number, t: number): boolean {
  return t > bayer(x, y);
}

/**
 * Pick a ramp entry for brightness t ∈ [0,1] with ordered dithering between
 * the two nearest shades. `bands` < 1 narrows the dithered zone (0 = hard
 * bands, 1 = full-width dither).
 */
export function rampAt(ramp: readonly number[], t: number, x: number, y: number, bands = 0.5): number {
  const n = ramp.length;
  if (n === 1) return ramp[0]!;
  const pos = Math.min(n - 1, Math.max(0, t)) * (n - 1);
  let lo = Math.floor(pos);
  if (lo >= n - 1) return ramp[n - 1]!;
  let f = pos - lo;
  // squash the fraction so most of each band is flat, dither only near the step
  const half = bands / 2;
  f = f < 0.5 - half ? 0 : f > 0.5 + half ? 1 : (f - (0.5 - half)) / Math.max(1e-6, bands);
  if (f > bayer(x, y)) lo++;
  return ramp[lo]!;
}

// ------------------------------------------------------------ remap tables

/** Table mapping each index to itself. */
export function identityMap(p: ArtPalette): number[] {
  return p.colors.map((_, i) => i);
}

/**
 * Remap table moving each colour `steps` along whichever ramp contains it
 * (the first listed ramp wins). Colours in no ramp stay put.
 */
export function shiftMap(p: ArtPalette, steps: number, rampOrder?: readonly string[]): number[] {
  const t = identityMap(p);
  const names = rampOrder ?? Object.keys(p.ramps);
  const done = new Set<number>();
  for (const name of names) {
    const r = p.ramps[name];
    if (!r) continue;
    r.forEach((idx, k) => {
      if (done.has(idx)) return;
      done.add(idx);
      t[idx] = r[Math.min(r.length - 1, Math.max(0, k + steps))]!;
    });
  }
  return t;
}

function rgb(c: Rgb): [number, number, number] {
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}

/** Perceptually weighted squared distance. */
export function colorDist(a: Rgb, b: Rgb): number {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const rm = (r1 + r2) / 2;
  const dr = r1 - r2,
    dg = g1 - g2,
    db = b1 - b2;
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
}

/** Nearest palette index (excluding 0) for a colour. */
export function nearestIndex(p: ArtPalette, c: Rgb): number {
  let best = 1;
  let bd = Infinity;
  for (let i = 1; i < p.colors.length; i++) {
    const d = colorDist(p.colors[i]!, c);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** Remap table from palette `src` into palette `dst` by nearest colour. */
export function crossMap(src: ArtPalette, dst: ArtPalette, overrides: Readonly<Record<number, number>> = {}): number[] {
  const t = src.colors.map((c, i) => (i === 0 ? 0 : nearestIndex(dst, c)));
  for (const [k, v] of Object.entries(overrides)) t[Number(k)] = v;
  return t;
}

/**
 * Terrain tiles (TILE_SIZE = 16): six materials × five roles per theme.
 *
 * Seamless by construction: the base texture of a material is periodic
 * noise with a 16 px period derived from the THEME seed only, so every
 * variant shares identical edges; `variantSeed` only adds interior details
 * (kept 2 px away from the borders: pebbles, cracks, rivets, glow specks).
 *
 * Surface roles reuse one "cap" function per material evaluated in
 * (depth, along) coordinates: top = cap(y, x), side = cap(x, y) (surface on
 * the LEFT edge; mirror for the right), bottom = underside cap(15-y, x).
 */

import { TILE_SIZE } from '../contracts';
import type { Palette, TerrainMaterial, ThemeId, TileKind, TileRole } from '../contracts';
import { Pix } from './core/pix';
import { bayer, rampAt, shiftMap } from './core/palette';
import { fbm, valueNoise } from './core/noise';
import { hash2, mulberry32, seedOf } from './core/rng';
import { PALETTES } from './palettes';

const T = TILE_SIZE;
const wrap = (v: number) => ((v % T) + T) % T;

export const TERRAIN_MATERIALS: readonly TerrainMaterial[] = ['metal', 'rock', 'soil', 'crystal', 'organic', 'ruin'];
export const TILE_ROLES: readonly TileRole[] = ['fill', 'top', 'bottom', 'side', 'decor'];

/** The theme's natural material per role family (used by the gallery ordering). */
export const THEME_MATERIALS: Readonly<Record<ThemeId, readonly TerrainMaterial[]>> = {
  hangar: ['metal', 'ruin'],
  asteroid: ['rock', 'crystal'],
  islands: ['soil', 'rock', 'organic'],
  caves: ['rock', 'crystal', 'organic'],
  core: ['soil', 'rock', 'organic'],
  boss: ['organic', 'rock'],
  collapse: ['ruin', 'metal', 'rock'],
};

interface Ramps {
  base: readonly number[]; // fill shades, dark -> light
  cap: readonly number[]; // surface shades
  detail: readonly number[]; // accent details
  moss: readonly number[];
  out: number;
}

function rampsFor(p: Palette, mat: TerrainMaterial, theme: ThemeId): Ramps {
  const R = p.ramps;
  const prim = R.primary;
  const base3 = prim.slice(0, Math.max(3, prim.length - 1));
  switch (mat) {
    case 'metal':
      return { base: prim.slice(0, 4), cap: prim.slice(-3), detail: R.accent, moss: R.foliage, out: p.outline };
    case 'rock':
      return { base: base3, cap: prim.slice(-3), detail: R.accent, moss: R.foliage, out: p.outline };
    case 'soil': {
      // islands/core soil is the warm primary; grass from foliage
      return { base: base3, cap: R.foliage, detail: prim.slice(-2), moss: R.foliage, out: p.outline };
    }
    case 'crystal':
      return {
        base: theme === 'asteroid' ? [R.foliage[0]!, R.foliage[1]!, R.foliage[2]!] : R.accent,
        cap: R.light,
        detail: R.light,
        moss: R.foliage,
        out: p.outline,
      };
    case 'organic':
      return theme === 'boss'
        ? { base: [R.primary[1]!, ...R.secondary], cap: R.secondary.slice(-2), detail: R.accent, moss: R.accent, out: p.outline }
        : { base: R.foliage.slice(0, 3), cap: R.foliage.slice(1), detail: R.accent, moss: R.foliage, out: p.outline };
    case 'ruin':
      return { base: base3, cap: prim.slice(-3), detail: R.accent, moss: R.foliage, out: p.outline };
  }
}

// ------------------------------------------------------------ base fills

function baseFill(mat: TerrainMaterial, r: Ramps, seed: number): Pix {
  const p = new Pix(T, T);
  const n = (x: number, y: number, s = 8, o = 3) => fbm(wrap(x), wrap(y), seed, { scale: s, octaves: o, tileW: T, tileH: T });
  switch (mat) {
    case 'rock':
      p.apply((x, y) => {
        const v = n(x, y);
        const g = n(x - 1, y - 1) - v; // lit from the upper left
        return rampAt(r.base, 0.45 + (v - 0.5) * 1.1 + g * 4.5, x, y, 0.35);
      });
      break;
    case 'soil':
      p.apply((x, y) => {
        const v = n(x, y, 8, 2);
        return rampAt(r.base.slice(0, 3), 0.42 + (v - 0.5) * 0.6, x, y, 0.3);
      });
      // pebbles on a periodic lattice
      for (let i = 0; i < 4; i++) {
        const px = Math.floor(hash2(i, 1, seed) * T);
        const py = Math.floor(hash2(i, 2, seed) * T);
        p.set(px, py, r.base[r.base.length - 1]!);
        p.set(wrap(px + 1), py, r.base[1]!);
        p.set(px, wrap(py + 1), r.base[0]!);
      }
      break;
    case 'metal':
      // two plates per tile, the lower row offset by half a tile
      p.apply((x, y) => {
        const row = y < 8 ? 0 : 1;
        const lx = wrap(x + (row ? 8 : 0));
        const ly = y % 8;
        const b = r.base;
        let c = b[2]!;
        if (ly === 0 || lx === 0) c = b[3]!;
        if (ly === 7 || lx === 15) c = b[0]!;
        else if (ly === 6 || lx === 14) c = b[1]!;
        if (c === b[2] && hash2(x, y, seed) > 0.93) c = b[1]!;
        return c;
      });
      for (const [x, y] of [
        [2, 2],
        [12, 2],
        [10, 10],
        [4, 10],
      ] as const)
        p.set(x, y, r.base[3]!).set(x + 1, y + 1, r.base[0]!);
      break;
    case 'crystal': {
      // periodic voronoi shards
      const pts = Array.from({ length: 6 }, (_, i) => [hash2(i, 7, seed) * T, hash2(i, 8, seed) * T, hash2(i, 9, seed)] as const);
      p.apply((x, y) => {
        let d1 = Infinity,
          d2 = Infinity,
          k = 0;
        for (const [px, py, v] of pts)
          for (const ox of [-T, 0, T])
            for (const oy of [-T, 0, T]) {
              const d = Math.hypot(x + 0.5 - px - ox, y + 0.5 - py - oy);
              if (d < d1) {
                d2 = d1;
                d1 = d;
                k = v;
              } else if (d < d2) d2 = d;
            }
        if (d2 - d1 < 0.55) return r.base[0]!;
        const t = 0.25 + k * 0.55 + (d1 < 2 ? 0.2 : 0) - (y / T) * 0.1;
        return rampAt(r.base, t, x, y, 0.3);
      });
      break;
    }
    case 'organic':
      p.apply((x, y) => {
        const v = n(x, y, 5, 2);
        const cell = Math.abs(v - 0.5);
        if (cell < 0.03) return r.base[0]!;
        const g = n(x - 1, y - 1, 5, 2) - v;
        return rampAt(r.base, 0.45 + g * 5 + (v - 0.5) * 0.4, x, y, 0.5);
      });
      break;
    case 'ruin':
      // ashlar courses: 4 rows of 4 px, bricks 8 wide, alternate rows offset
      p.apply((x, y) => {
        const row = Math.floor(y / 4);
        const lx = wrap(x + (row % 2) * 4);
        const brick = Math.floor(lx / 8) + row * 2;
        if (y % 4 === 3 || lx % 8 === 7) return r.base[0]!;
        const tone = hash2(brick, row, seed);
        let t = 0.35 + tone * 0.35;
        if (y % 4 === 0) t += 0.2;
        if (lx % 8 === 0) t += 0.1;
        return rampAt(r.base, t + (valueNoise(x / 2, y / 2, seed) - 0.5) * 0.25, x, y, 0.4);
      });
      break;
  }
  return p;
}

// --------------------------------------------------------------- caps

/**
 * Surface cap pixel at `depth` (0 = outermost row) and `along` (0..15, the
 * periodic direction). Returns 0 for transparent (above the surface), -1 to
 * keep the fill, or a palette index.
 */
function capPixel(mat: TerrainMaterial, r: Ramps, seed: number, depth: number, along: number): number {
  const edge = (amp: number, scale = 4) => Math.floor(fbm(along, 0.5, seed + 99, { scale, octaves: 2, tileW: T }) * amp);
  const cap = r.cap;
  switch (mat) {
    case 'rock': {
      const top = edge(3);
      if (depth < top) return 0;
      const d = depth - top;
      if (d === 0) return cap[cap.length - 1]!;
      if (d === 1) return cap[cap.length - 2]!;
      if (d === 2) return bayer(along, depth) < 0.5 ? cap[cap.length - 3]! : -1;
      return -1;
    }
    case 'soil': {
      // grass blades: per-column tip height, then a thick turf band, then shadow
      const tip = Math.floor(hash2(wrap(along), 3, seed) * 3) + (edge(2, 8) > 0 ? 1 : 0);
      if (depth < tip) return 0;
      const d = depth - tip;
      const turf = 5 - tip;
      if (d < turf) {
        const t = 1 - d / turf + (hash2(wrap(along), depth, seed) - 0.5) * 0.3;
        return rampAt(cap, t, along, depth, 0.6);
      }
      if (depth < 7) return r.moss[0]!; // shadow under the turf
      if (depth === 7 && bayer(along, depth) < 0.5) return r.moss[0]!;
      // hanging grass roots
      if (depth < 10 && hash2(wrap(along), 5, seed) > 0.8) return r.moss[0]!;
      return -1;
    }
    case 'metal': {
      if (depth === 0) return r.out;
      if (depth === 1) return cap[cap.length - 1]!;
      if (depth === 2) return cap[cap.length - 2]!;
      if (depth === 3) return r.base[0]!;
      // hazard / trim stripe
      if (depth >= 4 && depth <= 5) return (wrap(along) >> 2) % 2 === 0 ? r.detail[r.detail.length - 1]! : r.base[0]!;
      if (depth === 6) return r.base[0]!;
      return -1;
    }
    case 'crystal': {
      // jagged crystal points
      const phase = wrap(along) % 8;
      const spike = phase < 4 ? phase : 8 - phase;
      const top = 4 - spike - (hash2(Math.floor(wrap(along) / 8), 1, seed) > 0.5 ? 0 : 1);
      if (depth < Math.max(0, top)) return 0;
      if (depth - top < 2) return cap[Math.min(cap.length - 1, 1 + (phase < 4 ? 1 : 0))] ?? cap[0]!;
      return -1;
    }
    case 'organic': {
      const top = edge(4, 8);
      if (depth < top) return 0;
      const d = depth - top;
      if (d < 3) return rampAt(cap, 1 - d / 3, along, depth, 0.6);
      if (d === 3) return r.base[0]!;
      return -1;
    }
    case 'ruin': {
      if (depth < 1) return 0;
      if (depth === 1) return cap[cap.length - 1]!;
      if (depth < 5) {
        // capstone course, moss creeping over it
        const moss = fbm(along, depth, seed + 3, { scale: 4, octaves: 2, tileW: T, tileH: T });
        if (moss > 0.55 - depth * 0.04) return rampAt(r.moss, moss, along, depth, 0.6);
        return depth === 4 ? r.base[0]! : cap[cap.length - 2]!;
      }
      if (depth < 9 && hash2(wrap(along), 11, seed) > 0.85) return r.moss[0]!; // moss drip
      return -1;
    }
  }
}

function underside(mat: TerrainMaterial, r: Ramps, seed: number, depth: number, along: number): number {
  const band = 4;
  switch (mat) {
    case 'rock': {
      // stalactite drips hanging into the transparent band
      const L = Math.floor(Math.pow(hash2(wrap(along), 21, seed), 2.5) * (band + 1));
      if (depth < band) return band - depth <= L ? (band - depth === L ? r.base[0]! : r.base[1]!) : 0;
      if (depth === band) return r.base[0]!;
      return -1;
    }
    case 'soil':
    case 'organic': {
      // hanging roots
      const L = hash2(wrap(along), 31, seed) > 0.68 ? 1 + Math.floor(hash2(wrap(along), 32, seed) * band) : 0;
      if (depth < band) return band - depth <= L ? r.moss[0]! : 0;
      if (depth === band) return r.base[0]!;
      if (depth === band + 1 && bayer(along, depth) < 0.5) return r.base[0]!;
      return -1;
    }
    case 'metal':
      if (depth === 0) return r.out;
      if (depth === 1) return r.base[0]!;
      if (depth === 2) return r.base[1]!;
      if (depth === 3) return wrap(along) % 4 === 0 ? r.detail[0]! : r.base[0]!; // pipe clamps
      if (depth === 4) return r.base[1]!;
      return -1;
    case 'crystal':
      return capPixel(mat, { ...r, cap: r.base }, seed + 1, depth, along);
    case 'ruin':
      if (depth < 1) return 0;
      if (depth === 1) return r.base[0]!;
      return -1;
  }
}

// ------------------------------------------------------------- variants

function variantDetails(p: Pix, mat: TerrainMaterial, r: Ramps, theme: ThemeId, vseed: number, role: TileRole): void {
  const rng = mulberry32(vseed);
  const inner = () => rng.int(2, T - 4);
  const ok = (x: number, y: number) => {
    if (role === 'top') return y > 8;
    if (role === 'bottom') return y < 8;
    if (role === 'side') return x > 8;
    return true;
  };
  const count = rng.int(1, 3);
  for (let i = 0; i < count; i++) {
    const x = inner();
    const y = inner();
    if (!ok(x, y)) continue;
    switch (mat) {
      case 'rock':
        if (rng.chance(0.5)) {
          // crack
          let cx = x,
            cy = y;
          for (let k = 0; k < rng.int(3, 6); k++) {
            p.set(cx, cy, r.base[0]!);
            cx += rng.int(-1, 1);
            cy += 1;
            if (cy > T - 3 || cx < 2 || cx > T - 3) break;
          }
        } else {
          // glinting mineral / glow speck (caves: bioluminescent, asteroid: ember)
          const glow = theme === 'caves' || theme === 'asteroid' || theme === 'core';
          p.set(x, y, glow ? r.detail[Math.min(r.detail.length - 1, 2)]! : r.base[r.base.length - 1]!);
          p.set(x + 1, y, glow ? r.detail[1]! : r.base[0]!);
        }
        break;
      case 'soil':
        p.set(x, y, r.detail[0]!).set(x + 1, y, r.detail[1] ?? r.detail[0]!).set(x, y + 1, r.base[0]!);
        break;
      case 'metal':
        if (rng.chance(0.5)) {
          // vent slots
          p.hline(x - 1, x + 2, y, r.base[0]!);
          p.hline(x - 1, x + 2, Math.min(T - 3, y + 2), r.base[0]!);
        } else {
          // tiny status light
          p.set(x, y, r.detail[r.detail.length - 1]!).set(x + 1, y, r.detail[0]!);
        }
        break;
      case 'crystal':
        p.set(x, y, r.cap[r.cap.length - 1]!);
        break;
      case 'organic':
        // glowing pore / nodule
        p.set(x, y, r.detail[r.detail.length - 2] ?? r.detail[0]!).set(x + 1, y, r.detail[0]!);
        break;
      case 'ruin':
        if (rng.chance(0.6)) {
          let cx = x,
            cy = y;
          for (let k = 0; k < 4; k++) {
            p.set(cx, cy, r.base[0]!);
            cx += rng.int(0, 1);
            cy += 1;
          }
        } else {
          // carved glyph
          p.set(x, y, r.base[0]!).set(x + 1, y, r.base[0]!).set(x, y + 1, r.base[0]!).set(x + 2, y + 1, r.base[0]!);
        }
        break;
    }
  }
}

// ---------------------------------------------------------------- decor

function decor(mat: TerrainMaterial, r: Ramps, pal: Palette, vseed: number): Pix {
  const p = new Pix(T, T);
  const rng = mulberry32(vseed);
  const out = pal.outline;
  switch (mat) {
    case 'rock':
    case 'crystal':
    case 'ruin': {
      // pebbles / shards / rubble resting on the bottom edge
      const n = rng.int(2, 3);
      for (let i = 0; i < n; i++) {
        const cx = rng.int(3, 12);
        const w = rng.int(1, 3);
        const h = mat === 'crystal' ? rng.int(3, 7) : rng.int(1, 3);
        if (mat === 'crystal') {
          p.poly(
            [
              [cx - w / 2 - 0.5, T],
              [cx + rng.jitter(1), T - h - 1],
              [cx + w / 2 + 0.5, T],
            ],
            (x) => (x < cx ? r.cap[r.cap.length - 1]! : r.base[1]!),
          );
        } else p.ellipse(cx, T - h / 2 - 0.5, w + 0.6, h / 2 + 0.6, (x, y, nx, ny) => rampAt(r.cap, 0.6 - nx * 0.3 - ny * 0.4, x, y, 0.5));
      }
      p.outline(out);
      break;
    }
    case 'soil': {
      // grass tuft + a flower
      const cx = rng.int(4, 11);
      for (let k = -3; k <= 3; k++) {
        const h = 3 + Math.round((3 - Math.abs(k)) * rng.range(0.6, 1.2));
        p.line(cx + k * 0.7, T - 1, cx + k * 1.3, T - 1 - h, rampAt(r.cap, 0.3 + rng.next() * 0.7, cx + k, T - h, 0.5));
      }
      if (rng.chance(0.7)) {
        const fx = cx + rng.int(-4, 4);
        p.vline(fx, T - 5, T - 1, r.cap[0]!);
        p.set(fx, T - 6, pal.ramps.accent[0]!).set(fx - 1, T - 6, pal.ramps.accent[1] ?? pal.ramps.accent[0]!);
      }
      break;
    }
    case 'metal': {
      // bolt plate / vent box
      p.rect(3, 9, 10, 7, r.base[2]!);
      p.hline(3, 12, 9, r.cap[r.cap.length - 1]!);
      for (let x = 5; x < 11; x += 2) p.vline(x, 11, 14, r.base[0]!);
      p.set(11, 10, r.detail[r.detail.length - 1]!);
      p.outline(out);
      break;
    }
    case 'organic': {
      // glowing mushroom / bulb
      const cx = rng.int(5, 10);
      const acc = r.detail;
      p.vline(cx, T - 6, T - 1, r.base[1]!);
      p.ellipse(cx + 0.5, T - 7, 3.2, 2, (x, y, nx) => rampAt(acc, 0.7 - nx * 0.4, x, y, 0.5));
      p.outline(out);
      p.set(cx - 1, T - 8, acc[acc.length - 1]!);
      break;
    }
  }
  return p;
}

// ------------------------------------------------------------------ api

export function parseTileKind(kind: TileKind): [TerrainMaterial, TileRole] {
  const [m, r] = kind.split(':') as [TerrainMaterial, TileRole];
  return [m, r];
}

export function generateTile(theme: ThemeId, kind: TileKind, variantSeed: number): Pix {
  const pal = PALETTES[theme];
  const [mat, role] = parseTileKind(kind);
  const r = rampsFor(pal, mat, theme);
  const seed = seedOf('tile', theme, mat);
  const vseed = seedOf('tilev', theme, kind, variantSeed);
  if (role === 'decor') return decor(mat, r, pal, vseed);
  const p = baseFill(mat, r, seed);
  variantDetails(p, mat, r, theme, vseed, role);
  if (role === 'top' || role === 'side') {
    const q = p.clone();
    for (let y = 0; y < T; y++)
      for (let x = 0; x < T; x++) {
        const v = role === 'top' ? capPixel(mat, r, seed, y, x) : capPixel(mat, r, seed, x, y);
        if (v >= 0) q.set(x, y, v);
      }
    return q;
  }
  if (role === 'bottom') {
    // under-lit: one shade darker overall, then the underside edge at the bottom
    const dark = shiftMap(pal, -1, ['primary', 'foliage', 'secondary', 'accent', 'light']);
    p.remap(dark, (x, y) => y > 9 || bayer(x, y) < (y - 4) / 6);
    for (let y = 0; y < T; y++)
      for (let x = 0; x < T; x++) {
        const v = underside(mat, r, seed, T - 1 - y, x);
        if (v >= 0) p.set(x, y, v);
      }
    return p;
  }
  return p;
}

/** Every TileKind, in gallery order. */
export function allTileKinds(): TileKind[] {
  const out: TileKind[] = [];
  for (const m of TERRAIN_MATERIALS) for (const r of TILE_ROLES) out.push(`${m}:${r}`);
  return out;
}

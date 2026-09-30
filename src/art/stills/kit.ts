/**
 * Cutscene still toolkit: per-still palettes built from named ramps, and
 * scene-building blocks (skies, planets, windows, interiors, light pools,
 * figures, portraits' parts). Quality bar: pixel-astronaut-cabin ref —
 * limited palette, strong warm-vs-cool light, big window/vista compositions.
 */

import type { Rgb } from '../../contracts';
import { Pix, type Pt } from '../core/pix';
import { bayer, crossMap, rampAt, type ArtPalette } from '../core/palette';
import { fbm, valueNoise } from '../core/noise';
import { hash2, mulberry32 } from '../core/rng';
import { CRAFT } from '../palettes';
import { flameFrame } from '../sprites/fx';

export const SW = 426;
export const SH = 240;

// ---------------------------------------------------------------- palette

export type Ramps<K extends string> = Record<K, number[]>;

/**
 * Build a still palette from named ramps (dark -> light). Returns the
 * palette plus the same ramps as INDEX lists. `out` must be a ramp; its first
 * colour is the outline.
 */
export function buildPalette<K extends string>(name: string, spec: Record<K, readonly Rgb[]>): { pal: ArtPalette; R: Ramps<K> } {
  const colors: Rgb[] = [0x000000];
  const R = {} as Ramps<K>;
  for (const k of Object.keys(spec) as K[]) {
    R[k] = spec[k].map((c) => {
      const i = colors.indexOf(c, 1);
      if (i > 0) return i;
      colors.push(c);
      return colors.length - 1;
    });
  }
  const ramps: Record<string, readonly number[]> = {};
  for (const k of Object.keys(R)) ramps[k] = R[k as K];
  const outRamp = (R as Record<string, number[]>).out;
  return { pal: { name, colors, ramps, outline: outRamp ? outRamp[0]! : 1 }, R };
}

/** Table: every index moves one step lighter (+1) or darker (-1) within its ramp. */
export function stepMap(pal: ArtPalette, steps: number, order?: string[]): number[] {
  const t = pal.colors.map((_, i) => i);
  const seen = new Set<number>();
  for (const name of order ?? Object.keys(pal.ramps)) {
    const r = pal.ramps[name]!;
    r.forEach((idx, k) => {
      if (seen.has(idx)) return;
      seen.add(idx);
      t[idx] = r[Math.max(0, Math.min(r.length - 1, k + steps))]!;
    });
  }
  return t;
}

/** Table: every colour -> the nearest colour of `target` ramp by brightness position. */
export function tintMap(pal: ArtPalette, target: readonly number[], lift = 0): number[] {
  const lum = (c: Rgb) => (((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11) / 255;
  return pal.colors.map((c, i) => {
    if (i === 0) return 0;
    const t = Math.min(1, lum(c) * 1.4 + lift);
    return target[Math.min(target.length - 1, Math.floor(t * target.length))]!;
  });
}

// ------------------------------------------------------------------ basics

/**
 * Quantise a 0..1 coverage to five clean ordered-dither steps (0/25/50/75/100%)
 * so light pools read as crisp bands instead of scattered dither noise.
 */
export function band(k: number): number {
  return k < 0.16 ? 0 : k < 0.38 ? 0.25 : k < 0.62 ? 0.5 : k < 0.84 ? 0.75 : 1;
}


export function sky(p: Pix, ramp: readonly number[], t0 = 0, t1 = 1, bands = 0.45, y0 = 0, h = p.h, x0 = 0, w = p.w): void {
  for (let y = y0; y < y0 + h; y++) {
    const t = t0 + (t1 - t0) * ((y - y0) / Math.max(1, h - 1));
    for (let x = x0; x < x0 + w; x++) p.set(x, y, rampAt(ramp, t, x, y, bands));
  }
}

export function starfield(p: Pix, seed: number, density: number, ramp: readonly number[], mask?: (x: number, y: number) => boolean): void {
  const rng = mulberry32(seed);
  const n = Math.floor(p.w * p.h * density);
  for (let i = 0; i < n; i++) {
    const x = rng.int(0, p.w - 1);
    const y = rng.int(0, p.h - 1);
    if (mask && !mask(x, y)) continue;
    const b = rng.next();
    p.set(x, y, ramp[b > 0.93 ? ramp.length - 1 : b > 0.7 ? Math.max(0, ramp.length - 2) : 0]!);
    if (b > 0.992) {
      const c = ramp[Math.max(0, ramp.length - 2)]!;
      p.set(x - 1, y, c).set(x + 1, y, c).set(x, y - 1, c).set(x, y + 1, c);
    }
  }
}

/** Polygon mask. */
export function polyMask(w: number, h: number, pts: readonly Pt[]): Pix {
  return new Pix(w, h).poly(pts, 1);
}

/** Thick frame around a polygon: draws the polygon grown by `t` px in `c` first; caller draws the inside after. */
export function frameAround(p: Pix, pts: readonly Pt[], t: number, ramp: readonly number[]): void {
  const cx = pts.reduce((a, q) => a + q[0], 0) / pts.length;
  const cy = pts.reduce((a, q) => a + q[1], 0) / pts.length;
  for (let k = t; k >= 1; k--) {
    const grown = pts.map(([x, y]) => {
      const dx = x - cx,
        dy = y - cy;
      const d = Math.hypot(dx, dy) || 1;
      return [x + (dx / d) * k * 1.2, y + (dy / d) * k * 1.2] as Pt;
    });
    const shade = ramp[Math.min(ramp.length - 1, Math.floor(((t - k) / t) * ramp.length))]!;
    p.poly(grown, shade);
  }
}

/** Remap pixels inside an ellipse with dithered falloff (light pools / shadows). */
export function pool(p: Pix, cx: number, cy: number, rx: number, ry: number, table: ArrayLike<number>, strength = 1, falloff = 1.2, jag = 0): void {
  p.apply(
    (x, y, cur) => {
      if (cur === 0) return -1;
      let d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
      if (jag) d += (valueNoise(x / 6, y / 3, 17) - 0.5) * jag;
      if (d >= 1) return -1;
      const k = Math.pow(1 - d, falloff) * strength;
      return band(k) > bayer(x, y) ? (table[cur] ?? cur) : -1;
    },
    cx - rx - 1,
    cy - ry - 1,
    rx * 2 + 2,
    ry * 2 + 2,
  );
}

/** Remap inside a polygon with dithered density (god rays, window light beams). */
export function beam(p: Pix, pts: readonly Pt[], table: ArrayLike<number>, density: (x: number, y: number) => number): void {
  const m = polyMask(p.w, p.h, pts);
  p.apply((x, y, cur) => (cur !== 0 && m.get(x, y) && band(density(x, y)) > bayer(x, y) ? (table[cur] ?? cur) : -1));
}

/** Blit any palette's buffer into a still palette (nearest colour). */
export function blitFrom(p: Pix, src: Pix, srcPal: ArtPalette, pal: ArtPalette, x: number, y: number, opts: { flipX?: boolean; flipY?: boolean; table?: ArrayLike<number> } = {}): void {
  const map = crossMap(srcPal, pal);
  const t = opts.table;
  p.blit(src, x, y, { map: t ? map.map((v) => t[v] ?? v) : map, flipX: opts.flipX, flipY: opts.flipY });
}

// ---------------------------------------------------------------- interior

/**
 * Greebled interior wall (cabin ref): stacked dark panels, pipes, little
 * screens, in 3-4 cool shades. Draws over the rect.
 */
export function greebleWall(p: Pix, x0: number, y0: number, w: number, h: number, ramp: readonly number[], seed: number, screens?: readonly number[]): void {
  const rng = mulberry32(seed);
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) p.set(x, y, ramp[0]!);
  const n = Math.floor((w * h) / 150);
  for (let i = 0; i < n; i++) {
    const pw = rng.int(4, 22);
    const ph = rng.int(3, 14);
    const px = rng.int(x0 - 4, x0 + w - 2);
    const py = rng.int(y0 - 4, y0 + h - 2);
    const shade = rng.int(1, ramp.length - 2);
    const clip = (xx: number, yy: number) => xx >= x0 && yy >= y0 && xx < x0 + w && yy < y0 + h;
    for (let yy = py; yy < py + ph; yy++)
      for (let xx = px; xx < px + pw; xx++) {
        if (!clip(xx, yy)) continue;
        let c = ramp[shade]!;
        if (yy === py) c = ramp[Math.min(ramp.length - 1, shade + 1)]!;
        if (yy === py + ph - 1 || xx === px + pw - 1) c = ramp[Math.max(0, shade - 1)]!;
        p.set(xx, yy, c);
      }
    if (screens && rng.chance(0.07) && pw > 6 && ph > 4) {
      for (let yy = py + 1; yy < py + ph - 1; yy++)
        for (let xx = px + 1; xx < px + pw - 1; xx++) if (clip(xx, yy)) p.set(xx, yy, yy % 2 === 0 && hash2(xx, yy, seed) > 0.4 ? screens[screens.length - 1]! : screens[0]!);
    }
  }
  // horizontal pipes
  for (let k = 0; k < Math.max(1, Math.floor(h / 40)); k++) {
    const py = rng.int(y0, y0 + h - 3);
    for (let x = x0; x < x0 + w; x++) {
      p.set(x, py, ramp[Math.min(ramp.length - 1, 2)]!);
      p.set(x, py + 1, ramp[1]!);
      if (x % 17 === 0) p.set(x, py - 1, ramp[2]!).set(x, py + 2, ramp[0]!);
    }
  }
}

/** Screen with glyph rows. */
export function screenPanel(p: Pix, x: number, y: number, w: number, h: number, ramp: readonly number[], seed: number, frame: number): void {
  p.rect(x - 1, y - 1, w + 2, h + 2, frame);
  p.rect(x, y, w, h, ramp[0]!);
  for (let yy = y + 1; yy < y + h - 1; yy += 2) {
    const len = Math.floor(hash2(yy, 1, seed) * (w - 3)) + 2;
    for (let xx = x + 1; xx < x + len; xx++) if (hash2(xx, yy, seed) > 0.25) p.set(xx, yy, ramp[Math.min(ramp.length - 1, hash2(xx, yy, seed + 1) > 0.8 ? 2 : 1)]!);
  }
}

// ----------------------------------------------------------------- planet

export interface AsterRamps {
  ocean: readonly number[];
  land: readonly number[];
  glow: readonly number[];
  atmo: readonly number[];
  out: number;
}

/**
 * Aster: a planet whose shattered crust floats in ribbons above a glowing
 * hollow interior. Crust plates (land) separated by glowing cracks; a
 * sunlit crescent lit from `light` direction; thin atmosphere rim.
 */
export function aster(p: Pix, cx: number, cy: number, r: number, R: AsterRamps, seed: number, light: { x: number; y: number } = { x: -0.7, y: -0.5 }): void {
  // `light` points TOWARD the light source (screen space).
  p.ellipse(cx, cy, r + 2, r + 2, (x, y) => (bayer(x, y) < 0.5 ? R.atmo[0]! : -1));
  p.ellipse(cx, cy, r, r, (x, y, nx, ny) => {
    const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    // sphere-mapped coords for the crust pattern
    const u = nx / (0.4 + nz) * 1.6;
    const v = ny / (0.4 + nz) * 1.6;
    const plates = fbm(u * 40 + 100, v * 40 + 100, seed, { scale: 14, octaves: 3 });
    const ribbon = Math.abs(fbm(u * 25 + 50, v * 60 + 50, seed + 4, { scale: 16, octaves: 2 }) - 0.5);
    const L = Math.max(0, nx * light.x + ny * light.y + nz * 0.45);
    if (ribbon < 0.035) {
      // glowing chasm between ribbons: the hollow interior shines through
      return rampAt(R.glow, 0.5 + (0.035 - ribbon) * 12, x, y, 0.5);
    }
    if (plates > 0.47) return rampAt(R.land, L * 0.85 + (plates - 0.47) * 1.2 - 0.05, x, y, 0.5);
    return rampAt(R.ocean, L * 0.9, x, y, 0.5);
  });
  // atmosphere rim on the lit side
  p.apply((x, y, c) => {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    if (c === 0 || d < r - 2.5 || d > r + 0.5) return -1;
    const dir = ((x - cx) * light.x + (y - cy) * light.y) / d;
    return dir > 0.1 ? R.atmo[Math.min(R.atmo.length - 1, dir > 0.6 ? 2 : 1)]! : -1;
  });
}

// ----------------------------------------------------------------- people

export interface FigureRamps {
  suit: readonly number[];
  skin: readonly number[];
  hair: readonly number[];
  visor?: readonly number[];
  out: number;
}

export interface FigureOpts {
  /** Total height in px (feet to top of head). */
  h: number;
  helmet?: boolean;
  /** 1 = facing right, -1 = left, 0 = toward camera. */
  facing?: -1 | 0 | 1;
  /** Light comes from this side (-1 left, 1 right). */
  light?: -1 | 1;
  pose?: 'stand' | 'sit' | 'point' | 'wave';
  /** Seated: height is of the seated figure. */
  backpack?: boolean;
  hairStyle?: 'short' | 'bun' | 'curly' | 'bald' | 'grey';
}

/**
 * A small character (astronaut/crew) standing on `baseY` at centre `x`.
 * Built from shaded blocks — chunky, readable, cabin-ref style.
 */
export function figure(p: Pix, x: number, baseY: number, R: FigureRamps, o: FigureOpts): void {
  const h = o.h;
  const s = h / 32; // unit scale: a 32px-tall figure
  const L = o.light ?? -1;
  const face = o.facing ?? 0;
  const shade = (ramp: readonly number[], nx: number, ny: number, xx: number, yy: number, base = 0.55) => rampAt(ramp, base + nx * L * -0.0 + (L * nx) * 0.45 - ny * 0.25, xx, yy, 0.35);
  const body = new Pix(p.w, p.h);
  const U = (v: number) => v * s;
  const headR = U(4.6);
  const headY = baseY - h + headR + U(0.5);
  const seated = o.pose === 'sit';
  const hipY = seated ? baseY - U(9) : baseY - U(13);
  const shoulderY = headY + headR + U(1.5);
  // legs
  if (seated) {
    body.poly(
      [
        [x - U(4), hipY - U(1)],
        [x + U(4) + face * U(5), hipY - U(1)],
        [x + U(4) + face * U(6), hipY + U(2)],
        [x + U(3) + face * U(6), baseY],
        [x + U(0) + face * U(6), baseY],
        [x - U(4), hipY + U(3)],
      ],
      (xx, yy) => shade(R.suit, (xx - x) / U(5), 0.2, xx, yy, 0.45),
    );
  } else {
    for (const side of [-1, 1]) {
      const lx = x + side * U(2.2);
      body.poly(
        [
          [lx - U(2), hipY],
          [lx + U(2), hipY],
          [lx + U(1.9), baseY - U(1.2)],
          [lx - U(1.9), baseY - U(1.2)],
        ],
        (xx, yy) => shade(R.suit, side * 0.6, 0.3, xx, yy, side === L ? 0.6 : 0.35),
      );
      // boots
      body.rect(lx - U(2.2) + (face > 0 ? U(0.6) : 0), baseY - U(1.8), U(4.2) + (face !== 0 ? U(0.8) : 0), U(1.8), R.suit[0]!);
    }
  }
  // backpack (astronaut)
  if (o.backpack) body.rect(x - face * U(5) - U(3.5), shoulderY - U(0.5), U(7), U(10), R.suit[1]!);
  // torso
  body.poly(
    [
      [x - U(5.2), shoulderY],
      [x + U(5.2), shoulderY],
      [x + U(4.4), hipY + U(1)],
      [x - U(4.4), hipY + U(1)],
    ],
    (xx, yy) => shade(R.suit, (xx - x) / U(5), (yy - shoulderY) / U(10), xx, yy, 0.6),
  );
  // belt / chest unit
  body.rect(x - U(4.4), hipY - U(1), U(8.8), U(1.3), R.suit[1]!);
  if (o.helmet || o.backpack) body.rect(x - U(2), shoulderY + U(2.5), U(4), U(2.5), R.suit[R.suit.length - 1]!);
  // arms
  const arm = (side: number, pose: 'down' | 'point' | 'wave' | 'lap') => {
    const sx = x + side * U(5.3);
    const pts: Pt[] =
      pose === 'down'
        ? [[sx - U(1.4), shoulderY], [sx + U(1.4), shoulderY], [sx + U(1.2) + side * U(0.5), hipY + U(1)], [sx - U(1.2) + side * U(0.5), hipY + U(1)]]
        : pose === 'lap'
          ? [[sx - U(1.4), shoulderY], [sx + U(1.4), shoulderY], [sx + U(1.4) + face * U(4), hipY], [sx - U(1.2) + face * U(4), hipY - U(1.5)]]
          : pose === 'point'
            ? [[sx, shoulderY - U(0.5)], [sx, shoulderY + U(2)], [sx + side * U(9), shoulderY - U(1.5)], [sx + side * U(9), shoulderY - U(3.5)]]
            : [[sx - U(1.3), shoulderY + U(1)], [sx + U(1.3), shoulderY + U(1)], [sx + side * U(3) + U(1), shoulderY - U(8)], [sx + side * U(3) - U(1.5), shoulderY - U(8)]];
    body.poly(pts, (xx, yy) => shade(R.suit, side * 0.8, 0, xx, yy, side === L ? 0.65 : 0.3));
    // glove
    const g = pts[2]!;
    body.ellipse(g[0], g[1], U(1.3), U(1.2), R.suit[R.suit.length > 3 ? 1 : 0]!);
  };
  const pose = o.pose ?? 'stand';
  arm(-1, pose === 'sit' ? 'lap' : pose === 'point' && face < 0 ? 'point' : pose === 'wave' ? 'wave' : 'down');
  arm(1, pose === 'sit' ? 'lap' : pose === 'point' && face >= 0 ? 'point' : 'down');
  // head
  if (o.helmet) {
    body.ellipse(x, headY, headR + U(1), headR + U(0.6), (xx, yy, nx, ny) => shade(R.suit, nx, ny, xx, yy, 0.62));
    const visor = R.visor ?? R.skin;
    body.ellipse(x + face * U(1.6), headY + U(0.4), headR * 0.72, headR * 0.55, (xx, yy, nx, ny) => rampAt(visor, 0.35 - ny * 0.5 + L * nx * 0.3, xx, yy, 0.4));
    body.set(x + face * U(1.6) + L * U(1.5), headY - U(0.8), visor[visor.length - 1]!);
  } else {
    // neck, head, hair
    body.rect(x - U(1.2), headY + headR - U(1), U(2.4), U(2.5), R.skin[0]!);
    body.ellipse(x + face * U(0.6), headY, headR * 0.92, headR, (xx, yy, nx, ny) => rampAt(R.skin, 0.55 + L * nx * 0.55 - ny * 0.15, xx, yy, 0.35));
    const style = o.hairStyle ?? 'short';
    if (style !== 'bald') {
      body.ellipse(x - face * U(0.8), headY - U(1.2), headR * 0.98, headR * 0.72, (xx, yy, nx, ny) => {
        if (yy > headY + (face === 0 ? -U(1.2) : U(1)) && Math.sign(xx - x) === face) return -1;
        if (yy > headY - U(0.8) && face === 0 && Math.abs(xx - x) < headR * 0.7) return -1;
        return rampAt(R.hair, 0.5 + L * nx * 0.4 - ny * 0.3, xx, yy, 0.4);
      });
      if (style === 'bun') body.ellipse(x - face * U(3.5), headY - U(3.5), U(2), U(2), R.hair[1] ?? R.hair[0]!);
      if (style === 'curly') for (let k = 0; k < 7; k++) body.ellipse(x - face * U(1) + (k - 3) * U(1.5), headY - headR * 0.75 + Math.abs(k - 3) * U(0.5), U(1.4), U(1.4), R.hair[(k % 2) + 0]!);
    }
    // eyes (tiny)
    if (h >= 24) {
      const ey = headY + U(0.4);
      if (face === 0) {
        body.set(x - U(1.6), ey, R.out).set(x + U(1.6), ey, R.out);
      } else body.set(x + face * U(2.4), ey, R.out);
    }
  }
  body.outline(R.out);
  p.blit(body, 0, 0);
}

// --------------------------------------------------------------- effects

/** Vignette: darkens toward the corners with dither. */
export function vignette(p: Pix, table: ArrayLike<number>, strength = 0.8): void {
  p.apply((x, y, cur) => {
    const nx = (x + 0.5) / p.w - 0.5;
    const ny = (y + 0.5) / p.h - 0.5;
    const d = Math.hypot(nx * 1.1, ny * 1.4);
    const k = Math.max(0, (d - 0.42) * 2.4) * strength;
    return cur !== 0 && band(k) > bayer(x, y) ? (table[cur] ?? cur) : -1;
  });
}

/** Diagonal speed / debris streaks. */
export function streaks(p: Pix, seed: number, count: number, ramp: readonly number[], angle: number, len: [number, number], region = { x: 0, y: 0, w: p.w, h: p.h }): void {
  const rng = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    const x = region.x + rng.range(0, region.w);
    const y = region.y + rng.range(0, region.h);
    const l = rng.range(len[0], len[1]);
    for (let k = 0; k < l; k++) {
      const t = k / l;
      p.set(x + Math.cos(angle) * k, y + Math.sin(angle) * k, ramp[Math.min(ramp.length - 1, Math.floor(t * ramp.length))]!);
    }
  }
}

/** Soft glowing disc: dithered ramp from the rim (ramp[0]) to the core (last). */
export function glowDisc(p: Pix, cx: number, cy: number, r: number, ramp: readonly number[], opts: { core?: number; onlyOver?: boolean; power?: number } = {}): void {
  const core = opts.core ?? 0;
  const pw = opts.power ?? 1.6;
  p.apply(
    (x, y, cur) => {
      if (opts.onlyOver && cur === 0) return -1;
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d >= r) return -1;
      if (d <= core) return ramp[ramp.length - 1]!;
      const t = Math.pow(1 - (d - core) / Math.max(1, r - core), pw);
      const k = t * ramp.length;
      const i = Math.floor(k);
      const f = band(k - i);
      if (i === 0 && f <= bayer(x, y)) return -1;
      const idx = f > bayer(x, y) ? i : i - 1;
      return idx < 0 ? -1 : ramp[Math.min(ramp.length - 1, idx)]!;
    },
    cx - r - 1,
    cy - r - 1,
    r * 2 + 2,
    r * 2 + 2,
  );
}

/** Rotate `src` (centre-aligned) into a new w×h buffer by `angle` radians (nearest sampling). */
export function rotated(src: Pix, w: number, h: number, angle: number): Pix {
  const out = new Pix(w, h);
  const c = Math.cos(angle),
    s = Math.sin(angle);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - w / 2,
        dy = y + 0.5 - h / 2;
      const sx = Math.floor(c * dx + s * dy + src.w / 2);
      const sy = Math.floor(-s * dx + c * dy + src.h / 2);
      out.data[y * w + x] = src.get(sx, sy);
    }
  return out;
}

export { rampAt, bayer, hash2, mulberry32, fbm, valueNoise };

/** A built CRAFT vessel (pix + engine anchors) drawn into a still, flames first. */
export function drawCraft(
  p: Pix,
  pal: ArtPalette,
  built: { pix: Pix; engines: readonly { x: number; y: number; flame: string }[] },
  x: number,
  y: number,
  s: number,
  opts: { flame?: number; frame?: number; seed?: number; table?: ArrayLike<number> } = {},
): void {
  const map = crossMap(CRAFT, pal);
  const t = opts.table;
  const m = t ? map.map((v) => t[v] ?? v) : map;
  if (opts.flame) {
    for (const e of built.engines) {
      const small = e.flame === 'fx.flameSmall';
      const fw = Math.round((small ? 5 : 9) * s * 0.85);
      const f = flameFrame(fw, Math.ceil((small ? 12 : 20) * s * opts.flame * 1.1), opts.frame ?? 1, opts.seed ?? 5, 0.9);
      p.blit(f, x + e.x - f.w / 2, y + e.y - s, { map });
    }
  }
  p.blit(built.pix, x, y, { map: m });
}

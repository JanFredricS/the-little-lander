/**
 * Theme props (prop.*). Each prop has a home theme (its default palette);
 * generators read palette RAMPS by name, so any prop can be re-themed via
 * getSprite(name, frame, theme).
 */

import type { Palette, ThemeId } from '../../contracts';
import { Pix, type Pt } from '../core/pix';
import { bayer, rampAt, shiftMap } from '../core/palette';
import { fbm, valueNoise } from '../core/noise';
import { hash2, mulberry32 } from '../core/rng';
import { halo, rockBlob, sphere } from '../core/shapes';
import { foliageClump, floatingIsland, palm, strand, type NatureRamps } from '../nature';
import { padRamps, PALETTES } from '../palettes';
import type { SpriteDef, SpriteEntry } from './types';

type Gen = (pal: Palette) => { frames: Pix[]; pivot: { x: number; y: number } };

const lighter = (pal: Palette) => shiftMap(pal, 1, ['primary', 'secondary', 'foliage', 'accent', 'light', 'sky', 'shadow']);

function finish(p: Pix, pal: Palette, rim = true): Pix {
  p.outline(pal.outline);
  if (rim) p.rim(lighter(pal), pal.outline);
  return p;
}

export const natureRamps = (pal: Palette): NatureRamps => ({
  rock: pal.ramps.primary,
  foliage: pal.ramps.foliage,
  water: pal.ramps.secondary.length >= 3 ? pal.ramps.secondary : pal.ramps.sky,
  out: pal.outline,
});

// ================================================================ hangar

/** Riveted horizontal girder with inset panels (space-station-deck ref). Tiles in x. 64×12. */
const beam: Gen = (pal) => {
  const P = pal.ramps.primary;
  const p = new Pix(64, 12);
  for (let x = 0; x < 64; x++) {
    p.set(x, 0, P[4] ?? P[3]!).set(x, 1, P[3]!);
    for (let y = 2; y < 10; y++) p.set(x, y, P[1]!);
    p.set(x, 10, P[0]!).set(x, 11, pal.outline);
  }
  // inset panels with bevels and a chevron glyph
  for (let px = 2; px < 64; px += 16) {
    p.rect(px, 3, 12, 6, P[2]!);
    p.hline(px, px + 11, 3, P[3]!);
    p.vline(px, 3, 8, P[3]!);
    p.hline(px, px + 11, 8, P[0]!);
    p.vline(px + 11, 3, 8, P[0]!);
    p.set(px + 5, 5, P[0]!).set(px + 6, 6, P[0]!).set(px + 7, 5, P[0]!);
    p.set(px - 1, 2, P[3]!).set(px - 1, 9, P[0]!);
  }
  return { frames: [p], pivot: { x: 32, y: 6 } };
};

/** Vertical pillar with panel + bolt caps. Tiles in y. 16×64. */
const pillar: Gen = (pal) => {
  const P = pal.ramps.primary;
  const p = new Pix(16, 64);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 16; x++) {
      let c = x < 2 ? P[3]! : x > 13 ? P[0]! : x < 5 ? P[2]! : P[1]!;
      if (y % 32 === 0) c = P[3]!;
      if (y % 32 === 1) c = P[0]!;
      p.set(x, y, c);
    }
  for (const oy of [6, 38]) {
    p.rect(5, oy, 7, 16, P[2]!);
    p.hline(5, 11, oy, P[3]!).vline(5, oy, oy + 15, P[3]!);
    p.hline(5, 11, oy + 15, P[0]!).vline(11, oy, oy + 15, P[0]!);
    // small lock/clamp icon
    p.rect(7, oy + 5, 3, 4, P[0]!);
    p.set(8, oy + 6, P[3]!);
  }
  p.vline(0, 0, 63, pal.outline).vline(15, 0, 63, pal.outline);
  return { frames: [p], pivot: { x: 8, y: 32 } };
};

/** Truss gantry: two chords + diagonal lattice. 64×32, tiles in x. */
const gantry: Gen = (pal) => {
  const P = pal.ramps.primary;
  const p = new Pix(64, 32);
  for (const y of [1, 28]) {
    p.rect(0, y, 64, 3, P[1]!);
    p.hline(0, 63, y, P[3]!);
    p.hline(0, 63, y + 2, P[0]!);
  }
  for (let x = 0; x < 64; x += 16) {
    p.line(x, 4, x + 8, 27, P[2]!);
    p.line(x + 1, 4, x + 9, 27, P[0]!);
    p.line(x + 16, 4, x + 8, 27, P[2]!);
    p.rect(x + 7, 25, 3, 3, P[3]!);
  }
  const q = new Pix(64, 32);
  q.blit(p, 0, 0);
  // no side outline so it tiles; outline top/bottom only
  for (let x = 0; x < 64; x++) {
    q.set(x, 0, pal.outline);
    q.set(x, 31, pal.outline);
  }
  return { frames: [q], pivot: { x: 32, y: 16 } };
};

/** Hanging rack module: dark cage with lit cells, hook on top. 14×48, 2 frames (cells blink). */
const rack: Gen = (pal) => {
  const P = pal.ramps.primary;
  const lights = [pal.ramps.sky[pal.ramps.sky.length - 2]!, pal.ramps.accent[1] ?? pal.ramps.accent[0]!];
  const frames = [0, 1].map((f) => {
    const p = new Pix(14, 48);
    p.vline(7, 0, 4, P[2]!).vline(6, 0, 4, P[3]!);
    p.rect(1, 5, 12, 42, P[0]!);
    for (let y = 7; y < 45; y += 3)
      for (let x = 3; x < 11; x += 3) {
        const h = hash2(x, y, 5 + f * (y % 2));
        p.rect(x, y, 2, 2, h > 0.8 ? lights[h > 0.93 ? 1 : 0]! : pal.ramps.shadow[1]!);
      }
    p.vline(1, 5, 46, P[2]!).vline(12, 5, 46, P[1]!);
    p.hline(1, 12, 5, P[3]!).hline(1, 12, 46, P[1]!);
    return finish(p, pal, false);
  });
  return { frames, pivot: { x: 7, y: 0 } };
};

/** Amber status screen on a stand (flickering glyph rows). 20×16, 2 frames. */
const screen: Gen = (pal) => {
  const P = pal.ramps.primary;
  const A = pal.ramps.accent;
  const frames = [0, 1].map((f) => {
    const p = new Pix(20, 16);
    p.rect(0, 0, 20, 12, P[1]!);
    p.rect(1, 1, 18, 10, A[1]!);
    for (let y = 2; y < 10; y += 2)
      for (let x = 2; x < 18; x++) if (hash2(x, y + f * 31, 77) > 0.45) p.set(x, y, A[A.length - 1]!);
    p.set(2, 1, A[0]!);
    p.rect(8, 12, 4, 4, P[0]!);
    return finish(p, pal, false);
  });
  return { frames, pivot: { x: 10, y: 15 } };
};

/** Console desk with a screen. 24×18. */
const consoleDesk: Gen = (pal) => {
  const P = pal.ramps.primary;
  const A = pal.ramps.accent;
  const p = new Pix(24, 18);
  p.poly([[1, 8], [23, 8], [21, 17], [3, 17]], P[1]!);
  p.poly([[1, 6], [23, 6], [23, 9], [1, 9]], P[3]!);
  p.rect(4, 0, 16, 6, P[0]!);
  p.rect(5, 1, 14, 4, pal.ramps.sky[pal.ramps.sky.length - 2]!);
  for (let x = 6; x < 18; x += 2) p.set(x, 2 + (x % 4 === 0 ? 1 : 0), pal.ramps.sky[pal.ramps.sky.length - 1]!);
  for (let x = 4; x < 21; x += 3) p.set(x, 7, x % 2 ? A[2] ?? A[1]! : pal.ramps.accent[0]!);
  return { frames: [finish(p, pal)], pivot: { x: 12, y: 17 } };
};

/** Cargo crate / box. 16×16. */
const crate =
  (variant: number): Gen =>
  (pal) => {
    const R = variant === 0 ? pal.ramps.secondary : pal.ramps.primary;
    const p = new Pix(16, 16);
    p.rect(1, 1, 14, 14, R[1]!);
    p.hline(1, 14, 1, R[R.length - 1]!).vline(1, 1, 14, R[2] ?? R[1]!);
    p.hline(1, 14, 14, R[0]!).vline(14, 1, 14, R[0]!);
    if (variant === 0) {
      p.line(3, 3, 12, 12, R[0]!).line(12, 3, 3, 12, R[0]!);
      p.line(3, 4, 11, 12, R[2] ?? R[1]!);
    } else {
      p.rect(3, 6, 10, 4, pal.ramps.accent[1] ?? pal.ramps.accent[0]!);
      for (let x = 3; x < 13; x++) if ((x >> 1) % 2 === 0) p.vline(x, 6, 9, pal.outline);
    }
    return { frames: [finish(new Pix(16, 16).blit(p.crop(1, 1, 14, 14), 1, 1), pal)], pivot: { x: 8, y: 8 } };
  };

/** Rotating warning light. 8×8, 2 frames. */
const warningLight: Gen = (pal) => {
  const A = pal.ramps.accent;
  const frames = [0, 1].map((f) => {
    const p = new Pix(8, 8);
    if (f === 0) halo(p, 4, 4, 4, [A[0]!, A[1]!], { core: 0.8 });
    p.rect(2, 3, 4, 3, f === 0 ? A[A.length - 1]! : A[0]!);
    p.rect(2, 6, 4, 2, pal.ramps.primary[0]!);
    return p;
  });
  return { frames, pivot: { x: 4, y: 7 } };
};

// ============================================================== asteroid

const boulder =
  (size: number, seed: number): Gen =>
  (pal) => {
    const p = new Pix(size, size);
    const prim = pal.ramps.primary.slice(0, 4);
    rockBlob(p, size / 2, size / 2, size / 2 - 1.5, size / 2 - 1.8, seed, prim, { rough: 0.45, crack: Math.floor(size / 10) });
    // craters
    const rng = mulberry32(seed);
    for (let i = 0; i < Math.floor(size / 10); i++) {
      const cx = rng.range(size * 0.3, size * 0.7);
      const cy = rng.range(size * 0.3, size * 0.7);
      const r = rng.range(1.2, size / 9);
      p.ellipse(cx, cy, r, r * 0.8, (x, y, nx, ny) => (p.get(x, y) === 0 ? -1 : ny < 0 ? prim[0]! : nx + ny > 0.3 ? prim[3]! : prim[1]!));
    }
    // ember-lit rim from below (the planet glows under the belt)
    const A = pal.ramps.accent;
    p.apply((x, y, c) => (c !== 0 && p.get(x, y + 2) === 0 && bayer(x, y) < 0.6 ? A[1]! : -1));
    return { frames: [finish(p, pal)], pivot: { x: size / 2, y: size / 2 } };
  };

/** Glowing ember debris chunk, flickering. 12×12, 4 frames. */
const emberDebris: Gen = (pal) => {
  const A = pal.ramps.accent;
  const base = new Pix(12, 12);
  rockBlob(base, 6, 6, 4, 3.4, 881, pal.ramps.primary.slice(0, 3), { rough: 0.7 });
  const frames = [0, 1, 2, 3].map((f) => {
    const p = base.clone();
    p.apply((x, y, c) => {
      if (c === 0) return -1;
      const n = valueNoise(x / 2, y / 2 + f * 0.9, 882);
      return n > 0.62 ? A[Math.min(A.length - 1, 1 + Math.floor((n - 0.62) * 8))]! : -1;
    });
    finish(p, pal, false);
    if (f % 2 === 0) p.set(2 + f, 1, A[A.length - 1]!);
    return p;
  });
  return { frames, pivot: { x: 6, y: 6 } };
};

// =============================================================== islands

const island =
  (w: number, h: number, seed: number, falls: boolean): Gen =>
  (pal) => {
    const frames = (falls ? [0, 1, 2, 3] : [0]).map((f) => {
      const p = new Pix(w, h);
      floatingIsland(p, w / 2, Math.round(w * 0.14), w * 0.86, natureRamps(pal), seed, { waterfall: falls, frame: f, depth: (h / w) * 0.72 });
      return p;
    });
    return { frames, pivot: { x: w / 2, y: Math.round(w * 0.14) } };
  };

/** Animated waterfall strip (tiles vertically). 10×64, 4 frames. */
const waterfallStrip =
  (w: number, h: number): Gen =>
  (pal) => {
    const water = natureRamps(pal).water;
    const frames = [0, 1, 2, 3].map((f) => {
      const p = new Pix(w, h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const n = valueNoise(x * 0.8, ((y - f * (h / 4)) % h) / 5, 505, 0, 0);
          const nn = valueNoise(x * 0.8, (((y - f * (h / 4)) % h) + h) / 5, 505);
          const blend = y / h;
          const v = n * (1 - blend) + nn * blend;
          const edge = Math.min(x, w - 1 - x);
          p.set(x, y, rampAt(water, 0.3 + v * 0.6 + (edge === 0 ? -0.3 : 0), x, y, 0.5));
        }
      return p;
    });
    return { frames, pivot: { x: w / 2, y: 0 } };
  };

const vine: Gen = (pal) => {
  const p = new Pix(7, 40);
  strand(p, 3, 0, 40, pal.ramps.foliage[1]!, 71, 2, pal.ramps.foliage[2]);
  for (let y = 4; y < 40; y += 6) p.set(3 + Math.round(Math.sin(y) * 1.5), y, pal.ramps.foliage[3] ?? pal.ramps.foliage[2]!);
  return { frames: [p], pivot: { x: 3, y: 0 } };
};

/** Jungle tree with a clumped canopy. 32×40. */
const tree: Gen = (pal) => {
  const p = new Pix(32, 40);
  const R = pal.ramps.primary;
  p.poly([[14, 40], [18, 40], [17, 18], [15, 18]], R[1]!);
  p.vline(15, 20, 39, R[2] ?? R[1]!);
  p.line(16, 26, 23, 19, R[1]!);
  foliageClump(p, 16, 13, 30, 22, pal.ramps.foliage, 404, { ball: 4 });
  return { frames: [finish(p, pal, false)], pivot: { x: 16, y: 39 } };
};

// ================================================================= caves

/** Diagonal god-ray light shaft: dithered so the scene shows through. 48×160. */
const godRay: Gen = (pal) => {
  const L = pal.ramps.light;
  const p = new Pix(48, 160);
  for (let y = 0; y < 160; y++) {
    const cx = 14 + y * 0.12;
    const hw = 8 + y * 0.06;
    for (let x = 0; x < 48; x++) {
      const d = Math.abs(x + 0.5 - cx) / hw;
      if (d > 1) continue;
      const fade = 1 - y / 170;
      const streak = valueNoise(x * 0.35 - y * 0.04, 0.5, 91);
      const k = (1 - d * d) * fade * (0.35 + streak * 0.5);
      if (k > bayer(x, y) * 1.6) p.set(x, y, L[Math.min(L.length - 1, Math.floor(k * 3.5) + 1)]!);
    }
  }
  // dust motes
  const rng = mulberry32(92);
  for (let i = 0; i < 30; i++) {
    const y = rng.int(0, 159);
    p.set(14 + y * 0.12 + rng.jitter(6), y, L[L.length - 1]!);
  }
  return { frames: [p], pivot: { x: 14, y: 0 } };
};

/** Alien glowing plant: curled stalk with bioluminescent bulbs. 16×28, 3 frames (pulse). */
const glowPlant: Gen = (pal) => {
  const F = pal.ramps.foliage;
  const S = pal.ramps.secondary;
  const frames = [0, 1, 2].map((f) => {
    const p = new Pix(18, 28);
    for (const [bx, h, curl] of [
      [8, 24, 1],
      [5, 16, -1],
      [12, 18, 1],
    ] as const) {
      let x = bx,
        y = 27;
      for (let i = 0; i < h; i++) {
        x = bx + Math.sin((i / h) * 2.4) * 2.5 * curl;
        y = 27 - i;
        p.set(x, y, i % 4 === 0 ? S[0]! : S[1] ?? S[0]!);
      }
      const k = [0, 1, 2][(f + bx) % 3]!;
      halo(p, x + 0.5, y, 2.6 + k * 0.5, [F[0]!, F[1]!], { core: 0.7 });
      sphere(p, x + 0.5, y, 1.7, 1.7, F.slice(1), { ambient: 0.4 });
    }
    return p;
  });
  return { frames, pivot: { x: 9, y: 27 } };
};

/** Bioluminescent mushroom cluster. 16×16, 2 frames. */
const glowMushroom: Gen = (pal) => {
  const F = pal.ramps.foliage;
  const frames = [0, 1].map((f) => {
    const p = new Pix(16, 16);
    for (const [x, h, r] of [
      [5, 8, 3.5],
      [11, 5, 2.5],
    ] as const) {
      p.vline(x, 15 - h, 15, pal.ramps.secondary[1] ?? F[0]!);
      p.ellipse(x + 0.5, 15 - h, r, r * 0.6, (xx, yy, nx, ny) => rampAt(F, 0.8 - ny * 0.6 - nx * 0.2 + f * 0.15, xx, yy, 0.5));
    }
    finish(p, pal, false);
    p.set(4, 7, F[F.length - 1]!);
    return p;
  });
  return { frames, pivot: { x: 8, y: 15 } };
};

/** Bioluminescent particle. 5×5, 4 frames (twinkle). */
const bioParticle: Gen = (pal) => {
  const F = pal.ramps.foliage;
  const frames = [0, 1, 2, 3].map((f) => {
    const p = new Pix(5, 5);
    const k = [1, 2, 1, 0][f]!;
    p.set(2, 2, F[F.length - 1 - (k === 0 ? 1 : 0)]!);
    for (let i = 1; i <= k; i++) p.set(2 - i, 2, F[k - i + 1]!).set(2 + i, 2, F[k - i + 1]!).set(2, 2 - i, F[k - i + 1]!).set(2, 2 + i, F[k - i + 1]!);
    return p;
  });
  return { frames, pivot: { x: 2.5, y: 2.5 } };
};

/** Brittle rock slab: visibly cracked, crumbs falling. 32×16. */
const brittleRock: Gen = (pal) => {
  const p = new Pix(32, 16);
  const R = pal.ramps.primary;
  const pts: Pt[] = [[1, 3], [8, 1], [20, 2], [31, 4], [30, 10], [22, 13], [12, 12], [2, 11]];
  p.poly(pts, (x, y) => rampAt(R.slice(1, 4), 0.6 - y / 16 + (hash2(x, y, 3) - 0.5) * 0.3, x, y, 0.5));
  // crack network in outline colour with a hot light edge
  const cracks: Pt[][] = [
    [[6, 2], [9, 6], [7, 9], [10, 12]],
    [[17, 2], [15, 6], [19, 8], [18, 12]],
    [[25, 3], [26, 7], [23, 11]],
    [[9, 6], [15, 6]],
  ];
  for (const c of cracks) p.path(c, pal.outline);
  const q = finish(p, pal);
  q.set(12, 14, R[1]!).set(21, 15, R[1]!);
  return { frames: [q], pivot: { x: 16, y: 8 } };
};

const caveRock: Gen = (pal) => {
  const p = new Pix(32, 24);
  rockBlob(p, 16, 13, 14, 9.5, 606, pal.ramps.primary.slice(0, 4), { rough: 0.4, crack: 2, flatBottom: true });
  const q = finish(p, pal);
  // bioluminescent moss specks
  const F = pal.ramps.foliage;
  for (let i = 0; i < 6; i++) {
    const x = 6 + hash2(i, 1, 607) * 20;
    const y = 6 + hash2(i, 2, 607) * 6;
    if (q.get(x, y) !== 0 && q.get(x, y) !== pal.outline) q.set(x, y, F[2] ?? F[1]!);
  }
  return { frames: [q], pivot: { x: 16, y: 12 } };
};

const stalactite: Gen = (pal) => {
  const p = new Pix(14, 36);
  const R = pal.ramps.primary;
  p.poly([[1, 0], [13, 0], [9, 18], [7.5, 35], [5, 16]], (x, y) => rampAt(R.slice(0, 4), 0.7 - (x / 14) * 0.6 + (valueNoise(x, y / 5, 9) - 0.5) * 0.4, x, y, 0.4));
  return { frames: [finish(p, pal)], pivot: { x: 7, y: 0 } };
};

const crystalCluster: Gen = (pal) => {
  const p = new Pix(24, 24);
  const A = pal.ramps.accent;
  const rng = mulberry32(55);
  for (let i = 0; i < 5; i++) {
    const bx = 5 + i * 3.5 + rng.jitter(1);
    const h = rng.range(9, 20);
    const lean = rng.jitter(4);
    const w = rng.range(2, 3.4);
    const tip: Pt = [bx + lean, 23 - h];
    p.poly([[bx - w, 23], tip, [bx + w, 23]], (x) => (x < tip[0] ? A[A.length - 1]! : x < tip[0] + 1.5 ? A[2] ?? A[1]! : A[1]!));
  }
  const q = finish(p, pal, false);
  return { frames: [q], pivot: { x: 12, y: 23 } };
};

// ================================================================== core

const fern: Gen = (pal) => {
  const p = new Pix(24, 16);
  const F = pal.ramps.foliage;
  for (let f = 0; f < 7; f++) {
    const a = Math.PI + (f / 6) * Math.PI;
    for (let k = 0; k < 10; k++) {
      const x = 12 + Math.cos(a) * k;
      const y = 15 + Math.sin(a) * k * 0.9 + (k * k) / 20;
      p.set(x, y, rampAt(F, 0.9 - k / 12, Math.floor(x), Math.floor(y), 0.4));
      if (k % 2 === 1) p.set(x, y + 1, F[0]!);
    }
  }
  return { frames: [p], pivot: { x: 12, y: 15 } };
};

const palmProp: Gen = (pal) => {
  const p = new Pix(40, 48);
  palm(p, 20, 47, 34, pal.ramps.primary, pal.ramps.foliage, 313);
  return { frames: [p], pivot: { x: 20, y: 47 } };
};

const floatingRock: Gen = (pal) => {
  const p = new Pix(48, 40);
  floatingIsland(p, 24, 7, 40, natureRamps(pal), 919, { depth: 0.7, roots: 5, canopy: 5 });
  return { frames: [p], pivot: { x: 24, y: 7 } };
};

/** The artificial sun: white core, yellow corona, pulsing rays. 64×64, 4 frames (0-1 calm pulse, 2-3 flare). */
const sun =
  (size: number): Gen =>
  (pal) => {
    const L = pal.ramps.light; // [yellow, white]
    const Sk = pal.ramps.sky;
    const c = size / 2;
    const frames = [0, 1, 2, 3].map((f) => {
      const p = new Pix(size, size);
      const flare = f >= 2;
      const R = size * (flare ? 0.2 + (f - 2) * 0.02 : 0.2 + f * 0.015);
      // rays
      const rays = 12;
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * Math.PI * 2 + (flare ? 0.13 : 0);
        const len = R * (flare ? 2.3 : 1.55) * (i % 2 ? 0.8 : 1);
        for (let k = R; k < len; k++) if (bayer(Math.round(c + Math.cos(a) * k), Math.round(c + Math.sin(a) * k)) < 1 - (k - R) / (len - R)) p.set(c + Math.cos(a) * k, c + Math.sin(a) * k, flare ? L[0]! : Sk[Sk.length - 2]!);
      }
      halo(p, c, c, R * (flare ? 1.9 : 1.55), [Sk[Sk.length - 3] ?? Sk[0]!, L[0]!], { core: 0.9 });
      p.ellipse(c, c, R, R, (x, y, nx, ny) => rampAt(L, 1.1 - Math.hypot(nx, ny) * 0.6, x, y, 0.5));
      // machinery ring (it's artificial)
      for (let a = 0; a < Math.PI * 2; a += 0.05) {
        const x = c + Math.cos(a) * (R + 2);
        const y = c + Math.sin(a) * (R + 2) * 0.35;
        if (Math.sin(a) > -0.2) p.set(x, y, pal.ramps.primary[f % 2]!);
      }
      return p;
    });
    return { frames, pivot: { x: c, y: c } };
  };

// ================================================================== boss

const ceilingRock =
  (w: number, h: number, seed: number): Gen =>
  (pal) => {
    const p = new Pix(w, h);
    const R = pal.ramps.primary.slice(0, 4);
    p.poly(
      [
        [0, 0],
        [w, 0],
        [w - 2, h * 0.45],
        [w * 0.7, h * 0.8],
        [w * 0.45, h - 1],
        [w * 0.25, h * 0.7],
        [2, h * 0.4],
      ],
      (x, y) => rampAt(R, 0.75 - (x / w) * 0.5 - (y / h) * 0.3 + (fbm(x, y, seed, { scale: 5 }) - 0.5) * 0.5, x, y, 0.4),
    );
    // stress cracks at the root + glowing seam
    p.path(
      [
        [w * 0.2, 1],
        [w * 0.35, 3],
        [w * 0.55, 2],
        [w * 0.8, 4],
      ],
      pal.outline,
    );
    p.set(w * 0.35, 4, pal.ramps.accent[2] ?? pal.ramps.accent[1]!);
    const q = finish(p, pal, false);
    return { frames: [q], pivot: { x: w / 2, y: 0 } };
  };

const spore: Gen = (pal) => {
  const A = pal.ramps.accent;
  return {
    frames: [0, 1].map((f) => {
      const p = new Pix(6, 6);
      halo(p, 3, 3, 3, [A[1]!, A[2]!], { core: 0.6 + f * 0.3 });
      p.set(2, 2, A[3] ?? A[2]!);
      return p;
    }),
    pivot: { x: 3, y: 3 },
  };
};

// ============================================================== collapse

function ruinBlockPix(w: number, h: number, pal: Palette, seed: number, crumble: number): Pix {
  const R = pal.ramps.primary.slice(1);
  const F = pal.ramps.foliage;
  const p = new Pix(w, h);
  p.apply((x, y) => {
    const row = Math.floor(y / 6);
    const lx = x + (row % 2) * 5;
    if (y % 6 === 5 || lx % 10 === 9) return R[0]!;
    const tone = hash2(Math.floor(lx / 10), row, seed);
    return rampAt(R, 0.35 + tone * 0.4 + (y % 6 === 0 ? 0.2 : 0) + (valueNoise(x / 2, y / 2, seed) - 0.5) * 0.2, x, y, 0.4);
  });
  // alien glyph band
  const gy = Math.floor(h * 0.3);
  for (let x = 3; x < w - 3; x += 4) {
    p.set(x, gy, pal.outline).set(x + 1, gy + 1, pal.outline).set(x, gy + 2, pal.outline);
  }
  // moss from the top
  p.apply((x, y, c) => (c !== 0 && fbm(x, y, seed + 5, { scale: 6 }) > 0.5 + y / h ? rampAt(F, 0.7 - y / h, x, y, 0.5) : -1));
  // crumbling: bites out of the edges
  if (crumble > 0) {
    p.apply((x, y) => {
      const e = Math.min(x, w - 1 - x, y) / Math.max(w, h);
      return valueNoise(x / 3, y / 3, seed + 11) * 0.5 + e * 6 < crumble * 0.22 ? 0 : -1;
    });
    const rng = mulberry32(seed + crumble * 17);
    for (let i = 0; i < crumble * 4; i++) p.set(rng.int(1, w - 2), rng.int(1, h - 2), R[0]!);
  }
  return finish(p, pal);
}

const ruinPillar =
  (frames: number): Gen =>
  (pal) => ({
    frames: Array.from({ length: frames }, (_, f) => {
      const p = ruinBlockPix(16, 64, pal, 1201, frames > 1 ? f + 1 : 0);
      if (frames === 1) {
        // capital + base
        p.rect(0, 0, 16, 3, pal.ramps.primary[4] ?? pal.ramps.primary[3]!);
        p.rect(0, 61, 16, 3, pal.ramps.primary[1]!);
      }
      return p;
    }),
    pivot: { x: 8, y: 32 },
  });

const ruinWall =
  (frames: number): Gen =>
  (pal) => ({
    frames: Array.from({ length: frames }, (_, f) => ruinBlockPix(32, 32, pal, 1301, frames > 1 ? f + 1 : 0)),
    pivot: { x: 16, y: 16 },
  });

const ruinArch: Gen = (pal) => {
  const p = ruinBlockPix(64, 48, pal, 1401, 0);
  // cut the arch opening
  p.apply((x, y) => {
    const nx = (x + 0.5 - 32) / 20;
    const ny = (y + 0.5 - 30) / 22;
    return (nx * nx + ny * ny < 1 && y > 8) || (Math.abs(x + 0.5 - 32) < 20 && y >= 30) ? 0 : -1;
  });
  // keystone glow (alien light)
  p.rect(30, 3, 4, 5, pal.ramps.light[0]!);
  p.set(31, 4, pal.ramps.light[1]!);
  return { frames: [finish(p, pal)], pivot: { x: 32, y: 47 } };
};

const fallingDebris: Gen = (pal) => {
  const base = new Pix(16, 16);
  rockBlob(base, 8, 8, 6, 5, 1501, pal.ramps.primary.slice(1, 5), { rough: 0.6, crack: 1 });
  finish(base, pal);
  const alt = new Pix(16, 16).blit(base, 0, 0, { flipX: true, flipY: true });
  return { frames: [base, alt], pivot: { x: 8, y: 8 } };
};

// ------------------------------------------------- caves: round 14 wall decor

/** Bone shades: pale rock highlight -> god-ray white tips (bones catch the light). */
const boneRamp = (pal: Palette) => [pal.ramps.primary[2]!, pal.ramps.primary[3]!, pal.ramps.light[3]!];

/** A dark slab of the wall the fossil / carving sits in (reads as embedded, not stuck on). */
function wallSlab(p: Pix, pal: Palette, seed: number): void {
  rockBlob(p, p.w / 2, p.h / 2, p.w / 2 - 1.5, p.h / 2 - 1.5, seed, pal.ramps.primary.slice(0, 3), { rough: 0.25, crack: 2 });
}

/**
 * Round 14: a long-dead alien creature fossilised in the wall: serpentine spine,
 * ribs, a crested skull and two limb pairs on a dark rock slab. 64×28.
 */
const fossilSkeleton: Gen = (pal) => {
  const p = new Pix(64, 28);
  wallSlab(p, pal, 1401);
  const B = boneRamp(pal);
  const spine = (x: number) => 14 + Math.sin(x * 0.11) * 3.5;
  // tail -> spine (thin at the tail)
  for (let x = 4; x <= 48; x++) {
    const y = spine(x);
    p.set(x, y, x % 3 === 0 ? B[2]! : B[1]!);
    if (x > 16) p.set(x, y + 1, B[0]!);
  }
  // ribs: arcs curling down from the spine, shorter towards the tail
  for (let x = 20; x <= 44; x += 4) {
    const y = spine(x);
    const len = 4 + (x - 20) * 0.12;
    for (let k = 1; k <= len; k++) p.set(x - k * 0.35, y + 1 + k, k === 1 ? B[2]! : B[1]!);
  }
  // limbs (two pairs): femur + splayed digits
  for (const [lx, dir] of [
    [24, -1],
    [40, 1],
  ] as const) {
    const y = spine(lx) + 2;
    p.line(lx, y, lx + dir * 3, y + 6, B[1]!);
    p.line(lx + dir * 3, y + 6, lx + dir * 1, y + 10, B[1]!);
    for (const d of [-1, 0, 1]) p.set(lx + dir * 1 + d * 2, y + 11, B[0]!);
  }
  // crested skull: long snout, big eye socket, a backswept crest
  const sx = 52;
  const sy = spine(48) - 1;
  p.ellipse(sx, sy, 7, 3.6, (x, y, nx, ny) => rampAt(B, 0.75 - ny * 0.4 - nx * 0.1, x, y, 0.5));
  p.poly([[sx + 4, sy - 2], [sx + 11, sy], [sx + 4, sy + 2.5]], B[1]!);
  p.set(sx - 1, sy - 1, pal.outline).set(sx, sy - 1, pal.outline).set(sx - 1, sy, pal.outline);
  p.line(sx - 5, sy - 3, sx - 10, sy - 8, B[2]!);
  p.line(sx - 3, sy - 3, sx - 7, sy - 9, B[1]!);
  // teeth
  for (let x = sx + 2; x <= sx + 9; x += 2) p.set(x, sy + 2, B[2]!);
  return { frames: [finish(p, pal, false)], pivot: { x: 32, y: 14 } };
};

/** Round 14: a single fossil skull with a jaw, for scattering round a fossil bed. 24×20. */
const fossilSkull: Gen = (pal) => {
  const p = new Pix(24, 20);
  wallSlab(p, pal, 1402);
  const B = boneRamp(pal);
  p.ellipse(10, 9, 7, 4.5, (x, y, nx, ny) => rampAt(B, 0.8 - ny * 0.5 - nx * 0.2, x, y, 0.5));
  p.poly([[14, 6], [21, 9], [14, 11]], B[1]!);
  p.ellipse(8, 8, 1.8, 1.6, pal.outline);
  p.set(16, 8, pal.outline);
  // dropped jaw + teeth
  p.line(6, 14, 18, 14, B[1]!);
  for (let x = 9; x <= 18; x += 3) p.set(x, 13, B[2]!);
  return { frames: [finish(p, pal, false)], pivot: { x: 12, y: 10 } };
};

/** Teal inlay: grooves that still hold a faint glow (the ancients' light). */
const inlay = (pal: Palette) => pal.ramps.accent;

/**
 * Round 14: an ancient alien relief carved into the wall: a bevelled stone panel,
 * a tall long-headed figure with big eyes holding a disc (the pad) over its head,
 * the grooves inlaid with a faint teal glow. 32×48.
 */
const ancientRelief: Gen = (pal) => {
  const p = new Pix(32, 48);
  const R = pal.ramps.primary;
  const A = inlay(pal);
  // panel with a bevel: lit top-left, shaded bottom-right
  p.rect(2, 2, 28, 44, R[1]!);
  p.hline(2, 29, 2, R[3]!).vline(2, 2, 45, R[2]!);
  p.hline(2, 29, 45, R[0]!).vline(29, 2, 45, R[0]!);
  p.rect(5, 5, 22, 38, R[0]!);
  // the figure, raised (R[2]) on the recessed field
  p.ellipse(16, 15, 3.5, 5.5, R[2]!); // long head
  p.set(14, 15, A[3]!).set(18, 15, A[3]!); // eyes
  p.rect(14, 21, 5, 13, R[2]!); // body
  p.line(14, 22, 9, 13, R[2]!); // arms raised
  p.line(18, 22, 23, 13, R[2]!);
  p.line(15, 34, 13, 41, R[2]!); // legs
  p.line(17, 34, 19, 41, R[2]!);
  // the disc it holds: an inlaid ring
  for (let a = 0; a < Math.PI * 2; a += 0.3) p.set(16 + Math.cos(a) * 7, 8 + Math.sin(a) * 2, A[2]!);
  // inlaid border groove + glyph ticks
  p.hline(6, 25, 41, A[1]!);
  for (let x = 7; x <= 25; x += 4) p.set(x, 42, A[2]!);
  // weathering: a crack across the panel
  p.path([[3, 30], [8, 32], [11, 30], [13, 33]], pal.outline);
  return { frames: [finish(p, pal, false)], pivot: { x: 16, y: 24 } };
};

/**
 * Round 14: an ancient mural: three long-headed figures walking toward a flat pad
 * with a craft settling on it under rays - who built the landing pad below. 96×40.
 */
const ancientMural: Gen = (pal) => {
  const p = new Pix(96, 40);
  const R = pal.ramps.primary;
  const A = inlay(pal);
  const L = pal.ramps.light;
  p.rect(1, 2, 94, 36, R[1]!);
  p.hline(1, 94, 2, R[3]!).hline(1, 94, 37, R[0]!);
  p.rect(4, 5, 88, 30, R[0]!);
  // the procession
  for (const fx of [14, 26, 38]) {
    p.ellipse(fx, 13, 2.4, 3.8, R[2]!);
    p.set(fx + 1, 13, A[3]!);
    p.rect(fx - 1, 17, 3, 9, R[2]!);
    p.line(fx + 1, 18, fx + 5, 20, R[2]!); // reaching toward the pad
    p.line(fx - 1, 26, fx - 3, 31, R[2]!);
    p.line(fx + 1, 26, fx + 3, 31, R[2]!);
  }
  // the pad: a flat platform on struts, inlaid edge lights
  p.rect(56, 28, 28, 3, R[2]!);
  p.vline(59, 31, 33, R[2]!).vline(80, 31, 33, R[2]!);
  for (let x = 57; x <= 83; x += 3) p.set(x, 28, A[3]!);
  // a craft settling: a lander-like triangle with legs
  p.poly([[70, 12], [76, 22], [64, 22]], R[3]!);
  p.line(65, 22, 62, 26, R[2]!).line(75, 22, 78, 26, R[2]!);
  // rays down from above the pad (gold, faint)
  for (const [x0, x1] of [
    [66, 60],
    [70, 70],
    [74, 80],
  ] as const) {
    for (let y = 5; y < 11; y++) if ((y + x0) % 2 === 0) p.set(x0 + ((x1 - x0) * (y - 5)) / 6, y, L[1]!);
  }
  // groove frame along the bottom: a line of glyphs
  p.hline(6, 89, 33, A[1]!);
  for (let x = 8; x <= 88; x += 5) p.set(x, 34, A[2]!).set(x + 1, 34, A[1]!);
  p.path([[47, 3], [50, 10], [48, 16], [51, 22]], pal.outline); // an old crack
  return { frames: [finish(p, pal, false)], pivot: { x: 48, y: 20 } };
};

// ============================================================= registry

const HOME: [ThemeId, Record<string, Gen>][] = [
  [
    'hangar',
    {
      'prop.beam': beam,
      'prop.pillar': pillar,
      'prop.gantry': gantry,
      'prop.rack': rack,
      'prop.screen': screen,
      'prop.console': consoleDesk,
      'prop.crate': crate(0),
      'prop.box': crate(1),
      'prop.warningLight': warningLight,
    },
  ],
  [
    'asteroid',
    {
      'prop.boulderSmall': boulder(12, 701),
      'prop.boulderMedium': boulder(24, 702),
      'prop.boulderLarge': boulder(48, 703),
      'prop.emberDebris': emberDebris,
    },
  ],
  [
    'islands',
    {
      'prop.islandSmall': island(48, 56, 801, false),
      'prop.islandMedium': island(96, 104, 802, true),
      'prop.islandLarge': island(160, 168, 803, true),
      'prop.waterfall': waterfallStrip(10, 64),
      'prop.vine': vine,
      'prop.tree': tree,
    },
  ],
  [
    'caves',
    {
      'prop.rock': caveRock,
      'prop.stalactite': stalactite,
      'prop.godRay': godRay,
      'prop.glowPlant': glowPlant,
      'prop.glowMushroom': glowMushroom,
      'prop.bioParticle': bioParticle,
      'prop.brittleRock': brittleRock,
      'prop.crystalCluster': crystalCluster,
      'prop.fossilSkeleton': fossilSkeleton,
      'prop.fossilSkull': fossilSkull,
      'prop.ancientRelief': ancientRelief,
      'prop.ancientMural': ancientMural,
    },
  ],
  [
    'core',
    {
      'prop.palm': palmProp,
      'prop.fern': fern,
      'prop.waterfallWide': waterfallStrip(24, 96),
      'prop.floatingRock': floatingRock,
      'prop.sun': sun(64),
      'prop.sunLarge': sun(128),
    },
  ],
  [
    'boss',
    {
      'prop.ceilingRock': ceilingRock(24, 20, 1101),
      'prop.ceilingRockLarge': ceilingRock(40, 30, 1102),
      'prop.spore': spore,
    },
  ],
  [
    'collapse',
    {
      'prop.ruinPillar': ruinPillar(1),
      'prop.ruinPillarCrumbling': ruinPillar(3),
      'prop.ruinWall': ruinWall(1),
      'prop.ruinWallCrumbling': ruinWall(3),
      'prop.ruinArch': ruinArch,
      'prop.fallingDebris': fallingDebris,
    },
  ],
];

/** Notes shown in the gallery for props whose frames are not a plain loop. */
const NOTES: Record<string, string> = {
  'prop.sun': 'frames 0-1 calm pulse, 2-3 flare',
  'prop.sunLarge': 'frames 0-1 calm pulse, 2-3 flare',
  'prop.ruinPillarCrumbling': 'frames = crumble stages',
  'prop.ruinWallCrumbling': 'frames = crumble stages',
  'prop.godRay': 'dithered: draw over the scene',
};

export function propSprites(): Record<string, SpriteEntry> {
  const out: Record<string, SpriteEntry> = {};
  for (const [home, gens] of HOME)
    for (const [name, gen] of Object.entries(gens))
      out[name] = {
        home,
        themed: true,
        note: NOTES[name],
        gen: (theme): SpriteDef => {
          const pal = PALETTES[theme];
          const r = gen(padRamps(pal));
          return { frames: r.frames, palette: pal, pivot: r.pivot };
        },
      };
  return out;
}


/**
 * Creatures and the boss. Dragon-bird (banshee-like predator that seizes the
 * CSM), distant sky-whales and dragon flocks (dark silhouettes against haze,
 * per the floating-islands refs), and the Keeper: a cthulhu-esque flying
 * guardian (mantle + eye + tendrils) in abyssal purple with sickly green.
 */

import type { Palette } from '../../contracts';
import { Pix, type Pt } from '../core/pix';
import { bayer, rampAt, shiftMap } from '../core/palette';
import { fbm } from '../core/noise';
import { hash2 } from '../core/rng';
import { halo } from '../core/shapes';
import { padRamps, PALETTES } from '../palettes';
import type { SpriteEntry } from './types';

// ---------------------------------------------------------- dragon-bird

/**
 * Side view, facing right. 4 frames: wings up, mid, down, mid.
 * `s` scales the drawing (1 = 64×40 sprite).
 */
export function dragonBird(palIn: Palette, frame: number, s = 1): Pix {
  const pal = padRamps(palIn);
  const W = 64 * s,
    H = 40 * s;
  const p = new Pix(W, H);
  const P = (pts: readonly Pt[]): Pt[] => pts.map(([x, y]) => [x * s, y * s] as Pt);
  const dark = [pal.outline, pal.ramps.primary[0]!, pal.ramps.primary[1]!, pal.ramps.primary[2]!];
  const mem = pal.ramps.accent; // membrane: sunset pink -> gold
  const flap = [-1, 0, 1, 0][frame % 4]!; // -1 up, 1 down

  const wing = (sx: number, sy: number, far: boolean) => {
    const tipY = sy + flap * 17 - (flap === 0 ? 4 : 0);
    const tipX = sx - 12 - (flap === 0 ? 4 : 0);
    const frontX = sx + 10;
    const pts: Pt[] = [
      [sx + 5, sy],
      [frontX, sy + flap * 9 - 2],
      [tipX + 2, tipY],
      [tipX - 2, tipY + (flap >= 0 ? -1 : 2)],
      // scalloped trailing edge back to the body
      [tipX + 6, sy + flap * 9 + 3],
      [tipX + 11, sy + flap * 5 + 2],
      [sx - 6, sy + flap * 3 + 3],
      [sx - 8, sy + 2],
    ];
    p.poly(P(pts), (x, y) => {
      const t = 0.3 + (1 - Math.abs(y / s - sy) / 20) * 0.5 + (hash2(x, y, 3) - 0.5) * 0.15;
      return far ? dark[1]! : rampAt(mem, t, x, y, 0.5);
    });
    // ribs (finger bones) in dark
    if (!far) for (const k of [0.3, 0.6, 0.9]) p.line((sx + 4) * s, sy * s, (sx + 4 + (tipX - sx - 4) * k) * s, (sy + (tipY - sy) * k + 2) * s, dark[1]!);
    p.line((sx + 5) * s, sy * s, frontX * s, (sy + flap * 9 - 2) * s, dark[2]!);
    p.line(frontX * s, (sy + flap * 9 - 2) * s, (tipX + 2) * s, tipY * s, dark[2]!);
  };

  wing(33, 19, true); // far wing (dark)
  // tail
  p.poly(P([[22, 20], [22, 24], [8, 27], [2, 25], [9, 24]]), (x, y) => rampAt(dark.slice(1), 0.5 - (y / s - 22) / 8, x, y, 0.5));
  p.poly(P([[2, 25], [-1, 22], [5, 24.5], [-1, 29]]), mem[0]!);
  // body
  p.ellipse(31 * s, 22 * s, 11 * s, 4.6 * s, (x, y, nx, ny) => rampAt(dark.slice(1), 0.7 - ny * 0.6 - nx * 0.2, x, y, 0.5));
  // belly stripe
  for (let x = 24 * s; x < 38 * s; x++) p.set(x, 25 * s + Math.sin(x / (3 * s)) * 0.5, mem[0]!);
  // neck + head with crest
  p.poly(P([[39, 18], [49, 13], [51, 15], [41, 23]]), (x, y) => rampAt(dark.slice(1), 0.8 - (y / s - 13) / 10, x, y, 0.5));
  p.poly(P([[47, 11], [55, 12], [62, 15.5], [55, 17], [49, 17]]), (x, y) => rampAt(dark.slice(1), 0.85 - (y / s - 11) / 7, x, y, 0.5));
  p.poly(P([[48, 11.5], [42, 6], [51, 11]]), mem[1]!); // crest
  p.poly(P([[55, 16], [62, 15.5], [57, 18]]), dark[1]!); // lower jaw
  // talons (hanging, ready to grab)
  p.path(P([[29, 26], [28, 31], [30, 33]]), dark[2]!);
  p.path(P([[34, 26], [34, 31], [36, 33]]), dark[2]!);
  wing(31, 19, false); // near wing
  p.outline(pal.outline);
  // eye
  p.set(54 * s, 13.6 * s, mem[mem.length - 2] ?? mem[0]!);
  if (s > 1) p.set(54 * s + 1, 13.6 * s, mem[mem.length - 2] ?? mem[0]!);
  return p;
}

/** Far sky-whale: soft haze silhouette. 96×40, 2 frames (fin beat). */
function skyWhale(pal: Palette, frame: number): Pix {
  const p = new Pix(96, 40);
  const R = pal.ramps.secondary; // far blue-grey -> haze
  const body = (x: number, y: number, _nx: number, ny: number) => rampAt([R[0]!, R[1]!], 0.35 - ny * 0.4 + (fbm(x, y, 5, { scale: 6 }) - 0.5) * 0.3, x, y, 0.6);
  p.ellipse(44, 20, 34, 10, body);
  p.poly([[74, 16], [90, 8 + frame * 3], [86, 20], [90, 32 - frame * 3], [74, 24]], R[0]!); // flukes
  p.poly([[30, 25], [42, 26], [30, 37 - frame * 4]], R[0]!); // pectoral fin
  p.poly([[50, 12], [62, 3 + frame * 2], [58, 13]], R[0]!); // dorsal/wing fin
  for (let x = 14; x < 70; x++) if (bayer(x, 27) < 0.5) p.set(x, 26 + Math.sin(x / 7), R[1]!); // underside streak
  p.set(18, 18, R[2] ?? R[1]!);
  return p;
}

/** A small flock of distant dragon silhouettes. 24×12, 2 frames. */
function flock(pal: Palette, frame: number): Pix {
  const p = new Pix(24, 12);
  const c = pal.ramps.secondary[0]!;
  for (const [x, y] of [
    [4, 4],
    [12, 7],
    [19, 3],
  ] as const) {
    const up = (frame + x) % 2 === 0;
    p.set(x, y, c)
      .set(x - 1, y + (up ? -1 : 1), c)
      .set(x - 2, y + (up ? -2 : 1), c)
      .set(x + 1, y + (up ? -1 : 1), c)
      .set(x + 2, y + (up ? -2 : 1), c);
  }
  return p;
}

// ---------------------------------------------------------------- boss

/**
 * The Keeper's body (mantle + face + tentacle stubs). 88×72.
 * Frames: 0-1 idle breathing, 2 hurt flash.
 */
export function keeperBody(palIn: Palette, frame: number, s = 1): Pix {
  const pal = padRamps(palIn);
  const W = 88 * s,
    H = 72 * s;
  const p = new Pix(W, H);
  const Pu = pal.ramps.primary; // purples
  const G = pal.ramps.accent; // sickly green
  const Fl = pal.ramps.secondary; // flesh
  const br = frame === 1 ? 1 : 0;
  const cx = W / 2;
  // tentacle stubs underneath (behind the mantle)
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const bx = cx + (t - 0.5) * 56 * s;
    const len = (22 + (1 - Math.abs(t - 0.5) * 2) * 14) * s;
    const sway = Math.sin(i * 1.7 + frame * 1.3) * 4 * s;
    for (let k = 0; k < len; k++) {
      const kk = k / len;
      const w = (5.5 * (1 - kk) + 1) * s;
      const x = bx + sway * kk * kk + (t - 0.5) * 10 * s * kk;
      const y = 38 * s + k;
      for (let dx = -w; dx <= w; dx++) p.set(x + dx, y, rampAt(Pu.slice(0, 4), 0.55 - dx / w * 0.3 - kk * 0.3, Math.floor(x + dx), y, 0.5));
      if (k % Math.max(3, 4 * s) === 0 && kk < 0.8) p.set(x + w * 0.4, y, Fl[1]!); // suckers
    }
  }
  // mantle / head dome
  const ry = (30 + br) * s;
  p.ellipse(cx, 32 * s, 38 * s, ry, (x, y, nx, ny) => {
    const ridge = fbm(x / s, y / s, 71, { scale: 7, octaves: 2 });
    const vein = Math.abs(fbm(x / s, y / s, 73, { scale: 10, octaves: 3 }) - 0.5) < 0.025;
    if (vein && ny < 0.6) return G[1]!;
    const t = 0.72 - ny * 0.45 - nx * 0.25 + (ridge - 0.5) * 0.45;
    return rampAt(Pu, t, x, y, 0.45);
  });
  // glowing spots on the mantle
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI * 0.95 + (i / 8) * Math.PI * 0.9;
    const x = cx + Math.cos(a) * 30 * s;
    const y = 32 * s + Math.sin(a) * 22 * s;
    p.ellipse(x, y, 1.6 * s, 1.6 * s, G[i % 2 ? 2 : 3] ?? G[2]!);
  }
  // sunken eye under a heavy brow, sickly glowing iris with a slit pupil
  p.ellipse(cx, 36 * s, 13 * s, 8 * s, (x, y, _nx, ny) => rampAt(Pu.slice(0, 3), 0.15 + ny * 0.25, x, y, 0.5));
  p.ellipse(cx, 37 * s, 9 * s, 5 * s, (x, y, nx, ny) => rampAt(G, 1 - Math.hypot(nx, ny) * 0.9, x, y, 0.5));
  p.vline(cx, 33 * s, 41 * s, pal.outline);
  p.vline(cx - 1, 34 * s, 40 * s, pal.outline);
  for (let x = cx - 14 * s; x <= cx + 14 * s; x++) p.set(x, 29 * s + Math.pow((x - cx) / (14 * s), 2) * 4 * s, Pu[Pu.length - 1]!);
  // face tentacles (a writhing beard) over the lower mantle
  for (let i = 0; i < 6; i++) {
    const bx = cx + (i - 2.5) * 5 * s;
    for (let k = 0; k < 20 * s; k++) {
      const kk = k / (20 * s);
      const x = bx + Math.sin(kk * 4 + i + frame) * 2 * s * kk;
      const w = 2.2 * s * (1 - kk) + 0.6;
      for (let dx = -w; dx <= w; dx++) p.set(x + dx, 46 * s + k, rampAt(Fl, 0.55 - (dx / w) * 0.3 - kk * 0.4, Math.floor(x + dx), 46 * s + k, 0.5));
    }
  }
  p.outline(pal.outline);
  p.rim(shiftMap(pal, 1, ['primary', 'secondary', 'accent']), pal.outline);
  if (frame === 2) {
    // hurt flash: everything jumps to pale/flash
    const flash = pal.ramps.light;
    p.apply((x, y, c) => (c === 0 ? -1 : c === pal.outline ? flash[0]! : bayer(x, y) < 0.5 ? flash[1]! : flash[0]!));
  }
  return p;
}

/** A tendril segment (tip at the bottom). 12×40, 2 frames sway. */
function keeperTendril(pal: Palette, frame: number): Pix {
  const p = new Pix(14, 44);
  const Pu = pal.ramps.primary;
  const G = pal.ramps.accent;
  for (let y = 0; y < 42; y++) {
    const t = y / 42;
    const w = 5 * (1 - t) + 0.8;
    const x = 7 + Math.sin(t * 3.2 + frame * 0.9) * 3 * t;
    for (let dx = -w; dx <= w; dx++) p.set(x + dx, y, rampAt(Pu.slice(0, 5), 0.6 - (dx / w) * 0.35 - t * 0.2, Math.floor(x + dx), y, 0.5));
    if (y % 4 === 2 && t < 0.85) p.set(x + w * 0.5, y, pal.ramps.secondary[1]!);
  }
  p.outline(pal.outline);
  // glowing tip
  halo(p, 7 + Math.sin(3.2 + frame * 0.9) * 3, 41, 2.5, [G[2]!, G[3] ?? G[2]!], { core: 1 });
  return p;
}

/** The Keeper's eye. 18×14, 2 frames (open, narrowed). */
function keeperEye(pal: Palette, frame: number): Pix {
  const p = new Pix(18, 14);
  const G = pal.ramps.accent;
  const open = frame === 0 ? 5.5 : 3;
  p.ellipse(9, 7, 8, open, (x, y, nx, ny) => rampAt(G, 1 - Math.hypot(nx, ny) * 0.8 - ny * 0.2, x, y, 0.5));
  // slit pupil
  p.vline(9, 7 - open + 1, 7 + open - 1, pal.outline);
  p.vline(8, 7 - open + 2, 7 + open - 2, pal.outline);
  p.outline(pal.ramps.primary[1]!);
  p.set(6, 5, G[G.length - 1]!);
  return p;
}

export function creatureSprites(): Record<string, SpriteEntry> {
  const isl = () => padRamps(PALETTES.islands);
  const boss = () => padRamps(PALETTES.boss);
  const frames = (n: number, f: (i: number) => Pix) => Array.from({ length: n }, (_, i) => f(i));
  return {
    'creature.dragonBird': {
      home: 'islands',
      themed: false,
      gen: () => ({ frames: frames(4, (i) => dragonBird(isl(), i)), palette: PALETTES.islands, pivot: { x: 31, y: 22 } }),
    },
    'creature.skyWhale': { home: 'islands', themed: false, gen: () => ({ frames: frames(2, (i) => skyWhale(isl(), i)), palette: PALETTES.islands, pivot: { x: 48, y: 20 } }) },
    'creature.dragonFlock': { home: 'islands', themed: false, gen: () => ({ frames: frames(2, (i) => flock(isl(), i)), palette: PALETTES.islands, pivot: { x: 12, y: 6 } }) },
    'boss.keeperBody': {
      home: 'boss',
      themed: false,
      note: 'frames 0-1 idle, 2 = hurt flash; eye at (44,37): overlay boss.keeperEye to blink/narrow',
      gen: () => ({ frames: frames(3, (i) => keeperBody(boss(), i)), palette: PALETTES.boss, pivot: { x: 44, y: 34 } }),
    },
    'boss.keeperTendril': { home: 'boss', themed: false, gen: () => ({ frames: frames(2, (i) => keeperTendril(boss(), i)), palette: PALETTES.boss, pivot: { x: 7, y: 0 } }) },
    'boss.keeperEye': { home: 'boss', themed: false, note: 'frame 0 open, 1 narrowed', gen: () => ({ frames: frames(2, (i) => keeperEye(boss(), i)), palette: PALETTES.boss, pivot: { x: 9, y: 7 } }) },
  };
}


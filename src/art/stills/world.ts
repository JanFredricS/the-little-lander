/**
 * World stills: the floating isles, the dragon-bird, the empty outpost, the
 * cave mouth, the research vault, the hollow sun and its keeper, the
 * collapse, the reunion and the beacon road.
 */

import { Pix, type Pt } from '../core/pix';
import { bayer, rampAt } from '../core/palette';
import { fbm, valueNoise } from '../core/noise';
import { hash2, mulberry32 } from '../core/rng';
import { rockBlob } from '../core/shapes';
import { cloud, floatingIsland, foliageClump, ridgeProfile, strand, type NatureRamps } from '../nature';
import { PALETTES } from '../palettes';
import { dragonBird, keeperBody } from '../sprites/creatures';
import { buildCsmSolo, buildLander, buildPod } from '../sprites/vessels';
import { beam, blitFrom, buildPalette, drawCraft, figure, glowDisc, pool, rotated, SH, sky, starfield, stepMap, streaks, SW, tintMap, vignette } from './kit';
import type { Still } from './types';

const GREY = [0x363a4c, 0x5a6074, 0x8a91a6, 0xc0c6d4] as const;
const FOIL = [0x9c6416, 0xd69c24, 0xf4d04c] as const;
const ISL = PALETTES.islands.colors;
const BOSS = PALETTES.boss.colors;

// ------------------------------------------------------------- helpers

/** Distant sky-whale silhouette facing right; (x, y) = body centre. */
function whale(p: Pix, x: number, y: number, len: number, c: number, belly?: number): void {
  p.ellipse(x, y, len * 0.42, len * 0.14, (xx, yy, nx, ny) => (belly !== undefined && ny > 0.35 && nx > -0.6 ? belly : c));
  p.poly([[x - len * 0.38, y - 1], [x - len * 0.62, y - len * 0.14], [x - len * 0.56, y + 1], [x - len * 0.64, y + len * 0.1], [x - len * 0.38, y + 2]], c);
  // fins
  p.poly([[x + len * 0.02, y + len * 0.08], [x - len * 0.12, y + len * 0.26], [x - len * 0.14, y + len * 0.1]], c);
}

/** Small flock of V-shaped birds. */
function flock(p: Pix, x: number, y: number, n: number, c: number, seed: number, size = 2): void {
  const rng = mulberry32(seed);
  for (let i = 0; i < n; i++) {
    const bx = x + rng.range(-30, 30),
      by = y + rng.range(-12, 12);
    const s = size * rng.range(0.7, 1.3);
    p.line(bx - s, by - s * 0.6, bx, by, c).line(bx, by, bx + s, by - s * 0.6, c);
  }
}

/** Fill below a ridge profile with a vertical ramp gradient. */
function ridgeFill(p: Pix, tops: readonly number[], ramp: readonly number[], t0: number, t1: number, depth = 80): void {
  for (let x = 0; x < p.w; x++) {
    const top = Math.floor(tops[x % tops.length]!);
    for (let y = Math.max(0, top); y < p.h; y++) p.set(x, y, rampAt(ramp, t0 + (t1 - t0) * Math.min(1, (y - top) / depth), x, y, 0.45));
  }
}

// ------------------------------------------------------------ isles

const ISLE_SPEC = {
  out: [0x13191b],
  sky: [0x243470, 0x34549a, 0x5a86c4, 0x94bce2, 0xe8d8c8],
  sun: [0xffd68a, 0xfff6dc],
  cloud: [0x8aa0cc, 0xc4d2ec, 0xf4f6ff],
  haze: [0x587892, 0x7e9cb8],
  rock: [0x2d2620, 0x51432f, 0x7e6a4e, 0xae9a78],
  foliage: [0x163a2a, 0x2d6c34, 0x5ea63c, 0xb6dc5c],
  water: [0x4a8ec6, 0x8ccbe8, 0xe2f2f2],
  pink: [0xe88c88],
  grey: GREY,
  foil: FOIL,
} as const;

export function floatingIslandsVista(): Still {
  const { pal, R } = buildPalette('floatingIslandsVista', ISLE_SPEC);
  const p = new Pix(SW, SH);
  sky(p, R.sky, 0, 1.05, 0.45);
  glowDisc(p, 300, 64, 70, [R.sky[3]!, R.sky[4]!, R.sun[0]!, R.sun[1]!], { core: 9, onlyOver: true, power: 2.4 });
  // high wispy clouds
  for (let i = 0; i < 6; i++) cloud(p, 30 + i * 80, 30 + (i % 3) * 14, 50, 10, [R.sky[2]!, R.sky[3]!, R.cloud[1]!], 30 + i);
  // far cloud bank
  for (let i = 0; i < 12; i++) cloud(p, i * 40, 206 + (i % 3) * 6, 70, 36, R.cloud, 50 + i);
  const far: NatureRamps = { rock: R.haze, foliage: [R.haze[0]!, R.haze[1]!], water: R.water, out: R.haze[0]! };
  const mid: NatureRamps = { rock: [R.haze[0]!, R.rock[1]!, R.rock[2]!, R.haze[1]!], foliage: [R.haze[0]!, R.foliage[1]!, R.foliage[2]!], water: R.water, out: R.haze[0]! };
  const near: NatureRamps = { rock: R.rock, foliage: R.foliage, water: R.water, out: R.out[0]! };
  // far islands + creatures
  for (const [x, y, w, sd] of [[190, 120, 36, 1], [250, 150, 24, 2], [360, 110, 44, 3], [410, 160, 22, 4], [150, 170, 28, 5]] as const) floatingIsland(p, x, y, w, far, 700 + sd, { far: true, roots: 3 });
  whale(p, 248, 96, 52, R.haze[0]!, R.haze[1]!);
  whale(p, 206, 82, 30, R.haze[0]!);
  flock(p, 340, 150, 7, R.haze[0]!, 9);
  // mid islands with waterfalls
  floatingIsland(p, 330, 150, 72, mid, 811, { waterfall: true, depth: 0.7 });
  floatingIsland(p, 220, 186, 50, mid, 812, { depth: 0.6 });
  // the lander, small, gliding in
  drawCraft(p, pal, buildLander(1, 'flight'), 262, 108, 1, { flame: 0.8, frame: 2 });
  // near islands (foreground)
  floatingIsland(p, 78, 112, 150, near, 901, { waterfall: true, depth: 0.85, canopy: 20 });
  floatingIsland(p, 420, 200, 90, near, 902, { depth: 0.6, canopy: 14 });
  // warm light from the sun across the scene
  vignette(p, stepMap(pal, -1), 0.6);
  return { pix: p, palette: pal };
}

export function dragonBirdAttack(): Still {
  const { pal, R } = buildPalette('dragonBirdAttack', {
    out: [ISL[1]!],
    sky: [0x1e1030, 0x44204a, 0x842e52, 0xd05a4a, 0xffa04c],
    cloud: [0x5a2446, 0xa4505a, 0xf09668],
    dragon: [ISL[2]!, ISL[3]!, ISL[4]!, ISL[5]!],
    mem: [ISL[13]!, ISL[14]!, ISL[12]!],
    haze: [0x3a2244, 0x6a3a5a],
    grey: GREY,
    foil: FOIL,
    flame: [0xb2361c, 0xf07a22, 0xffba42],
  });
  const p = new Pix(SW, SH);
  sky(p, R.sky, 0, 1, 0.45);
  glowDisc(p, 90, 190, 110, [R.sky[3]!, R.sky[4]!, R.mem[1]!, R.mem[2]!], { core: 10, onlyOver: true, power: 2.6 });
  for (let row = 0; row < 2; row++) for (let i = -1; i < 8; i++) cloud(p, i * 64 + row * 30, 206 + row * 18, 130, 44, row ? R.cloud : [R.cloud[0]!, R.cloud[0]!, R.cloud[1]!], 20 + i + row * 10);
  const far: NatureRamps = { rock: R.haze, foliage: R.haze, water: R.cloud, out: R.haze[0]! };
  for (const [x, y, w] of [[60, 160, 40], [350, 176, 34], [400, 130, 24], [150, 196, 26]] as const) floatingIsland(p, x, y, w, far, 300 + x, { far: true, roots: 3 });
  // speed streaks behind
  streaks(p, 11, 40, [R.sky[2]!, R.sky[3]!], Math.PI + 0.25, [20, 60]);
  // the CSM, seized and tumbling, engine flaring
  const csm = buildCsmSolo(3);
  const cb = new Pix(150, 150);
  drawCraft(cb, pal, csm, 75 - csm.pix.w / 2, 75 - csm.pix.h / 2 - 10, 3, { flame: 1.1, frame: 3, seed: 2 });
  p.blit(rotated(cb, 150, 150, 0.55), 158, 50);
  // the dragon-bird, huge, wings raised
  const d = dragonBird(PALETTES.islands, 0, 3);
  blitFrom(p, d, PALETTES.islands, pal, 110, 4);
  // warm sunset rim + wind
  pool(p, 90, 190, 300, 200, tintMap(pal, R.mem, -0.05), 0.25);
  streaks(p, 12, 30, [R.cloud[1]!, R.cloud[2]!], Math.PI + 0.25, [10, 30], { x: 200, y: 30, w: 226, h: 180 });
  vignette(p, stepMap(pal, -1), 0.8);
  return { pix: p, palette: pal };
}

export function emptyOutpost(): Still {
  const { pal, R } = buildPalette('emptyOutpost', {
    out: [0x0c0c14],
    sky: [0x1a1a3c, 0x33295a, 0x6a4470, 0xc27068, 0xf4b27a],
    haze: [0x3c3458, 0x5e4e72],
    rock: [0x221a22, 0x3e3034, 0x62504a, 0x8e7460],
    foliage: [0x0e2420, 0x1c4030, 0x346238, 0x6a9a48],
    dome: [0x2c3040, 0x4e566c, 0x7e889e, 0xbcc4d4],
    lamp: [0x7a4a18, 0xffc466, 0xfff2c8],
    water: [0x4a6a9a, 0x9ac0dc],
    grey: GREY,
    foil: FOIL,
  });
  const p = new Pix(SW, SH);
  sky(p, R.sky, 0, 1, 0.45);
  starfield(p, 4, 0.006, [R.sky[2]!, R.sky[4]!], (_, y) => y < 60);
  glowDisc(p, 360, 150, 80, [R.sky[3]!, R.sky[4]!, R.lamp[2]!], { core: 6, onlyOver: true, power: 2.8 });
  const far: NatureRamps = { rock: R.haze, foliage: R.haze, water: R.water, out: R.haze[0]! };
  for (const [x, y, w] of [[80, 60, 40], [300, 80, 30], [400, 50, 22], [220, 40, 18]] as const) floatingIsland(p, x, y, w, far, 400 + x, { far: true, roots: 3 });
  // the plateau
  const tops = ridgeProfile(SW, 176, 14, 5, 90, false);
  for (let x = 340; x < SW; x++) tops[x] = tops[x]! + Math.pow((x - 340) / 86, 2) * 70;
  ridgeFill(p, tops, R.rock, 0.65, 0.05, 60);
  for (let x = 0; x < SW; x++) {
    const t = Math.floor(tops[x]!);
    for (let k = 0; k < 4 + hash2(x, 1, 3) * 4; k++) p.set(x, t + k, rampAt(R.foliage, 0.8 - k * 0.14, x, t + k, 0.4));
  }
  // domes
  const dome = (cx: number, base: number, r: number, seed: number) => {
    const b = new Pix(SW, SH);
    b.ellipse(cx, base, r, r * 0.8, (x, y, nx, ny) => (y > base ? -1 : rampAt(R.dome, 0.5 - nx * 0.45 - ny * 0.25, x, y, 0.4)));
    // panel seams
    b.apply((x, y, c) => {
      if (!c) return -1;
      const nx = (x - cx) / r,
        ny = (base - y) / (r * 0.8);
      const lon = Math.asin(Math.max(-1, Math.min(1, nx / Math.sqrt(Math.max(0.01, 1 - ny * ny)))));
      return Math.abs(((lon * 4) % 1) + 1) % 1 < 0.08 || Math.abs(((ny * 4) % 1)) < 0.06 ? R.dome[0]! : -1;
    }, cx - r, base - r, r * 2, r);
    // door + dark broken window
    b.rect(cx - r * 0.18, base - r * 0.32, r * 0.36, r * 0.32, R.out[0]!);
    b.rect(cx + r * 0.3, base - r * 0.55, r * 0.22, r * 0.14, R.out[0]!);
    b.line(cx + r * 0.3, base - r * 0.55, cx + r * 0.42, base - r * 0.44, R.dome[2]!);
    b.outline(R.out[0]!);
    p.blit(b, 0, 0);
    // overgrowth
    for (let k = 0; k < 6; k++) {
      const a = Math.PI * (0.15 + 0.7 * hash2(k, 1, seed));
      strand(p, cx - Math.cos(a) * r * 0.9, base - Math.sin(a) * r * 0.72, 8 + hash2(k, 2, seed) * r * 0.5, R.foliage[1]!, seed + k, 1, R.foliage[2]);
    }
    foliageClump(p, cx - r * 0.8, base - 4, r * 0.8, r * 0.4, R.foliage, seed + 20);
    foliageClump(p, cx + r * 0.7, base - 3, r * 0.6, r * 0.3, R.foliage, seed + 21);
  };
  dome(90, 178, 34, 1);
  dome(200, 174, 52, 2);
  dome(290, 178, 24, 3);
  // antenna mast, leaning, dead dish
  p.line(250, 124, 262, 40, R.dome[1]!).line(251, 124, 263, 40, R.dome[2]!);
  for (let y = 50; y < 120; y += 10) p.line(250 + (124 - y) / 7.3 - 3, y, 250 + (124 - y) / 7.3 + 4, y + 4, R.dome[1]!);
  p.ellipse(266, 44, 12, 5, (x, y, nx, ny) => rampAt(R.dome, 0.6 - ny * 0.4, x, y, 0.4));
  // one flickering lamp still alive: warm pool against the dusk
  p.vline(140, 142, 176, R.dome[1]!);
  glowDisc(p, 140, 142, 30, [R.lamp[0]!, R.lamp[1]!, R.lamp[2]!], { core: 2, onlyOver: true, power: 2.2 });
  pool(p, 140, 172, 80, 34, tintMap(pal, R.lamp, -0.2), 0.6);
  // parked lander + two explorers
  drawCraft(p, pal, buildLander(2, 'contact'), 322, tops[346]! - 44, 2);
  const suit = { suit: [R.dome[0]!, R.dome[1]!, R.dome[2]!, R.dome[3]!], skin: R.dome, hair: R.dome, visor: [R.sky[1]!, R.sky[3]!, R.lamp[2]!], out: R.out[0]! };
  figure(p, 168, Math.floor(tops[168]!) + 2, { ...suit }, { h: 20, helmet: true, backpack: true, facing: -1, light: 1 });
  figure(p, 182, Math.floor(tops[182]!) + 3, { ...suit }, { h: 19, helmet: true, backpack: true, facing: -1, light: 1, pose: 'point' });
  vignette(p, stepMap(pal, -1), 0.8);
  return { pix: p, palette: pal };
}

export function caveMouthPodTransfer(): Still {
  const { pal, R } = buildPalette('caveMouthPodTransfer', {
    out: [0x07060a],
    rock: [0x120e14, 0x221a22, 0x3a2c30, 0x5a4440, 0x86684e],
    sky: [0x5a4466, 0xc07a6a, 0xffcc92],
    teal: [0x0e3a3a, 0x1f7a74, 0x4fd0b8, 0xb8ffe8],
    gold: [0x6a4412, 0xd09a2a],
    grey: GREY,
    foil: FOIL,
    flame: [0xb2361c, 0xf07a22, 0xffba42],
  });
  const p = new Pix(SW, SH);
  // sky strip top-left (outside light)
  sky(p, R.sky, 0, 1, 0.45);
  // cliff face (whole frame except the sky wedge)
  const face = new Pix(SW, SH);
  face.poly([[130, 0], [SW, 0], [SW, SH], [0, SH], [0, 110], [60, 70], [96, 30]], (x, y) => {
    const n = fbm(x, y * 2.6, 17, { scale: 60, octaves: 3 });
    return rampAt(R.rock, 0.3 + (n - 0.5) * 0.7 - x / 1600 - y / 1100, x, y, 0.45);
  });
  // strata lines
  face.apply((x, y, c) => (c && Math.abs(((y + fbm(x, 0, 3, { scale: 60 }) * 20) % 17)) < 1 ? R.rock[0]! : -1));
  face.outline(R.out[0]!);
  p.blit(face, 0, 0);
  // the shaft: narrow, deep, glowing teal from below
  const shaft: Pt[] = [[276, 36], [286, 30], [292, 64], [298, 112], [294, 152], [304, 198], [262, 200], [270, 158], [264, 112], [272, 70]];
  p.poly(shaft.map(([x, y]) => [282 + (x - 282) * 1.25, y - 3] as Pt), R.rock[0]!);
  p.poly(shaft, R.out[0]!);
  p.poly(shaft.map(([x, y]) => [282 + (x - 282) * 0.5, y + 10] as Pt), (x, y) => {
    const t = (y - 60) / 140;
    return t < 0 ? -1 : rampAt([R.out[0]!, ...R.teal], t * 0.9 - Math.abs(x - 282) / 40, x, y, 0.5);
  });
  glowDisc(p, 282, 200, 44, [R.teal[0]!, R.teal[1]!], { onlyOver: true, power: 1.6 });
  // glow plants around the mouth
  const rng = mulberry32(31);
  for (let i = 0; i < 22; i++) {
    const x = rng.range(230, 340),
      y = rng.range(150, 214);
    p.vline(x, y, y + 6, R.teal[0]!);
    p.ellipse(x, y, 2.5, 2, (xx, yy, nx, ny) => rampAt(R.teal, 0.8 - ny * 0.3, xx, yy, 0.4));
  }
  // the ledge
  p.poly([[0, 204], [SW, 196], [SW, SH], [0, SH]], (x, y) => rampAt(R.rock, 0.55 - (y - 200) / 60, x, y, 0.4));
  p.hline(0, SW, 204, R.rock[4]!);
  // daylight falling in from the left
  beam(p, [[0, 110], [130, 0], [260, SH], [0, SH]], stepMap(pal, 1), (x) => 0.45 - x / 700);
  // lander parked, pod detached and hovering into the shaft on its tether
  const L = buildLander(3, 'contact');
  drawCraft(p, pal, L, 72, 204 - L.pix.h + 3, 3);
  const pod = buildPod(3);
  const px = 256,
    py = 124;
  p.path([[72 + 36, 204 - 44], [170, 150], [px + 24, py + 42]], R.grey[1]!);
  drawCraft(p, pal, pod, px, py, 3);
  // small thrusters puffing
  glowDisc(p, px + 24, py + 46, 10, [R.flame[0]!, R.flame[1]!, R.flame[2]!], { core: 2, power: 1.6 });
  pool(p, 282, 170, 90, 90, tintMap(pal, R.teal, 0), 0.35);
  vignette(p, stepMap(pal, -1), 0.8);
  return { pix: p, palette: pal };
}

export function researchTeamFound(): Still {
  const { pal, R } = buildPalette('researchTeamFound', {
    out: [0x04060a],
    vault: [0x060a12, 0x0c1622, 0x162634, 0x223a48, 0x345462],
    crystal: [0x0e4a50, 0x1f8c8e, 0x5ad6cc, 0xc4fff2, 0xffffff],
    gold: [0x5a3a12, 0xb88a2c, 0xf0cc6a],
    suitA: [0x2a2c3a, 0x5a5e74, 0x9aa0b8, 0xdce0ec],
    orange: [0x6a2a10, 0xc0581e, 0xf49040],
    teal: [0x0e3434, 0x1e6664, 0x3aa29a],
  });
  const p = new Pix(SW, SH);
  sky(p, R.vault, 0, 0.6, 0.45);
  // vault arches receding
  for (const [k, c] of [[0.5, 1], [0.75, 2], [1, 3]] as const) {
    const w = 380 * k,
      h = 210 * k;
    const cx = 213,
      base = 190 + (1 - k) * -30;
    p.apply((x, y) => {
      const nx = (x - cx) / (w / 2),
        ny = (base - y) / h;
      const inside = nx * nx + ny * ny;
      return y <= base && inside > 0.82 && inside < 1 ? R.vault[c + 1]! : -1;
    });
  }
  // carved glyph pillars
  for (const x of [40, 110, 316, 386]) {
    p.rect(x - 9, 30, 18, 180, R.vault[2]!);
    p.vline(x - 9, 30, 210, R.vault[3]!);
    for (let y = 40; y < 200; y += 12) p.rect(x - 4, y, 8, 5, hash2(x, y, 2) > 0.5 ? R.crystal[1]! : R.vault[1]!);
  }
  // floor
  p.poly([[0, 196], [SW, 196], [SW, SH], [0, SH]], (x, y) => rampAt(R.vault, 0.4 - (y - 196) / 100, x, y, 0.4));
  // the crystal heart
  const cx = 213;
  glowDisc(p, cx, 110, 150, [R.vault[3]!, R.crystal[0]!, R.crystal[1]!], { onlyOver: true, power: 1.5 });
  for (let k = 0; k < 7; k++) {
    const a = -Math.PI / 2 + (k - 3) * 0.28;
    beam(p, [[cx, 110], [cx + Math.cos(a - 0.05) * 300, 110 + Math.sin(a - 0.05) * 300], [cx + Math.cos(a + 0.05) * 300, 110 + Math.sin(a + 0.05) * 300]], stepMap(pal, 1), () => 0.35);
  }
  const shard = (x: number, y: number, w: number, h: number, lean: number) =>
    p.poly([[x - w / 2, y], [x - w / 2 + lean, y - h * 0.85], [x + lean, y - h], [x + w / 2 + lean, y - h * 0.85], [x + w / 2, y]], (xx, yy) => rampAt(R.crystal, 0.5 + (xx - x - lean) / (w * 1.2) * -0.8 + (yy < y - h * 0.5 ? 0.25 : 0), xx, yy, 0.4));
  shard(cx - 20, 196, 18, 90, -8);
  shard(cx + 22, 196, 16, 76, 9);
  shard(cx, 196, 26, 130, 0);
  shard(cx - 38, 198, 10, 40, -10);
  shard(cx + 40, 198, 10, 34, 10);
  glowDisc(p, cx, 150, 24, [R.crystal[2]!, R.crystal[3]!, R.crystal[4]!], { core: 3, onlyOver: true });
  pool(p, cx, 200, 200, 40, stepMap(pal, 1), 0.7);
  // the research team, found, around the heart
  const suit = (r: readonly number[]) => ({ suit: r, skin: R.gold, hair: R.gold, visor: [R.crystal[0]!, R.crystal[2]!, R.crystal[4]!], out: R.out[0]! });
  figure(p, 150, 204, suit(R.suitA), { h: 30, helmet: true, backpack: true, facing: 1, light: 1, pose: 'sit' });
  figure(p, 172, 202, suit(R.suitA), { h: 36, helmet: true, backpack: true, facing: 1, light: 1 });
  figure(p, 262, 202, suit(R.suitA), { h: 35, helmet: true, backpack: true, facing: -1, light: -1, pose: 'wave' });
  figure(p, 286, 205, suit(R.suitA), { h: 30, helmet: true, backpack: true, facing: -1, light: -1, pose: 'sit' });
  // Wren and Io entering, foreground silhouettes with cyan rim
  figure(p, 44, 244, suit(R.orange), { h: 70, helmet: true, backpack: true, facing: 1, light: 1, pose: 'point' });
  figure(p, 92, 240, suit(R.teal), { h: 64, helmet: true, backpack: true, facing: 1, light: 1 });
  pool(p, 60, 220, 90, 80, stepMap(pal, -1), 0.6);
  // drifting motes
  const rng = mulberry32(5);
  for (let i = 0; i < 60; i++) {
    const x = rng.range(0, SW),
      y = rng.range(10, 190);
    p.set(x, y, rng.chance(0.3) ? R.crystal[3]! : R.crystal[2]!);
  }
  vignette(p, stepMap(pal, -1), 0.9);
  return { pix: p, palette: pal };
}

// --------------------------------------------------------- the hollow sun

const HOLLOW_SPEC = {
  out: [BOSS[1]!],
  sky: [0x140a20, 0x2a1440, 0x4a2462, 0x7a3c7a, 0xc0607a],
  sun: [0xff9a40, 0xffd070, 0xfff4c0, 0xffffff],
  jungle: [0x08140e, 0x122a1c, 0x22442a, 0x3a6436],
  purple: [BOSS[2]!, BOSS[3]!, BOSS[4]!, BOSS[5]!, BOSS[6]!],
  sick: [BOSS[7]!, BOSS[8]!, BOSS[9]!, BOSS[10]!],
  flesh: [BOSS[11]!, BOSS[12]!, BOSS[13]!],
  grey: GREY,
  foil: FOIL,
} as const;

function hollowBackdrop(p: Pix, R: { [K in keyof typeof HOLLOW_SPEC]: number[] }, sunPower: number): void {
  sky(p, R.sky, 0, 1, 0.45);
  const sx = 213,
    sy = 50;
  // corona rays
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2 + 0.1;
    const len = (120 + hash2(k, 1, 4) * 80) * sunPower;
    const w = 0.06 + hash2(k, 2, 4) * 0.05;
    p.poly([[sx, sy], [sx + Math.cos(a - w) * len, sy + Math.sin(a - w) * len], [sx + Math.cos(a + w) * len, sy + Math.sin(a + w) * len]], (x, y) => {
      const d = Math.hypot(x - sx, y - sy) / len;
      return 1 - d > bayer(x, y) * 1.4 ? R.sky[Math.min(4, 3 + (d < 0.4 ? 1 : 0))]! : -1;
    });
  }
  glowDisc(p, sx, sy, 90 * sunPower, [R.sky[3]!, R.sky[4]!, R.sun[0]!, R.sun[1]!, R.sun[2]!], { onlyOver: true, power: 2.2 });
  // the artificial sun: a caged sphere
  p.ellipse(sx, sy, 22, 22, (x, y, nx, ny) => rampAt(R.sun, 0.95 - Math.hypot(nx, ny) * 0.5 * (2 - sunPower), x, y, 0.4));
  for (let k = -2; k <= 2; k++) p.apply((x, y) => (Math.hypot(x - sx, y - sy) < 25 && Math.hypot(x - sx, y - sy) > 21.5 && Math.abs(Math.atan2(y - sy, x - sx) * 3 - k) < 0.2 ? R.purple[1]! : -1), sx - 26, sy - 26, 52, 52);
  p.apply((x, y) => (Math.abs(Math.hypot(x - sx, (y - sy) * 3.2) - 30) < 1.2 ? R.purple[2]! : -1), sx - 34, sy - 12, 68, 24);
  // jungle cliffs on both sides (the inner world curving up)
  for (const side of [-1, 1]) {
    const tops = ridgeProfile(170, 0, 1, side > 0 ? 9 : 10, 30, false);
    for (let i = 0; i < 170; i++) {
      const x = side < 0 ? i : SW - 1 - i;
      const edge = 150 - i * 0.9 + (tops[i]! + 0.5) * 20;
      for (let y = 0; y < SH; y++) {
        if (i > (y < 80 ? 40 + y * 0.6 : 88 + (y - 80) * 0.5) + (tops[(y + i) % 170]! * 16)) continue;
        p.set(x, y, rampAt(R.jungle, 0.35 - i / 400 + fbm(x, y, 3, { scale: 8, octaves: 2 }) * 0.4 - 0.15, x, y, 0.45));
      }
    }
  }
  for (let y = 10; y < SH; y += 14) {
    for (const side of [-1, 1]) {
      const w = (y < 80 ? 40 + y * 0.6 : 88 + (y - 80) * 0.5) + 6;
      const x = side < 0 ? w : SW - 1 - w;
      foliageClump(p, x, y, 26, 18, [R.jungle[0]!, R.jungle[1]!, R.jungle[2]!, R.jungle[3]!, R.purple[4]!], 400 + y * 3 + side, { dark: y / 600 });
    }
  }
  // waterfalls of light-mist on the cliffs + hanging vines
  for (let k = 0; k < 12; k++) {
    const side = k % 2 ? 1 : -1;
    const x = side < 0 ? 10 + k * 5 : SW - 10 - k * 5;
    strand(p, x, 0, 40 + hash2(k, 5, 1) * 90, R.jungle[2]!, 50 + k, 1.5, R.jungle[3]);
  }
  // valley floor far below
  const valley = ridgeProfile(SW, 214, 18, 12, 60, false);
  ridgeFill(p, valley, [R.jungle[0]!, R.jungle[1]!, R.purple[1]!], 0.7, 0, 30);
}

export function hollowSunKeeper(): Still {
  const { pal, R } = buildPalette('hollowSunKeeper', HOLLOW_SPEC);
  const p = new Pix(SW, SH);
  hollowBackdrop(p, R, 1);
  beam(p, [[200, 60], [226, 60], [320, SH], [110, SH]], stepMap(pal, 1), (_, y) => 0.25 - y / 1400);
  // the keeper waking, rising from the valley
  const k = keeperBody(PALETTES.boss, 0, 2);
  blitFrom(p, k, PALETTES.boss, pal, 213 - k.w / 2, 100);
  glowDisc(p, 213, 100 + 74, 26, [R.sick[1]!, R.sick[2]!, R.sick[3]!], { core: 3, onlyOver: true, power: 2.6 });
  pool(p, 213, 200, 180, 70, tintMap(pal, R.sick, -0.2), 0.3);
  // the lander, tiny, facing it
  drawCraft(p, pal, buildLander(2, 'flight'), 48, 150, 2, { flame: 1, frame: 1 });
  vignette(p, stepMap(pal, -1), 0.9);
  return { pix: p, palette: pal };
}

export function keeperDefeated(): Still {
  const { pal, R } = buildPalette('keeperDefeated', HOLLOW_SPEC);
  const p = new Pix(SW, SH);
  hollowBackdrop(p, R, 0.55);
  // darken the whole world: the sun sputters
  p.remap(stepMap(pal, -1));
  // the keeper, falling, dimmed, trailing smoke
  const k = keeperBody(PALETTES.boss, 0, 2);
  const kb = new Pix(200, 200);
  blitFrom(kb, k, PALETTES.boss, pal, 100 - k.w / 2, 100 - k.h / 2, { table: stepMap(pal, -1) });
  // the eye goes dark
  kb.apply((x, y, c) => (R.sick.includes(c) ? R.purple[1]! : -1));
  p.blit(rotated(kb, 200, 200, 0.6), 100, 96);
  const smoke = [R.purple[0]!, R.purple[1]!, R.purple[2]!];
  for (let i = 0; i < 5; i++) cloud(p, 250 + i * 12, 120 - i * 16, 34 - i * 4, 18 - i * 2, smoke, 60 + i);
  // sparks and embers
  streaks(p, 21, 30, [R.sun[2]!, R.sun[1]!, R.sun[0]!], -Math.PI / 2 - 0.3, [4, 14], { x: 150, y: 120, w: 140, h: 100 });
  const rng = mulberry32(12);
  for (let i = 0; i < 40; i++) p.set(rng.range(120, 320), rng.range(60, 220), rng.chance(0.5) ? R.sick[3]! : R.sun[1]!);
  // the lander hovering, rim-lit by the last of the sun
  drawCraft(p, pal, buildLander(3, 'flight'), 318, 40, 3, { flame: 0.9, frame: 2 });
  pool(p, 213, 50, 240, 120, tintMap(pal, R.sun, -0.15), 0.3);
  vignette(p, stepMap(pal, -1), 0.9);
  return { pix: p, palette: pal };
}

export function collapseEscape(): Still {
  const { pal, R } = buildPalette('collapseEscape', {
    out: [0x0a0608],
    dawn: [0x6a3a4a, 0xd0705a, 0xffb070, 0xffe6b0, 0xffffff],
    ruin: [0x160e14, 0x2a1c22, 0x44303a, 0x6a4c50, 0x946e64],
    alarm: [0x3a0810, 0x8a1a22, 0xe0402e],
    grey: GREY,
    foil: FOIL,
    flame: [0xb2361c, 0xf07a22, 0xffba42],
  });
  const p = new Pix(SW, SH);
  // shaft interior: dawn above, fire below
  p.apply((x, y) => {
    const t = y / SH;
    return t < 0.55 ? rampAt(R.dawn, 1 - t * 1.8, x, y, 0.45) : rampAt([R.dawn[0]!, ...R.alarm], (t - 0.55) * 2.4, x, y, 0.45);
  });
  glowDisc(p, 213, -20, 150, [R.dawn[2]!, R.dawn[3]!, R.dawn[4]!], { onlyOver: true, power: 2 });
  // shaft walls with ruined architecture
  for (const side of [-1, 1]) {
    const b = new Pix(SW, SH);
    for (let y = 0; y < SH; y++) {
      const w = 110 - y * 0.12 + valueNoise(y / 9, side * 7, 3) * 26 - (y < 40 ? (40 - y) * 0.8 : 0);
      for (let i = 0; i < w; i++) {
        const x = side < 0 ? i : SW - 1 - i;
        const brick = ((Math.floor(y / 8) % 2) * 6 + i) % 12 === 0 || y % 8 === 0;
        b.set(x, y, brick ? R.ruin[0]! : rampAt(R.ruin, 0.35 + (i / w) * 0.4 * (y < 120 ? 1 : 0.4) - y / 900, x, y, 0.4));
      }
    }
    // broken arches
    for (let k = 0; k < 3; k++) {
      const y0 = 40 + k * 70;
      b.ellipse(side < 0 ? 70 : SW - 70, y0, 26, 20, (x, y) => (y < y0 ? R.out[0]! : -1));
    }
    b.outline(R.out[0]!);
    p.blit(b, 0, 0);
  }
  // moss catching the dawn on top ledges
  // falling ruins
  const rng = mulberry32(44);
  for (let i = 0; i < 14; i++) {
    const x = rng.range(90, 336),
      y = rng.range(10, 220),
      r = rng.range(3, 13);
    streaks(p, 70 + i, 3, [R.ruin[1]!, R.ruin[2]!], -Math.PI / 2, [r * 2, r * 4], { x: x - r / 2, y: y - r, w: r, h: 2 });
    rockBlob(p, x, y, r, r * 0.8, 90 + i, R.ruin, { rough: 0.4 });
  }
  // the lander racing upward, long flame
  const L = buildLander(3, 'flight');
  drawCraft(p, pal, L, 213 - L.pix.w / 2, 70, 3, { flame: 2.2, frame: 0, seed: 3 });
  pool(p, 213, 160, 80, 70, tintMap(pal, R.flame, -0.1), 0.5);
  streaks(p, 9, 50, [R.dawn[1]!, R.dawn[2]!], Math.PI / 2, [8, 26], { x: 110, y: 0, w: 206, h: SH });
  vignette(p, stepMap(pal, -1), 0.8);
  return { pix: p, palette: pal };
}

export function reunionAboveClouds(): Still {
  const { pal, R } = buildPalette('reunionAboveClouds', {
    out: [0x0c0e1c],
    sky: [0x14204a, 0x28387a, 0x5a5a9e, 0xb87ea0, 0xf6a882, 0xffdca8],
    cloud: [0x5a5a8a, 0x9a8ab4, 0xe8b8b4, 0xfff0e0],
    sun: [0xffe8b0, 0xffffff],
    grey: [0x13111e, ...GREY, 0xeef0f6],
    foil: FOIL,
    win: [0x1c3c6c, 0x7ac4f4],
    flame: [0xb2361c, 0xf07a22, 0xffba42],
  });
  const p = new Pix(SW, SH);
  sky(p, R.sky, 0, 1.05, 0.45);
  starfield(p, 8, 0.01, [R.sky[2]!, R.cloud[3]!], (_, y) => y < 70);
  glowDisc(p, 330, 170, 140, [R.sky[4]!, R.sky[5]!, R.sun[0]!, R.sun[1]!], { core: 12, onlyOver: true, power: 2.6 });
  // sea of clouds, layered
  for (let row = 0; row < 4; row++) {
    const y = 170 + row * 20;
    for (let i = -1; i < 12; i++) cloud(p, i * 44 + (row % 2) * 22, y, 70 + row * 10, 30 + row * 6, row < 2 ? [R.cloud[0]!, R.cloud[1]!, R.cloud[2]!] : R.cloud, 100 + row * 20 + i);
  }
  // sunlit rim along the cloud tops near the sun
  pool(p, 330, 180, 220, 60, tintMap(pal, [R.cloud[2]!, R.cloud[3]!, R.sun[0]!], 0.1), 0.5);
  // the CSM holding station (nose right), the lander rising to dock
  const csm = buildCsmSolo(3);
  const cb = new Pix(120, 120);
  drawCraft(cb, pal, csm, 60 - csm.pix.w / 2, 60 - csm.pix.h / 2, 3);
  p.blit(rotated(cb, 120, 120, Math.PI / 2), 60, 50);
  const L = buildLander(3, 'flight');
  const lb = new Pix(110, 110);
  drawCraft(lb, pal, L, 55 - L.pix.w / 2, 55 - L.pix.h / 2 - 8, 3, { flame: 0.6, frame: 1 });
  p.blit(rotated(lb, 110, 110, -0.9), 214, 42);
  // warm sunrise rim light on both craft
  pool(p, 330, 170, 280, 160, tintMap(pal, [R.foil[1]!, R.sky[5]!, R.sun[0]!], 0.15), 0.18);
  vignette(p, stepMap(pal, -1), 0.7);
  return { pix: p, palette: pal };
}

export function beaconRoadDawn(): Still {
  const { pal, R } = buildPalette('beaconRoadDawn', {
    out: [0x0a0c14],
    sky: [0x1c2250, 0x3c3c78, 0x8a5a8a, 0xe88c7a, 0xffc890, 0xfff0d0],
    far: [0x3a3a6a, 0x5a5284, 0x8a6a94],
    land: [0x0e1a1c, 0x1a2e2c, 0x2e4838, 0x4e6a44],
    rock: [0x2a2228, 0x4a3c3a, 0x7a6456],
    beacon: [0x6a2a14, 0xf08a3a, 0xffd87a, 0xffffff],
    grey: GREY,
    foil: FOIL,
    suit: [0x2a2c3a, 0x5a5e74, 0x9aa0b8, 0xdce0ec],
  });
  const p = new Pix(SW, SH);
  sky(p, R.sky, 0, 1.05, 0.45, 0, 150);
  starfield(p, 14, 0.01, [R.sky[2]!, R.sky[5]!], (_, y) => y < 50);
  glowDisc(p, 300, 128, 100, [R.sky[4]!, R.sky[5]!, R.beacon[3]!], { core: 8, onlyOver: true, power: 2.6 });
  // distant mountains + floating islets
  ridgeFill(p, ridgeProfile(SW, 128, 30, 4, 70, false), R.far, 0.9, 0.2, 40);
  ridgeFill(p, ridgeProfile(SW, 146, 20, 5, 50, false), [R.far[0]!, R.land[1]!, R.far[1]!], 0.8, 0, 30);
  const farN: NatureRamps = { rock: R.far, foliage: R.far, water: R.far, out: R.far[0]! };
  floatingIsland(p, 80, 60, 30, farN, 5, { far: true, roots: 3 });
  floatingIsland(p, 380, 44, 22, farN, 6, { far: true, roots: 2 });
  // foreground plain
  ridgeFill(p, ridgeProfile(SW, 156, 8, 6, 90, false), R.land, 0.75, 0, 80);
  // the road: a winding line of beacons to the sunrise
  const road = (t: number): Pt => {
    const y = 150 + Math.pow(1 - t, 2.2) * 96;
    const x = 300 + Math.sin(t * 7) * 60 * (1 - t) - (1 - t) * 90;
    return [x, y];
  };
  for (let i = 0; i < 400; i++) {
    const t = i / 400;
    const [x, y] = road(t);
    const w = 1 + (1 - t) * 16;
    p.hline(x - w, x + w, y, rampAt(R.rock, 0.3 + t * 0.6, Math.floor(x), Math.floor(y), 0.4));
  }
  for (let i = 0; i < 16; i++) {
    const t = Math.pow(i / 16, 0.8);
    const [x, y] = road(t);
    const s = 1 - t;
    for (const side of [-1, 1]) {
      const bx = x + side * (4 + s * 22),
        by = y;
      const h = 2 + s * 16;
      p.vline(bx, by - h, by, R.grey[1]!);
      glowDisc(p, bx, by - h, 3 + s * 12, [R.beacon[0]!, R.beacon[1]!, R.beacon[2]!, R.beacon[3]!], { core: Math.max(0.5, s * 2), onlyOver: true, power: 1.8 });
    }
  }
  // settler ships following the road in
  for (const [x, y] of [[260, 70], [236, 84], [284, 88]] as const) {
    p.rect(x - 3, y, 7, 2, R.far[0]!);
    p.set(x - 4, y + 1, R.beacon[2]!);
  }
  // the crew on the knoll, watching
  const knoll = new Pix(SW, SH);
  knoll.ellipse(60, 250, 110, 50, (x, y, nx, ny) => rampAt(R.land, 0.5 - ny * 0.3 + nx * 0.2, x, y, 0.4));
  knoll.outline(R.out[0]!);
  p.blit(knoll, 0, 0);
  drawCraft(p, pal, buildLander(3, 'contact'), 0, 142, 3);
  const suit = (r: readonly number[]) => ({ suit: r, skin: R.rock, hair: R.rock, visor: [R.sky[1]!, R.sky[4]!, R.beacon[3]!], out: R.out[0]! });
  for (const [x, h] of [[96, 36], [114, 38], [132, 34], [148, 32], [162, 33]] as const) figure(p, x, 212 + (x - 96) * 0.12, suit(R.suit), { h, helmet: true, backpack: true, facing: 1, light: 1, pose: x === 114 ? 'point' : 'stand' });
  pool(p, 300, 128, 300, 120, tintMap(pal, [R.rock[2]!, R.sky[4]!, R.beacon[2]!], 0.05), 0.22);
  vignette(p, stepMap(pal, -1), 0.8);
  return { pix: p, palette: pal };
}

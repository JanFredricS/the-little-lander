/**
 * Character stills: the three portraits (big lit busts in front of their
 * environments) and the Halcyon briefing deck.
 */

import { Pix, type Pt } from '../core/pix';
import { rampAt } from '../core/palette';
import { hash2, mulberry32 } from '../core/rng';
import { buildLander } from '../sprites/vessels';
import { aster, beam, buildPalette, drawCraft, figure, glowDisc, greebleWall, pool, screenPanel, SH, sky, starfield, stepMap, SW, tintMap, vignette } from './kit';
import type { Still } from './types';

// ------------------------------------------------------------------- bust

interface BustRamps {
  skin: readonly number[];
  hair: readonly number[];
  suit: readonly number[];
  trim: readonly number[];
  out: number;
  white: number;
  /** Rim light on the shadow side. */
  rim: number;
}

interface BustOpts {
  hair: 'grey' | 'bun' | 'curly';
  beard?: boolean;
  glasses?: boolean;
  headset?: boolean;
  /** Key light side: 1 = from the right. */
  light: -1 | 1;
  /** Look direction for pupils (-1..1). */
  look?: number;
  collar?: 'uniform' | 'flight' | 'lab';
}

/** Large head-and-shoulders portrait centred on (cx, cy) = head centre. */
function bust(p: Pix, cx: number, cy: number, R: BustRamps, o: BustOpts): void {
  const L = o.light;
  const rx = 33,
    ry = 41;
  const b = new Pix(p.w, p.h);
  const skin = (t: number, x: number, y: number) => rampAt(R.skin, t, x, y, 0.4);

  // torso / shoulders
  const top = cy + 58;
  b.poly(
    [
      [cx - 118, SH + 2],
      [cx - 104, top + 26],
      [cx - 78, top + 6],
      [cx - 34, top - 4],
      [cx + 34, top - 4],
      [cx + 78, top + 6],
      [cx + 104, top + 26],
      [cx + 118, SH + 2],
    ],
    (x, y) => {
      const nx = (x - cx) / 110;
      const fold = hash2(Math.floor(x / 14), Math.floor(y / 40), 5) > 0.85 ? -0.08 : 0;
      return rampAt(R.suit, 0.5 + nx * L * 0.55 - (y - top) / 400 + fold, x, y, 0.4);
    },
  );
  // shoulder seams + chest details
  for (const s of [-1, 1]) {
    b.line(cx + s * 40, top - 2, cx + s * 70, SH, R.suit[1]!);
    if (o.collar === 'uniform') {
      // epaulette
      b.poly(
        [
          [cx + s * 58, top + 1],
          [cx + s * 92, top + 12],
          [cx + s * 90, top + 18],
          [cx + s * 56, top + 7],
        ],
        (x, y) => rampAt(R.trim, 0.55 + s * L * 0.3, x, y, 0.4),
      );
    }
  }
  if (o.collar === 'uniform') {
    // insignia + rank bars
    b.ellipse(cx - L * 58, top + 42, 6, 6, (x, y, nx, ny) => rampAt(R.trim, 0.6 - nx * 0.3 - ny * 0.4, x, y, 0.4));
    for (let k = 0; k < 3; k++) b.rect(cx + L * 46, top + 34 + k * 5, 14, 2, R.trim[1 + (k === 0 ? 1 : 0)]!);
  } else if (o.collar === 'flight') {
    // chest harness + patch
    for (const s of [-1, 1]) b.poly([[cx + s * 30, top - 2], [cx + s * 38, top - 2], [cx + s * 14, SH], [cx + s * 6, SH]], R.suit[1]!);
    b.rect(cx - L * 70, top + 28, 16, 10, R.trim[1]!);
    b.rect(cx - L * 70 + 2, top + 30, 12, 6, R.trim[2]!);
  } else {
    // lab coat lapels
    for (const s of [-1, 1])
      b.poly(
        [
          [cx + s * 22, top - 4],
          [cx + s * 42, top - 2],
          [cx + s * 34, top + 60],
          [cx + s * 8, SH],
        ],
        (x, y) => rampAt(R.trim, 0.6 + s * L * 0.3 - (y - top) / 300, x, y, 0.4),
      );
    b.rect(cx + L * 50, top + 30, 3, 14, R.white);
  }

  // neck (shadowed under the jaw)
  b.poly(
    [
      [cx - 15, cy + 22],
      [cx + 15, cy + 22],
      [cx + 18, top + 2],
      [cx - 18, top + 2],
    ],
    (x, y) => skin(0.35 + ((x - cx) / 18) * L * 0.25 - (y < cy + 44 ? 0.2 : 0), x, y),
  );
  // collar band
  b.poly(
    [
      [cx - 22, top - 8],
      [cx + 22, top - 8],
      [cx + 30, top + 2],
      [cx - 30, top + 2],
    ],
    (x, y) => rampAt(o.collar === 'lab' ? R.suit : R.suit, 0.4 + ((x - cx) / 30) * L * 0.4, x, y, 0.4),
  );

  // ears
  for (const s of [-1, 1]) b.ellipse(cx + s * (rx - 2), cy + 6, 6, 10, (x, y, nx) => skin(0.45 + s * L * 0.3 + nx * s * -0.1, x, y));

  // head: ellipse with a tapered jaw
  b.ellipse(cx, cy, rx, ry, (x, y, nx, ny) => {
    if (ny > 0.3 && Math.abs(nx) > 1 - (ny - 0.3) * 1.25) return -1;
    let t = 0.52 + L * nx * 0.6 - ny * 0.1;
    if (ny > 0.62) t -= 0.12; // chin underside
    if (Math.abs(nx + L * 0.55) < 0.12 && ny > -0.1 && ny < 0.5) t -= 0.1; // cheekbone shadow edge
    return skin(t, x, y);
  });

  // features
  const ey = cy + 3;
  const look = o.look ?? L * 0.6;
  for (const s of [-1, 1]) {
    const ex = cx + s * 13;
    // socket shadow
    b.ellipse(ex, ey, 7, 4.5, (x, y) => skin(0.3 + s * L * 0.15, x, y));
    b.rect(ex - 4, ey - 1, 8, 3, R.white);
    b.rect(ex - 1 + Math.round(look), ey - 1, 3, 3, R.hair[0]!);
    b.set(ex + Math.round(look), ey - 1, R.white);
    b.hline(ex - 4, ex + 4, ey - 2, R.out);
    // brow
    b.line(ex - 6, ey - 8 + (s === 1 ? 0 : 0), ex + 5, ey - 9 + (s === -1 ? 0 : 0), R.hair[1]!);
    b.line(ex - 5, ey - 7, ex + 4, ey - 8, R.hair[0]!);
  }
  // nose: shadow side line + base + lit tip
  const nsx = cx - L * 3;
  b.line(nsx, ey + 1, nsx - L * 2, ey + 15, R.skin[1]!);
  b.hline(cx - 5, cx + 5, ey + 17, R.skin[1]!);
  b.set(cx - 4, ey + 16, R.skin[0]!).set(cx + 4, ey + 16, R.skin[0]!);
  b.line(cx + L * 2, ey + 6, cx + L * 3, ey + 14, R.skin[R.skin.length - 1]!);
  // mouth
  b.hline(cx - 9, cx + 9, cy + 30, R.skin[0]!);
  b.hline(cx - 6, cx + 6, cy + 32, R.skin[2]!);
  b.set(cx - 10, cy + 29, R.skin[1]!).set(cx + 10, cy + 29, R.skin[1]!);

  // beard
  if (o.beard) {
    b.ellipse(cx, cy + 22, rx * 0.97, 22, (x, y, nx, ny) => {
      const jaw = Math.abs(nx) > 0.78 ? cy + 4 : cy + 22 + (1 - Math.abs(nx) / 0.78) * 4;
      if (y < jaw) return -1;
      if (y >= cy + 28 && y <= cy + 33 && Math.abs(x - cx) < 10) return -1; // mouth gap
      if (ny > 0.3 && Math.abs(nx) > 1 - (ny - 0.3) * 1.4) return -1;
      const t = 0.45 + L * nx * 0.45 - ny * 0.2 + (hash2(x >> 1, y, 9) - 0.5) * 0.25;
      return rampAt(R.hair, t, x, y, 0.4);
    });
    // moustache
    b.poly(
      [
        [cx - 14, cy + 30],
        [cx - 6, cy + 23],
        [cx + 6, cy + 23],
        [cx + 14, cy + 30],
        [cx + 8, cy + 27],
        [cx - 8, cy + 27],
      ],
      (x, y) => rampAt(R.hair, 0.55 + ((x - cx) / 14) * L * 0.3, x, y, 0.4),
    );
  }

  // hair
  const hairline = (x: number) => cy - (o.hair === 'grey' ? 24 : 18) + Math.pow(Math.abs(x - cx) / rx, 2.4) * 20;
  const hairT = (x: number, y: number, nx: number, ny: number) => 0.5 + L * nx * 0.5 - ny * 0.35 + (hash2(Math.floor(x / 3) + Math.floor(y / 2) * 7, 1, 3) - 0.5) * 0.3 - (y > hairline(x) - 3 ? 0.25 : 0);
  if (o.hair === 'grey') {
    b.ellipse(cx, cy - 10, rx + 2, ry * 0.86, (x, y, nx, ny) => (y > hairline(x) ? -1 : rampAt(R.hair, hairT(x, y, nx, ny), x, y, 0.4)));
  } else if (o.hair === 'bun') {
    b.ellipse(cx - L * 20, cy - 40, 14, 12, (x, y, nx, ny) => rampAt(R.hair, hairT(x, y, nx, ny), x, y, 0.4));
    b.ellipse(cx, cy - 12, rx + 4, ry * 0.82, (x, y, nx, ny) => {
      // side-swept fringe
      const hl = hairline(x) + (x - cx) * L * -0.12 - 2;
      return y > hl ? -1 : rampAt(R.hair, hairT(x, y, nx, ny), x, y, 0.4);
    });
    // loose strands by the ears
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) b.line(cx + s * (rx - 1 - k), cy - 8, cx + s * (rx + 1 - k), cy + 14 + k * 3, R.hair[1 + (k % 2)]!);
  } else {
    const rng = mulberry32(77);
    const curls: [number, number, number][] = [];
    for (let i = 0; i < 46; i++) {
      const a = rng.range(Math.PI * 0.95, Math.PI * 2.05);
      const rr = rng.range(0.75, 1.08);
      curls.push([cx + Math.cos(a) * (rx + 3) * rr, cy - 8 + Math.sin(a) * (ry + 2) * rr, rng.range(5, 8)]);
    }
    curls.sort((a, c) => a[1] - c[1]);
    for (const [x0, y0, r] of curls) b.ellipse(x0, y0, r, r, (x, y, nx, ny) => (y > hairline(x) + 4 && Math.abs(x - cx) < rx - 4 ? -1 : rampAt(R.hair, 0.45 + (L * nx - ny) * 0.3 + (x0 - cx) / rx * L * 0.25, x, y, 0.4)));
  }

  // glasses
  if (o.glasses) {
    for (const s of [-1, 1]) {
      const ex = cx + s * 13;
      b.hline(ex - 8, ex + 8, ey - 5, R.out).hline(ex - 8, ex + 8, ey + 5, R.out).vline(ex - 8, ey - 5, ey + 5, R.out).vline(ex + 8, ey - 5, ey + 5, R.out);
      b.line(ex + 3 * L, ey - 3, ex + 6 * L, ey - 3, R.white);
    }
    b.hline(cx - 5, cx + 5, ey - 3, R.out);
  }

  // headset
  if (o.headset) {
    const s = -L;
    b.ellipse(cx + s * (rx + 1), cy + 4, 8, 11, (x, y, nx, ny) => rampAt(R.trim, 0.5 - nx * s * 0.3 - ny * 0.3, x, y, 0.4));
    b.line(cx + s * (rx + 2), cy + 12, cx + s * 14, cy + 32, R.trim[0]!);
    b.line(cx + s * (rx + 1), cy + 12, cx + s * 14, cy + 31, R.trim[1]!);
    b.ellipse(cx + s * 13, cy + 32, 3, 2, R.trim[0]!);
    // band over the hair
    b.apply((x, y) => {
      const d = Math.hypot((x - cx) / (rx + 4), (y - cy + 6) / (ry + 1));
      return d > 0.97 && d < 1.07 && y < cy + 2 ? R.trim[(x - cx) * L > 0 ? 2 : 1]! : -1;
    }, cx - rx - 8, cy - ry - 10, rx * 2 + 16, ry + 12);
  }

  // rim light on the shadow side, then outline
  const src = b.clone();
  b.apply((x, y, c) => (c !== 0 && src.get(x + L * 1, y) !== 0 && src.get(x - L * 1, y) === 0 && src.get(x - L * 2, y) === 0 ? R.rim : -1));
  b.outline(R.out);
  p.blit(b, 0, 0);
}

// -------------------------------------------------------------- portraits

const SKIN_LIGHT = [0x5a2e24, 0x96543a, 0xc98158, 0xe8ad80, 0xfbd8b0] as const;
const SKIN_TAN = [0x3e2018, 0x6e3a24, 0xa45e38, 0xcf8a58, 0xebb482] as const;
const SKIN_DEEP = [0x241210, 0x442218, 0x6e3c28, 0x98603c, 0xc28a5e] as const;

export function commanderPortrait(): Still {
  const { pal, R } = buildPalette('commanderPortrait', {
    out: [0x07060f],
    space: [0x080a1c, 0x121a3c, 0x1f2d5c, 0x324a84],
    star: [0x4a5a98, 0xc0d0ff],
    ocean: [0x0e2a4c, 0x1d5288, 0x3a8cc4, 0x9ad6ec],
    land: [0x24302a, 0x4a6440],
    glow: [0x7a2a16, 0xe07424, 0xffc664],
    wall: [0x0b0d1e, 0x161a34, 0x242a4e, 0x383f6a],
    skin: SKIN_LIGHT,
    hair: [0x3a3844, 0x6c6a78, 0xa4a2ae, 0xd8d6de],
    suit: [0x0a0e22, 0x141c3e, 0x22305e, 0x384a84, 0x5a70aa],
    trim: [0x6a4612, 0xc49028, 0xf6d468],
    white: [0xf4f6ff],
    rim: [0x8ab8ff],
  });
  const p = new Pix(SW, SH);
  // bridge wall + big window on the right
  greebleWall(p, 0, 0, SW, SH, R.wall, 101);
  pool(p, 110, 110, 150, 150, stepMap(pal, -1), 0.8);
  const win: Pt[] = [
    [196, 18],
    [420, 8],
    [420, 196],
    [196, 180],
  ];
  const view = new Pix(SW, SH);
  sky(view, R.space, 0, 0.9, 0.45);
  starfield(view, 5, 0.012, R.star);
  aster(view, 356, 230, 128, { ocean: R.ocean, land: R.land, glow: R.glow, atmo: [R.suit[3]!, R.rim[0]!, R.white[0]!], out: R.out[0]! }, 12, { x: 0.7, y: -0.6 });
  const m = new Pix(SW, SH).poly(win, 1);
  // frame
  p.poly(win.map(([x, y]) => [x + (x < 300 ? -7 : 7), y + (y < 100 ? -7 : 7)] as Pt), R.wall[1]!);
  p.poly(win.map(([x, y]) => [x + (x < 300 ? -3 : 3), y + (y < 100 ? -3 : 3)] as Pt), R.wall[3]!);
  p.blit(view, 0, 0, { map: (c, x, y) => (m.get(x, y) ? c : -1) });
  // mullion
  p.poly([[304, 13], [310, 13], [310, 188], [304, 188]], R.wall[2]!);
  p.vline(304, 13, 188, R.wall[3]!);
  // console glow at the bottom (warm key light source)
  p.rect(0, 206, SW, 34, R.wall[1]!);
  for (let x = 12; x < SW; x += 26) screenPanel(p, x, 214, 18, 8, R.glow, x, R.wall[0]!);
  pool(p, 400, 240, 220, 120, tintMap(pal, R.glow, -0.2), 0.55);
  bust(p, 120, 96, { skin: R.skin, hair: R.hair, suit: R.suit, trim: R.trim, out: R.out[0]!, white: R.white[0]!, rim: R.rim[0]! }, { hair: 'grey', beard: true, light: 1, collar: 'uniform', look: 1 });
  vignette(p, stepMap(pal, -1), 0.8);
  return { pix: p, palette: pal };
}

export function wrenPortrait(): Still {
  const { pal, R } = buildPalette('wrenPortrait', {
    out: [0x0a0710],
    wall: [0x0e1024, 0x1a1e3c, 0x2a3058, 0x404a7c, 0x6470a4],
    space: [0x060816, 0x101834],
    amber: [0x6a2a14, 0xcc6a24, 0xffb44a, 0xffe6a0],
    red: [0x8a1e28, 0xe0404a],
    skin: SKIN_TAN,
    hair: [0x2c120c, 0x5a2414, 0x8e3e1c, 0xc4622c],
    suit: [0x3a1a10, 0x7a3818, 0xb8581e, 0xe68430, 0xffb45c],
    trim: [0x363a4c, 0x5a6074, 0x8a91a6],
    white: [0xfff4e4],
    rim: [0x7ec8ff],
    grey: [0x13111e, 0x363a4c, 0x5a6074, 0x8a91a6, 0xc0c6d4],
    foil: [0x5a3610, 0x9c6416, 0xd69c24, 0xf4d04c],
  });
  const p = new Pix(SW, SH);
  // hangar: deep blue wall, the lander's gold-foil descent stage on the right
  sky(p, R.wall, 0.15, 0.55, 0.45);
  greebleWall(p, 0, 150, SW, 90, R.wall.slice(0, 4), 202, R.amber);
  // gantry beams
  for (let x = 176; x < SW; x += 64) {
    p.rect(x, 0, 8, 160, R.wall[1]!);
    p.vline(x, 0, 160, R.wall[3]!);
    for (let y = 8; y < 160; y += 16) p.line(x + 8, y, x + 40, y + 16, R.wall[2]!);
  }
  // the lander (large, cropped), the real sprite drawn at 8x
  const L = buildLander(8, 'contact');
  drawCraft(p, pal, L, 250, 16, 8);
  // warm work lights + alarm beacon
  glowDisc(p, 190, 44, 34, [R.amber[0]!, R.amber[1]!, R.amber[2]!, R.amber[3]!], { core: 3, onlyOver: true, power: 2.2 });
  glowDisc(p, 392, 176, 12, [R.red[0]!, R.red[1]!, R.white[0]!], { core: 2, onlyOver: true });
  pool(p, 190, 44, 180, 150, stepMap(pal, 1), 0.5);
  bust(p, 128, 100, { skin: R.skin, hair: R.hair, suit: R.suit, trim: R.trim, out: R.out[0]!, white: R.white[0]!, rim: R.rim[0]! }, { hair: 'bun', light: 1, headset: true, collar: 'flight', look: 1 });
  vignette(p, stepMap(pal, -1), 0.8);
  return { pix: p, palette: pal };
}

export function ioPortrait(): Still {
  const { pal, R } = buildPalette('ioPortrait', {
    out: [0x05080c],
    lab: [0x061014, 0x0c1c24, 0x163038, 0x224852, 0x346672],
    holo: [0x0e4a50, 0x1c8a8a, 0x44d0c4, 0xb4fff0],
    warm: [0x6a3218, 0xd08a3c, 0xffd88a],
    skin: SKIN_DEEP,
    hair: [0x0c0808, 0x1e1616, 0x362a28, 0x584440],
    suit: [0x0c2a2c, 0x16484a, 0x246c6a, 0x3a9490, 0x62bab0],
    trim: [0x7a8a90, 0xb8c6c8, 0xe4eeee],
    white: [0xf2fffc],
    rim: [0x9cffe8],
  });
  const p = new Pix(SW, SH);
  sky(p, R.lab, 0.05, 0.5, 0.45);
  // shelves of sample jars and screens
  for (let y = 20; y < 200; y += 44) {
    p.rect(0, y + 30, SW, 4, R.lab[3]!);
    p.hline(0, SW, y + 30, R.lab[4]!);
    for (let x = 6; x < SW; x += 22) {
      const h = 14 + Math.floor(hash2(x, y, 3) * 12);
      if (hash2(x, y, 4) > 0.3) {
        p.rect(x, y + 30 - h, 12, h, R.lab[2]!);
        p.rect(x + 1, y + 30 - h + 5, 10, h - 6, hash2(x, y, 5) > 0.5 ? R.holo[0]! : R.lab[1]!);
        p.vline(x + 2, y + 30 - h + 6, y + 28, R.holo[hash2(x, y, 5) > 0.5 ? 2 : 1]!);
      } else screenPanel(p, x, y + 10, 16, 16, R.holo, x + y, R.lab[3]!);
    }
  }
  // hologram: rotating planet-shard wireframe on the right
  const hx = 330,
    hy = 96;
  glowDisc(p, hx, hy, 80, [R.holo[0]!, R.holo[1]!], { onlyOver: true, power: 1.2 });
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI;
    p.apply((x, y) => {
      const nx = (x - hx) / 44,
        ny = (y - hy) / 44;
      if (nx * nx + ny * ny > 1) return -1;
      const lon = Math.abs(nx - Math.cos(a) * Math.sqrt(Math.max(0, 1 - ny * ny)) * 0.999);
      return lon < 0.03 ? R.holo[2]! : -1;
    }, hx - 46, hy - 46, 92, 92);
  }
  for (let k = -3; k <= 3; k++) p.apply((x, y) => (Math.abs((y - hy) / 44 - k / 4) < 0.018 && Math.hypot(x - hx, y - hy) < 44 ? R.holo[2]! : -1), hx - 46, hy - 46, 92, 92);
  p.ellipse(hx, hy, 44, 44, (x, y, nx, ny) => (nx * nx + ny * ny > 0.92 ? R.holo[3]! : -1));
  for (const [dx, dy] of [[-64, -30], [58, 40], [60, -44]] as const) p.poly([[hx + dx, hy + dy - 8], [hx + dx + 10, hy + dy], [hx + dx + 2, hy + dy + 9], [hx + dx - 8, hy + dy + 2]], R.holo[2]!);
  // desk lamp: the warm key from the left
  glowDisc(p, 10, 150, 26, [R.warm[0]!, R.warm[1]!, R.warm[2]!], { core: 3, onlyOver: true });
  pool(p, 0, 160, 200, 160, tintMap(pal, R.warm, -0.1), 0.45);
  bust(p, 146, 98, { skin: R.skin, hair: R.hair, suit: R.suit, trim: R.trim, out: R.out[0]!, white: R.white[0]!, rim: R.rim[0]! }, { hair: 'curly', glasses: true, light: -1, collar: 'lab', look: 1 });
  vignette(p, stepMap(pal, -1), 0.8);
  return { pix: p, palette: pal };
}

// --------------------------------------------------------- briefing deck

export function halcyonBriefingDeck(): Still {
  const { pal, R } = buildPalette('halcyonBriefingDeck', {
    out: [0x05050c],
    wall: [0x0a0c1c, 0x141834, 0x20264a, 0x323a66, 0x4c5688],
    space: [0x060814, 0x0e1432],
    star: [0x5a6aa8, 0xd0dcff],
    ocean: [0x0e2a4c, 0x1d5288, 0x3a8cc4, 0x9ad6ec],
    land: [0x22302a, 0x4a6440, 0x88a05a],
    glow: [0x7a2a16, 0xe07424, 0xffc664, 0xfff2c4],
    holo: [0x0e4a54, 0x1f8c92, 0x52dcd6, 0xc0fff4],
    skin: [0x6e3a24, 0xc07a50, 0xf0b888],
    navy: [0x0c1230, 0x1e2c5e, 0x3a52a0],
    orange: [0x6a2a10, 0xc0581e, 0xf49040],
    teal: [0x0e3434, 0x1e6664, 0x3aa29a],
    hair: [0x1a1010, 0x5a2a16, 0x9a9aa8],
  });
  const p = new Pix(SW, SH);
  // back wall with the panoramic window
  greebleWall(p, 0, 0, SW, 150, R.wall.slice(0, 4), 303, R.glow);
  const wy0 = 16,
    wy1 = 118;
  const view = new Pix(SW, SH);
  sky(view, R.space, 0, 1, 0.45);
  starfield(view, 9, 0.014, R.star);
  aster(view, 213, 250, 170, { ocean: R.ocean, land: R.land, glow: R.glow, atmo: [R.navy[2]!, R.holo[2]!, R.holo[3]!], out: R.out[0]! }, 12, { x: -0.3, y: -0.9 });
  // window band (slightly curved) with mullions
  const curve = (x: number) => Math.pow((x - 213) / 213, 2) * 10;
  p.apply((x, y) => (y >= wy0 - 4 + curve(x) && y <= wy1 + 4 - curve(x) ? R.wall[3]! : -1), 24, 0, SW - 48, SH);
  p.apply((x, y) => (y >= wy0 + curve(x) && y <= wy1 - curve(x) ? view.get(x, y) : -1), 28, 0, SW - 56, SH);
  for (let x = 28; x <= SW - 28; x += 62) {
    p.rect(x - 3, 0, 6, 140, R.wall[2]!);
    p.vline(x - 3, 0, 140, R.wall[4]!);
    p.vline(x + 2, 0, 140, R.wall[1]!);
  }
  // floor with perspective seams
  sky(p, [R.wall[1]!, R.wall[2]!, R.wall[3]!], 0, 1, 0.45, 146, SH - 146);
  p.hline(0, SW, 146, R.wall[4]!);
  for (let k = -8; k <= 8; k++) p.line(213 + k * 12, 147, 213 + k * 70, SH, R.wall[1]!);
  // planet-light beams through the window onto the floor
  for (let x = 28; x < SW - 60; x += 62) {
    beam(p, [[x + 6, wy1 - curve(x)], [x + 56, wy1 - curve(x + 56)], [x + 70 + (x - 213) * 0.3, SH], [x + 10 + (x - 213) * 0.3, SH]], stepMap(pal, 1), (_, y) => 0.25 - (y - 118) / 700);
  }
  // holo table
  const tx = 213,
    ty = 178;
  p.poly([[tx - 70, ty], [tx + 70, ty], [tx + 52, ty + 38], [tx - 52, ty + 38]], (x, y) => rampAt(R.wall, 0.3 + (x - tx) / 400 - (y - ty) / 120, x, y, 0.4));
  p.ellipse(tx, ty, 72, 13, R.wall[3]!);
  p.ellipse(tx, ty, 66, 11, (x, y, nx, ny) => rampAt(R.holo, 0.55 - Math.hypot(nx, ny) * 0.5, x, y, 0.5));
  // hologram: Aster above the table
  beam(p, [[tx - 60, ty], [tx + 60, ty], [tx + 38, ty - 92], [tx - 38, ty - 92]], tintMap(pal, R.holo, 0.1), (_, y) => 0.4 - (ty - y) / 260);
  p.ellipse(tx, ty - 58, 28, 28, (x, y, nx, ny) => {
    const band = Math.abs(Math.sin((nx * 3 + ny * 1.4) * 2.2));
    if ((nx * nx + ny * ny) > 0.85) return R.holo[3]!;
    return band < 0.18 ? R.holo[3]! : (x + y) % 2 === 0 ? R.holo[1]! : -1;
  });
  // figures around the table: commander pointing, Wren, Io
  const fig = (x: number, base: number, suit: readonly number[], hair: readonly number[], o: Parameters<typeof figure>[4]) =>
    figure(p, x, base, { suit, skin: R.skin, hair, out: R.out[0]! }, o);
  fig(96, 214, R.navy, [R.hair[2]!, R.hair[2]!], { h: 60, facing: 1, pose: 'point', light: 1, hairStyle: 'grey' });
  fig(318, 212, R.orange, [R.hair[0]!, R.hair[1]!], { h: 56, facing: -1, light: -1, hairStyle: 'bun' });
  fig(356, 222, R.teal, [R.hair[0]!, R.hair[0]!], { h: 58, facing: -1, light: -1, hairStyle: 'curly' });
  // warm ceiling lamps
  for (const lx of [80, 346]) {
    p.rect(lx - 8, 0, 16, 3, R.wall[4]!);
    pool(p, lx, 170, 70, 60, tintMap(pal, R.glow, -0.25), 0.3);
  }
  // cool holo glow on everything near the table
  pool(p, tx, ty - 30, 150, 80, stepMap(pal, 1), 0.35);
  vignette(p, stepMap(pal, -1), 0.9);
  return { pix: p, palette: pal };
}

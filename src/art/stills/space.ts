/**
 * Space and cockpit stills: Aster from orbit, the hangar launch, the lander
 * cockpit and the rough CSM cockpit.
 */

import { Pix, type Pt } from '../core/pix';
import { rampAt } from '../core/palette';
import { fbm } from '../core/noise';
import { hash2, mulberry32 } from '../core/rng';
import { rockBlob } from '../core/shapes';
import { cloud } from '../nature';
import { buildLander } from '../sprites/vessels';
import {
  aster,
  beam,
  buildPalette,
  drawCraft,
  figure,
  frameAround,
  glowDisc,
  greebleWall,
  pool,
  rotated,
  screenPanel,
  SH,
  sky,
  starfield,
  stepMap,
  streaks,
  SW,
  tintMap,
  vignette,
} from './kit';
import type { Still } from './types';

const GREY = [0x363a4c, 0x5a6074, 0x8a91a6, 0xc0c6d4] as const;
const FOIL = [0x9c6416, 0xd69c24, 0xf4d04c] as const;

// ------------------------------------------------------------ from orbit

export function asterFromOrbit(): Still {
  const { pal, R } = buildPalette('asterFromOrbit', {
    out: [0x04040c],
    space: [0x06071a, 0x0e1034, 0x1c1a4e, 0x322868],
    star: [0x585c9c, 0xb8c4ff, 0xffffff],
    ocean: [0x0b2042, 0x174478, 0x2e76aa, 0x7cc2da],
    land: [0x1e2a28, 0x3c5838, 0x748e4a, 0xc4bc7a],
    glow: [0x6c2412, 0xd05a1c, 0xffa83c, 0xfff0b4],
    atmo: [0x2c4c94, 0x74aee8, 0xd6f2ff],
    hull: [0x1a1a2e, 0x3c4060, 0x767e9e, 0xc0c8da],
  });
  const p = new Pix(SW, SH);
  const pcx = 318,
    pcy = 300,
    pr = 158;
  p.apply((x, y) => {
    const d = Math.hypot(x - pcx, y - pcy);
    const neb = fbm(x, y, 44, { scale: 70, octaves: 4 });
    const t = Math.max(0, 1 - (d - pr) / 330) * 0.75 + (neb - 0.5) * 0.7;
    return rampAt(R.space, t, x, y, 0.45);
  });
  starfield(p, 3, 0.02, R.star);
  // the distant sun, top-left
  glowDisc(p, 48, 40, 60, [R.space[3]!, R.glow[1]!, R.glow[2]!, R.glow[3]!, R.star[2]!], { core: 4, onlyOver: true, power: 3 });
  // Aster: shattered crust, glowing hollow showing through
  const lx = 48 - pcx,
    ly = 40 - pcy,
    ll = Math.hypot(lx, ly);
  aster(p, pcx, pcy, pr, { ocean: R.ocean, land: R.land, glow: R.glow, atmo: R.atmo, out: R.out[0]! }, 12, { x: lx / ll, y: ly / ll });
  // crust fragments drifting above the limb
  const rng = mulberry32(8);
  for (let i = 0; i < 160; i++) {
    const a = rng.range(Math.PI * 1.02, Math.PI * 1.98);
    const rr = pr + rng.range(4, 12) + Math.pow(rng.next(), 3) * 40;
    const x = pcx + Math.cos(a) * rr,
      y = pcy + Math.sin(a) * rr;
    const s = rng.next() < 0.1 ? rng.range(2, 4) : rng.range(0.6, 1.6);
    const lit = Math.cos(a - Math.atan2(ly, lx));
    p.ellipse(x, y, s, s * 0.8, (xx, yy, nx, ny) => rampAt(R.land, 0.35 + lit * 0.4 - (nx + ny) * 0.2, xx, yy, 0.4));
  }
  // the Halcyon, approaching
  const h = new Pix(SW, SH);
  const hx = 70,
    hy = 118;
  const hullT = (y: number, top: number, bot: number) => 0.85 - ((y - top) / Math.max(1, bot - top)) * 0.8;
  // engine block
  h.poly([[hx, hy - 12], [hx + 20, hy - 10], [hx + 20, hy + 14], [hx, hy + 16]], (x, y) => rampAt(R.hull, hullT(y, hy - 12, hy + 16), x, y, 0.4));
  // spine
  h.poly([[hx + 18, hy - 5], [hx + 118, hy - 7], [hx + 136, hy], [hx + 118, hy + 8], [hx + 18, hy + 7]], (x, y) => rampAt(R.hull, hullT(y, hy - 7, hy + 8), x, y, 0.4));
  // cargo pods
  for (let k = 0; k < 4; k++) {
    const cx = hx + 30 + k * 14;
    h.rect(cx, hy - 12, 10, 6, R.hull[2]!).hline(cx, cx + 9, hy - 12, R.hull[3]!);
    h.rect(cx, hy + 7, 10, 5, R.hull[1]!);
  }
  // habitat ring (edge-on)
  h.ellipse(hx + 96, hy, 7, 26, (x, y, nx, ny) => (nx * nx + ny * ny > 0.45 ? rampAt(R.hull, 0.8 - ny * 0.5 - nx * 0.2, x, y, 0.4) : -1));
  h.rect(hx + 95, hy - 22, 2, 44, R.hull[1]!);
  // bridge
  h.poly([[hx + 112, hy - 7], [hx + 124, hy - 12], [hx + 130, hy - 6]], R.hull[3]!);
  h.outline(R.out[0]!);
  // window lights
  for (let x = hx + 22; x < hx + 116; x += 3) if (hash2(x, 1, 3) > 0.4) h.set(x, hy - 1, R.glow[2]!);
  p.blit(h, 0, 0);
  // engine glow
  glowDisc(p, hx - 2, hy + 2, 18, [R.atmo[0]!, R.atmo[1]!, R.atmo[2]!, R.star[2]!], { core: 2, power: 2 });
  streaks(p, 4, 6, [R.atmo[0]!, R.atmo[1]!], Math.PI, [20, 50], { x: hx - 4, y: hy - 4, w: 1, h: 12 });
  vignette(p, stepMap(pal, -1), 0.7);
  return { pix: p, palette: pal };
}

// ------------------------------------------------------------ hangar launch

export function hangarLaunch(): Still {
  const { pal, R } = buildPalette('hangarLaunch', {
    out: [0x06060f],
    steel: [0x0a0b1c, 0x151a3a, 0x252a52, 0x3c4375, 0x5e679e, 0x8a93c4],
    space: [0x04050e, 0x0c1028],
    star: [0x7a86c0, 0xffffff],
    planet: [0x1b4a92, 0x3584cf, 0x8ccaf2],
    land: [0x24402e, 0x4a7040],
    amber: [0x6e2e16, 0xdc7428, 0xffc860, 0xfff0c0],
    red: [0x7a1a22, 0xc8303c],
    grey: GREY,
    foil: FOIL,
  });
  const p = new Pix(SW, SH);
  const dx0 = 133,
    dx1 = 293,
    dy0 = 50,
    dy1 = 146;
  // walls (greebled, cool)
  greebleWall(p, 0, 0, SW, SH, R.steel.slice(0, 5), 55, R.amber);
  // ceiling
  p.poly([[0, 0], [SW, 0], [dx1, dy0], [dx0, dy0]], (x, y) => rampAt(R.steel, 0.1 + (y / dy0) * 0.25, x, y, 0.45));
  for (let k = -6; k <= 6; k++) p.line(213 + k * 13, dy0, 213 + k * 70, 0, R.steel[1]!);
  // floor
  p.poly([[0, SH], [SW, SH], [dx1, dy1], [dx0, dy1]], (x, y) => rampAt(R.steel, 0.5 - ((y - dy1) / (SH - dy1)) * 0.3, x, y, 0.45));
  for (let k = -6; k <= 6; k++) p.line(213 + k * 13, dy1, 213 + k * 75, SH, R.steel[2]!);
  // hazard centre line
  for (let k = 0; k < 9; k++) {
    const t0 = k / 9,
      t1 = (k + 0.5) / 9;
    const ya = dy1 + Math.pow(t0, 1.6) * (SH - dy1),
      yb = dy1 + Math.pow(t1, 1.6) * (SH - dy1);
    const wa = 2 + t0 * 10,
      wb = 2 + t1 * 10;
    p.poly([[213 - wa, ya], [213 + wa, ya], [213 + wb, yb], [213 - wb, yb]], R.amber[1]!);
  }
  // receding frame ribs
  for (const k of [0.28, 0.55, 0.8]) {
    const x0 = dx0 * k,
      x1 = SW - dx0 * k,
      y0 = dy0 * k,
      y1 = SH - (SH - dy1) * k;
    const c = R.steel[k > 0.6 ? 2 : 3]!;
    for (let t = 0; t < 4 - k * 2; t++) {
      p.hline(x0, x1, y0 + t, c);
      p.vline(x0 + t, y0, y1, c);
      p.vline(x1 - t, y0, y1, c);
    }
    p.hline(x0, x1, y0, R.steel[4]!);
    // red wall beacons
    glowDisc(p, x0 + 6, (y0 + y1) / 2, 7 * (1 - k * 0.5), [R.red[0]!, R.red[1]!, R.amber[3]!], { core: 1, onlyOver: true });
    glowDisc(p, x1 - 6, (y0 + y1) / 2, 7 * (1 - k * 0.5), [R.red[0]!, R.red[1]!, R.amber[3]!], { core: 1, onlyOver: true });
  }
  // open bay door: space + planet
  const view = new Pix(SW, SH);
  sky(view, R.space, 0, 1, 0.45);
  starfield(view, 21, 0.03, R.star);
  aster(view, 250, 250, 120, { ocean: R.planet, land: R.land, glow: R.amber, atmo: [R.planet[1]!, R.planet[2]!, R.star[1]!], out: R.out[0]! }, 12, { x: -0.5, y: -0.8 });
  p.apply((x, y) => view.get(x, y), dx0, dy0, dx1 - dx0, dy1 - dy0);
  // door frame with hazard stripes
  for (let t = 1; t <= 5; t++) {
    p.hline(dx0 - t, dx1 + t, dy0 - t, R.steel[t < 3 ? 4 : 2]!);
    p.vline(dx0 - t, dy0 - t, dy1, R.steel[t < 3 ? 4 : 2]!);
    p.vline(dx1 + t - 1, dy0 - t, dy1, R.steel[t < 3 ? 4 : 2]!);
  }
  for (let x = dx0 - 5; x < dx1 + 5; x++) for (let y = dy0 - 11; y < dy0 - 5; y++) p.set(x, y, (x + y) % 10 < 5 ? R.amber[2]! : R.out[0]!);
  // lander lifting off, big flame
  const s = 4;
  const L = buildLander(s, 'flight');
  const lx = 213 - L.pix.w / 2,
    ly = 30;
  pool(p, 213, 216, 170, 50, tintMap(pal, R.amber, 0.1), 0.9, 0.9);
  drawCraft(p, pal, L, lx, ly, s, { flame: 1.5, frame: 1, seed: 7 });
  // exhaust smoke rolling across the floor, lit by the flame
  const smoke = [R.steel[2]!, R.steel[3]!, R.steel[4]!];
  for (let k = 0; k < 9; k++) {
    const d = Math.abs(k - 4);
    cloud(p, 213 + (k - 4) * 34, 226 + d * 2, 90 - d * 6, 22 - d, d < 2 ? [R.steel[3]!, R.amber[1]!, R.amber[2]!] : smoke, 90 + k);
  }
  // crew on the side catwalks
  for (const [x, side] of [[40, 1], [388, -1]] as const) {
    p.rect(side > 0 ? 0 : 346, 176, 80, 4, R.steel[4]!);
    p.rect(side > 0 ? 0 : 346, 180, 80, 3, R.steel[1]!);
    for (let k = 0; k < 80; k += 10) p.vline((side > 0 ? 0 : 346) + k, 164, 176, R.steel[3]!);
    p.hline(side > 0 ? 0 : 346, (side > 0 ? 0 : 346) + 79, 164, R.steel[4]!);
  }
  const crew = { suit: [R.steel[1]!, R.steel[3]!, R.steel[4]!, R.steel[5]!], skin: [R.amber[0]!, R.amber[1]!, R.amber[2]!], hair: [R.steel[5]!, R.steel[5]!], out: R.out[0]! };
  figure(p, 44, 176, crew, { h: 26, facing: 1, pose: 'wave', light: 1, hairStyle: 'grey' });
  figure(p, 64, 176, crew, { h: 24, facing: 1, light: 1 });
  figure(p, 384, 176, crew, { h: 24, facing: -1, light: -1, pose: 'wave' });
  vignette(p, stepMap(pal, -1), 0.8);
  return { pix: p, palette: pal };
}

// ------------------------------------------------------------ cockpits

interface CrewBackRamps {
  suit: readonly number[];
  stripe: number;
  seat: readonly number[];
  out: number;
}

/** A crew member seen from behind in a high-backed seat; (x, y) = helmet centre. */
function crewFromBehind(p: Pix, x: number, y: number, k: number, R: CrewBackRamps, lightX: number): void {
  const b = new Pix(p.w, p.h);
  // shoulders
  b.ellipse(x, y + 40 * k, 50 * k, 22 * k, (xx, yy, nx, ny) => rampAt(R.suit, 0.55 - ny * 0.4 + nx * lightX * 0.25, xx, yy, 0.4));
  // helmet
  b.ellipse(x, y, 25 * k, 27 * k, (xx, yy, nx, ny) => rampAt(R.suit, 0.62 - ny * 0.45 + nx * lightX * 0.35, xx, yy, 0.4));
  b.apply((xx, yy, c) => (c !== 0 && Math.abs(xx - x) <= 2 * k && yy < y + 20 * k ? R.stripe : -1), x - 3 * k, y - 28 * k, 7 * k, 50 * k);
  // seat back in front
  b.poly(
    [
      [x - 40 * k, y + 22 * k],
      [x + 40 * k, y + 22 * k],
      [x + 46 * k, SH + 4],
      [x - 46 * k, SH + 4],
    ],
    (xx, yy) => rampAt(R.seat, 0.45 - (yy - y) / (200 * k) + ((xx - x) / (40 * k)) * lightX * 0.2 + (Math.abs(xx - x) > 34 * k ? 0.15 : 0), xx, yy, 0.4),
  );
  for (let yy = y + 36 * k; yy < SH; yy += 14 * k) b.hline(x - 36 * k, x + 36 * k, yy, R.seat[0]!);
  b.outline(R.out);
  p.blit(b, 0, 0);
}

export function landerCockpit(): Still {
  const { pal, R } = buildPalette('landerCockpit', {
    out: [0x040509],
    cabin: [0x07080f, 0x0f1220, 0x1a1f34, 0x2a3150, 0x3e4870],
    space: [0x04050c, 0x0a1026],
    star: [0x6a78b8, 0xe6eeff],
    ocean: [0x0c2444, 0x1a4c80, 0x3888c0],
    land: [0x1c2824, 0x3a5438, 0x70884a, 0xbab070],
    glow: [0x6e2412, 0xd05a1c, 0xffa83c, 0xfff0b4],
    atmo: [0x2c4c94, 0x74aee8, 0xd6f2ff],
    amber: [0x5a2810, 0xc06a20, 0xffb040],
    green: [0x0e3a24, 0x2c9a54, 0x9cf0a0],
    suit: [0x3a3c4c, 0x6e7288, 0xa8aec4, 0xe0e4f0],
    orange: [0xe0702a],
    teal: [0x3ab0a4],
  });
  const p = new Pix(SW, SH);
  greebleWall(p, 0, 0, SW, SH, R.cabin, 71, R.green);
  // windows (the LM's angled triangles)
  const winL: Pt[] = [[34, 22], [196, 38], [196, 120], [74, 116]];
  const winR: Pt[] = winL.map(([x, y]) => [426 - x, y] as Pt);
  const view = new Pix(SW, SH);
  sky(view, R.space, 0, 1, 0.45);
  starfield(view, 17, 0.02, R.star);
  aster(view, 250, 600, 520, { ocean: R.ocean, land: R.land, glow: R.glow, atmo: R.atmo, out: R.out[0]! }, 31, { x: 0.6, y: -0.8 });
  for (const w of [winL, winR]) {
    frameAround(p, w, 7, [R.cabin[1]!, R.cabin[3]!, R.cabin[4]!, R.cabin[2]!]);
    const m = new Pix(SW, SH).poly(w, 1);
    p.blit(view, 0, 0, { map: (c, x, y) => (m.get(x, y) ? c : -1) });
    // glass glints
    const [a, b] = [w[0]!, w[2]!];
    for (let k = 0; k < 2; k++) {
      const ox = k * 9;
      p.apply((x, y) => (m.get(x, y) && Math.abs(x - a[0] - ox - (y - a[1]) * 0.9 - 40) < 1.2 && (y - a[1]) < 40 ? R.star[0]! : -1), Math.min(a[0], b[0]), a[1] - 20, 200, 80);
    }
  }
  // window light falling into the cabin
  beam(p, [[74, 116], [196, 120], [220, SH], [30, SH]], stepMap(pal, 1), (_, y) => 0.3 - (y - 116) / 400);
  beam(p, [[352, 116], [230, 120], [206, SH], [396, SH]], stepMap(pal, 1), (_, y) => 0.3 - (y - 116) / 400);
  // instrument panel
  p.poly([[0, 128], [SW, 128], [SW, 196], [0, 196]], (x, y) => rampAt(R.cabin, 0.35 - (y - 128) / 200, x, y, 0.4));
  p.hline(0, SW, 128, R.cabin[4]!);
  const rng = mulberry32(12);
  for (let x = 8; x < SW - 20; x += rng.int(22, 34)) {
    if (rng.chance(0.55)) screenPanel(p, x, 136 + rng.int(0, 10), rng.int(14, 22), rng.int(9, 14), rng.chance(0.5) ? R.green : R.amber, x, R.cabin[0]!);
    else for (let k = 0; k < 6; k++) p.set(x + (k % 3) * 5 + 2, 140 + Math.floor(k / 3) * 6, rng.chance(0.3) ? R.amber[2]! : R.amber[1]!);
  }
  // centre pillar with the attitude ball
  p.poly([[196, 20], [230, 20], [228, 132], [198, 132]], (x, y) => rampAt(R.cabin, 0.3 + (x - 196) / 100, x, y, 0.4));
  p.ellipse(213, 84, 11, 11, (x, y, nx, ny) => (ny < 0.1 * nx ? rampAt(R.suit, 0.8 - ny, x, y, 0.4) : rampAt(R.amber, 0.5 - ny * 0.3, x, y, 0.4)));
  p.ellipse(213, 84, 12, 12, (x, y, nx, ny) => (nx * nx + ny * ny > 0.84 ? R.out[0]! : -1));
  // warm panel glow on the crew + cabin
  pool(p, 213, 160, 260, 80, tintMap(pal, R.amber, -0.1), 0.45);
  crewFromBehind(p, 116, 150, 1.05, { suit: R.suit, stripe: R.orange[0]!, seat: R.cabin.slice(1), out: R.out[0]! }, 1);
  crewFromBehind(p, 312, 152, 1.05, { suit: R.suit, stripe: R.teal[0]!, seat: R.cabin.slice(1), out: R.out[0]! }, -1);
  pool(p, 213, 132, 240, 60, tintMap(pal, R.amber, 0), 0.3);
  vignette(p, stepMap(pal, -1), 0.9);
  return { pix: p, palette: pal };
}

export function csmCockpitRough(): Still {
  const { pal, R } = buildPalette('csmCockpitRough', {
    out: [0x060305],
    cabin: [0x0c080a, 0x181014, 0x281a20, 0x3a2630, 0x543a46],
    red: [0x4a0c12, 0x9a1a24, 0xe83a3a, 0xff9a8a],
    ember: [0x5a1a0a, 0xb8401a, 0xff8a2a, 0xffd070],
    space: [0x06040a, 0x140c18],
    rock: [0x1c1416, 0x3a2a28, 0x5e4640, 0x8a6a58],
    suit: [0x3a3c4c, 0x6e7288, 0xa8aec4, 0xe0e4f0],
    green: [0x0e3a24, 0x3ab064],
  });
  const W = 500,
    H = 310;
  const q = new Pix(W, H);
  greebleWall(q, 0, 0, W, H, R.cabin, 88, R.red);
  // the two forward windows (cone walls lean in)
  const cx = W / 2;
  const wins: Pt[][] = [
    [[cx - 150, 62], [cx - 34, 70], [cx - 38, 150], [cx - 138, 142]],
    [[cx + 34, 70], [cx + 150, 62], [cx + 138, 142], [cx + 38, 150]],
  ];
  const view = new Pix(W, H);
  sky(view, R.space, 0, 1, 0.45);
  streaks(view, 5, 70, [R.ember[0]!, R.ember[1]!, R.ember[2]!, R.ember[3]!], 2.6, [16, 70]);
  const rng = mulberry32(19);
  for (let i = 0; i < 9; i++) {
    const x = rng.range(cx - 150, cx + 150),
      y = rng.range(60, 150),
      r = rng.range(5, 18);
    streaks(view, 40 + i, 6, [R.ember[0]!, R.ember[1]!, R.ember[2]!], 2.6 + Math.PI, [r * 2, r * 4], { x: x - 2, y: y - 2, w: 4, h: 4 });
    rockBlob(view, x, y, r, r * 0.8, 60 + i, R.rock, { rough: 0.35 });
    view.ellipse(x - r * 0.4, y + r * 0.3, r * 0.5, r * 0.3, (xx, yy) => (view.get(xx, yy) ? rampAt(R.ember, 0.6, xx, yy, 0.4) : -1));
  }
  for (const w of wins) {
    frameAround(q, w, 8, [R.cabin[0]!, R.cabin[2]!, R.cabin[4]!, R.cabin[1]!]);
    const m = new Pix(W, H).poly(w, 1);
    q.blit(view, 0, 0, { map: (c, x, y) => (m.get(x, y) ? c : -1) });
    // cracked glass
    const c0 = w[0]!;
    q.path([[c0[0] + 30, c0[1] + 20], [c0[0] + 44, c0[1] + 34], [c0[0] + 40, c0[1] + 52], [c0[0] + 58, c0[1] + 60]], R.red[3]!);
    q.path([[c0[0] + 44, c0[1] + 34], [c0[0] + 66, c0[1] + 30]], R.red[3]!);
  }
  // panel
  q.poly([[0, 166], [W, 166], [W, 236], [0, 236]], (x, y) => rampAt(R.cabin, 0.4 - (y - 166) / 160, x, y, 0.4));
  for (let x = 30; x < W - 30; x += 30) screenPanel(q, x, 176 + (x % 3) * 3, 20, 12, x % 90 === 0 ? R.green : R.red, x, R.cabin[0]!);
  // sparks from a blown panel
  streaks(q, 77, 18, [R.ember[3]!, R.ember[2]!, R.ember[1]!], 0.4, [4, 16], { x: 420, y: 170, w: 10, h: 10 });
  glowDisc(q, 424, 174, 14, [R.ember[1]!, R.ember[2]!, R.ember[3]!], { core: 2, onlyOver: true });
  // red alarm light and wash
  glowDisc(q, cx, 20, 34, [R.red[1]!, R.red[2]!, R.red[3]!], { core: 5, onlyOver: true, power: 2 });
  pool(q, cx, 60, 360, 260, tintMap(pal, R.red, 0.05), 0.55, 0.8);
  // crew braced in their couches
  crewFromBehind(q, cx - 104, 212, 1.15, { suit: R.suit, stripe: R.ember[2]!, seat: R.cabin.slice(1), out: R.out[0]! }, 1);
  crewFromBehind(q, cx + 110, 216, 1.15, { suit: R.suit, stripe: R.green[1]!, seat: R.cabin.slice(1), out: R.out[0]! }, -1);
  pool(q, cx, 200, 300, 120, tintMap(pal, R.red, -0.1), 0.35);
  // loose bolts floating
  for (let i = 0; i < 14; i++) q.set(rng.range(40, W - 40), rng.range(20, 170), R.suit[2]!);
  const p = rotated(q, SW, SH, -0.13);
  vignette(p, stepMap(pal, -1), 1);
  return { pix: p, palette: pal };
}

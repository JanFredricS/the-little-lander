/**
 * Parallax backdrops: 3–4 wide tiling layers per theme, far -> near.
 * Layer 0 is the screen-fixed sky (parallax 0). All pixels come from the
 * theme palette; far layers use the theme's cooler/hazier ramps (the
 * floating-islands-sky-moon ref: blue-white far, saturated near).
 */

import { VIEW_HEIGHT, VIEW_WIDTH } from '../contracts';
import type { Palette, ThemeId } from '../contracts';
import { Pix } from './core/pix';
import { bayer, rampAt } from './core/palette';
import { fbm, valueNoise } from './core/noise';
import { hash2, mulberry32 } from './core/rng';
import { halo, rockBlob, vGradient } from './core/shapes';
import { cloud, floatingIsland, palm, ridgeProfile, strand, waterfall } from './nature';
import { natureRamps } from './sprites/props';
import { padRamps, PALETTES } from './palettes';

export interface BackdropLayerPix {
  pix: Pix;
  parallax: number;
  offsetY: number;
  repeatX: boolean;
  repeatY: boolean;
  label: string;
}

const W = VIEW_WIDTH;
const H = VIEW_HEIGHT;

/** Call `fn` for dx in {-w, 0, w} (and dy likewise when wrapY) so shapes wrap seamlessly. */
function wrapped(fn: (dx: number, dy: number) => void, wrapY = false, w = W, h = H): void {
  for (const dx of [-w, 0, w]) for (const dy of wrapY ? [-h, 0, h] : [0]) fn(dx, dy);
}

function stars(p: Pix, seed: number, density: number, ramp: readonly number[], yMax = H): void {
  const rng = mulberry32(seed);
  const n = Math.floor(p.w * yMax * density);
  for (let i = 0; i < n; i++) {
    const x = rng.int(0, p.w - 1);
    const y = rng.int(0, yMax - 1);
    const b = rng.next();
    p.set(x, y, ramp[b > 0.9 ? ramp.length - 1 : b > 0.6 ? Math.max(0, ramp.length - 2) : 0]!);
    if (b > 0.985) {
      // twinkle cross
      const c = ramp[Math.max(0, ramp.length - 2)]!;
      p.set(x - 1, y, c).set(x + 1, y, c).set(x, y - 1, c).set(x, y + 1, c);
    }
  }
}

/** Periodic silhouette band: fills below a ridge profile with a flat shade (+ optional top rim). */
function ridgeBand(p: Pix, base: number, amp: number, seed: number, scale: number, fill: number, rim?: number, fromTop = false): void {
  const prof = ridgeProfile(p.w, base, amp, seed, scale);
  for (let x = 0; x < p.w; x++) {
    const top = Math.round(prof[x]!);
    if (fromTop) {
      // mirrored: `base` measured from the top edge
      const bottom = Math.round(2 * base - top);
      for (let y = 0; y < bottom; y++) p.set(x, y, fill);
      if (rim !== undefined) p.set(x, bottom - 1, rim);
    } else {
      for (let y = top; y < p.h; y++) p.set(x, y, fill);
      if (rim !== undefined) p.set(x, top, rim);
    }
  }
}

// ================================================================ hangar

function hangar(_pal: Palette): BackdropLayerPix[] {
  // L0: navy space + planet horizon arc (space-station deck ref)
  const sky = new Pix(W, H);
  vGradient(sky, 0, 0, W, H, [1, 2, 2, 3], 0, 1, 0.45);
  stars(sky, 11, 0.0022, [5, 7, 8]);
  // planet: huge disc whose top arc crosses the lower third
  const pcx = W / 2,
    pcy = H + 700,
    pr = 900;
  sky.apply((x, y) => {
    const d = Math.hypot(x + 0.5 - pcx, (y + 0.5 - pcy) * 1.0) - pr;
    if (d > 6) return -1;
    if (d > 0) return bayer(x, y) < (6 - d) / 10 ? 10 : -1; // atmosphere glow
    const depth = -d;
    const cl = fbm(x, y * 3.2, 13, { scale: 20, octaves: 4, tileW: 640 });
    if (depth < 2) return 11;
    if (cl > 0.58) return cl > 0.66 ? 8 : 11; // cloud swirls
    return rampAt([9, 10], 0.9 - depth / 90 + (cl - 0.5) * 0.6, x, y, 0.6);
  });
  // L1: distant deck structure silhouettes
  const far = new Pix(W, H);
  for (let x = 0; x < W; x += 80) {
    far.rect(x + 10, 60, 10, H - 60, 3);
    far.vline(x + 10, 60, H, 4);
  }
  far.rect(0, 52, W, 10, 3);
  far.hline(0, W - 1, 52, 4);
  for (let x = 0; x < W; x += 40) {
    const hx = x + 26;
    const len = 50 + Math.floor(hash2(x, 1, 3) * 40);
    far.rect(hx, 62, 8, len, 3);
    far.vline(hx, 62, 62 + len - 1, 4);
    for (let y = 66; y < 62 + len - 2; y += 4) for (const dx of [2, 5]) if (hash2(hx + dx, y, 9) > 0.7) far.set(hx + dx, y, hash2(hx, y, 4) > 0.8 ? 13 : 10);
  }
  // L2: near chunky overhead beam + pillars
  const near = new Pix(W, H);
  const beam = (y: number, h: number) => {
    near.rect(0, y, W, h, 4);
    near.hline(0, W - 1, y, 6);
    near.hline(0, W - 1, y + 1, 5);
    near.hline(0, W - 1, y + h - 1, 1);
    for (let x = 6; x < W; x += 24) {
      near.rect(x, y + 4, 16, h - 8, 3);
      near.hline(x, x + 15, y + 4, 5);
      near.set(x + 7, y + h / 2, 6);
    }
  };
  beam(0, 22);
  for (let x = 100; x < W; x += 320) {
    near.rect(x, 22, 18, H - 22, 4);
    near.vline(x, 22, H - 1, 6);
    near.vline(x + 1, 22, H - 1, 5);
    near.vline(x + 17, 22, H - 1, 1);
    for (let y = 40; y < H; y += 60) {
      near.rect(x + 4, y, 10, 22, 3);
      near.set(x + 8, y + 6, 14);
    }
  }
  return [
    { pix: sky, parallax: 0, offsetY: 0, repeatX: true, repeatY: false, label: 'space + planet horizon' },
    { pix: far, parallax: 0.2, offsetY: 0, repeatX: true, repeatY: false, label: 'far deck structure' },
    { pix: near, parallax: 0.5, offsetY: 0, repeatX: true, repeatY: false, label: 'near beams & pillars' },
  ];
}

// ============================================================== asteroid

function asteroid(_pal: Palette): BackdropLayerPix[] {
  const sky = new Pix(W, H);
  vGradient(sky, 0, 0, W, H, [1, 2, 2, 12], 0, 1, 0.45);
  // purple nebula wisps
  sky.apply((x, y) => {
    const n = fbm(x, y, 21, { scale: 64, octaves: 4, tileW: W });
    if (n > 0.64) return bayer(x, y) < (n - 0.64) * 4 ? (n > 0.72 ? 13 : 12) : -1;
    return -1;
  });
  stars(sky, 22, 0.002, [5, 7, 15]);
  // ember glow of the planet's upper atmosphere below
  sky.apply((x, y) => {
    const t = (y - (H - 70)) / 70;
    if (t < 0) return -1;
    const n = valueNoise(x / 24, 3, 23, W / 24);
    return bayer(x, y) < t * (0.6 + n * 0.5) ? (t > 0.7 ? 9 : 8) : -1;
  });
  const layer = (seed: number, count: number, rmin: number, rmax: number, ramp: readonly number[], ember: boolean) => {
    const p = new Pix(W, H);
    const rng = mulberry32(seed);
    for (let i = 0; i < count; i++) {
      const x = rng.range(0, W);
      const y = rng.range(0, H);
      const r = rng.range(rmin, rmax);
      const s = rng.int(1, 9999);
      const ry = r * rng.range(0.7, 0.95);
      wrapped((dx, dy) => rockBlob(p, x + dx, y + dy, r, ry, s, ramp, { rough: 0.5 }), true);
    }
    if (ember) p.apply((x, y, c) => (c !== 0 && p.get(x, y + 2) === 0 && bayer(x, y) < 0.7 ? 9 : -1));
    return p;
  };
  return [
    { pix: sky, parallax: 0, offsetY: 0, repeatX: true, repeatY: false, label: 'nebula + ember horizon' },
    { pix: layer(24, 26, 2, 6, [2, 3, 4], false), parallax: 0.12, offsetY: 0, repeatX: true, repeatY: true, label: 'far asteroids' },
    { pix: layer(25, 9, 8, 18, [3, 4, 5, 6], true), parallax: 0.35, offsetY: 0, repeatX: true, repeatY: true, label: 'mid asteroids (ember-lit)' },
  ];
}

// =============================================================== islands

function islands(pal: Palette): BackdropLayerPix[] {
  const nat = natureRamps(pal);
  // L0: cyan sky -> white haze with a gold band near the horizon; pale moon
  const sky = new Pix(W, H);
  vGradient(sky, 0, 0, W, H, [10, 11, 12], 0.05, 1.1, 0.45);
  sky.apply((x, y) => (y > H * 0.62 && bayer(x, y) < ((y - H * 0.62) / (H * 0.38)) * 0.5 ? 14 : -1));
  // big pale planet/moon, upper right (floating-islands-sky-moon ref)
  const mx = 470,
    my = 70,
    mr = 34;
  sky.ellipse(mx, my, mr, mr, (x, y, nx, ny) => {
    const cr = fbm(x, y, 31, { scale: 8, octaves: 2 });
    return rampAt([11, 12], 0.7 - nx * 0.3 - ny * 0.2 + (cr > 0.6 ? -0.4 : 0), x, y, 0.6);
  });
  const clouds = new Pix(W, H);
  const rng = mulberry32(32);
  for (let i = 0; i < 7; i++) {
    const cx = rng.range(0, W),
      cy = rng.range(40, 200),
      w = rng.range(60, 140);
    const s = rng.int(1, 999);
    wrapped((dx) => cloud(clouds, cx + dx, cy, w, w * 0.3, [11, 12], s));
  }
  sky.blit(clouds, 0, 0);
  // L1: far haze islands + karst peaks (blue-grey, flat)
  const far = new Pix(W, H);
  ridgeBand(far, H - 30, 90, 33, 80, 15, 11);
  // pinnacles
  const r2 = mulberry32(34);
  for (let i = 0; i < 6; i++) {
    const x = r2.range(0, W),
      w = r2.range(10, 26),
      h = r2.range(60, 130);
    wrapped((dx) => far.poly([[x + dx - w / 2, H], [x + dx - w * 0.35, H - h], [x + dx + w * 0.3, H - h - 4], [x + dx + w / 2, H]], 15));
  }
  for (let i = 0; i < 8; i++) {
    const x = r2.range(0, W),
      y = r2.range(90, 220),
      w = r2.range(18, 48);
    const s = r2.int(1, 999);
    wrapped((dx) => floatingIsland(far, x + dx, y, w, { rock: [15, 15, 11], foliage: [15, 11, 11], water: [11, 12], out: 15 }, s, { far: true, roots: 3 }));
  }
  // haze over the far layer: lighten bottom with dither
  far.apply((x, y, c) => (c !== 0 && bayer(x, y) < (y / H) * 0.5 ? 11 : -1));
  // L2: mid islands, detailed but slightly muted, some with waterfalls
  const mid = new Pix(W, H);
  const r3 = mulberry32(35);
  for (let i = 0; i < 4; i++) {
    const x = (i + 0.5) * (W / 4) + r3.jitter(30),
      y = r3.range(70, 200),
      w = r3.range(50, 90);
    const s = r3.int(1, 999);
    const falls = r3.chance(0.6);
    wrapped((dx) => floatingIsland(mid, x + dx, y, w, nat, s, { waterfall: falls, roots: 8 }));
  }
  // atmospheric perspective: dither toward haze
  mid.apply((x, y, c) => (c !== 0 && c !== 1 && bayer(x, y) < 0.22 ? 11 : -1));
  // L3: mist band low down
  const mist = new Pix(W, H);
  const r4 = mulberry32(36);
  for (let i = 0; i < 12; i++) {
    const cx = r4.range(0, W),
      w = r4.range(70, 160);
    const s = r4.int(1, 999);
    wrapped((dx) => cloud(mist, cx + dx, H - r4.range(10, 40), w, w * 0.22, [11, 12], s));
  }
  return [
    { pix: sky, parallax: 0, offsetY: 0, repeatX: true, repeatY: false, label: 'sky, moon, clouds' },
    { pix: far, parallax: 0.1, offsetY: 0, repeatX: true, repeatY: false, label: 'far haze islands' },
    { pix: mid, parallax: 0.3, offsetY: 0, repeatX: true, repeatY: false, label: 'mid islands + waterfalls' },
    { pix: mist, parallax: 0.55, offsetY: 0, repeatX: true, repeatY: false, label: 'mist band' },
  ];
}

// ================================================================= caves

function caves(_pal: Palette): BackdropLayerPix[] {
  const sky = new Pix(W, H);
  vGradient(sky, 0, 0, W, H, [1, 2, 2, 1], 0, 1, 0.45);
  sky.apply((x, y) => {
    const n = fbm(x, y, 41, { scale: 64, octaves: 3, tileW: W });
    return n > 0.6 && bayer(x, y) < (n - 0.6) * 3 ? 7 : -1;
  });
  // L1: distant chamber walls with glow specks and faint light shafts
  const far = new Pix(W, H);
  // light shafts from holes in the roof (drawn first, walls cover their roots)
  const r = mulberry32(44);
  for (let i = 0; i < 4; i++) {
    const x = r.range(0, W);
    const hw = r.range(8, 16);
    wrapped((dx) => {
      for (let y = 0; y < H; y++)
        for (let k = -hw; k <= hw; k++) {
          const xx = x + dx + k + y * 0.18;
          const t = (1 - Math.abs(k) / hw) * (1 - y / (H * 1.1));
          if (bayer(Math.floor(xx), y) < t * 0.45) far.set(xx, y, t > 0.55 ? 12 : 11);
        }
    });
  }
  ridgeBand(far, 40, 50, 42, 64, 3, 4, true);
  ridgeBand(far, H - 40, 100, 43, 64, 3, 4);
  ridgeBand(far, H + 10, 60, 48, 32, 2, 3);
  // bioluminescent pools of light on the chamber floor
  for (let i = 0; i < 6; i++) {
    const x = r.range(0, W),
      y = r.range(H - 90, H - 30);
    wrapped((dx) => halo(far, x + dx, y, r.range(10, 22), [7, 8], { core: 0.6, onlyOver: true }));
  }
  for (let i = 0; i < 220; i++) far.set(r.range(0, W), r.range(0, H), r.chance(0.8) ? 8 : 9);
  // L2: near columns & stalactites
  const near = new Pix(W, H);
  const r2 = mulberry32(45);
  for (let i = 0; i < 7; i++) {
    const x = r2.range(0, W),
      w = r2.range(8, 22),
      len = r2.range(60, 150);
    const fromTop = r2.chance(0.6);
    wrapped((dx) => {
      const pts: [number, number][] = fromTop
        ? [[x + dx - w, 0], [x + dx + w, 0], [x + dx + w * 0.2, len], [x + dx, len + 10]]
        : [[x + dx - w, H], [x + dx + w, H], [x + dx + w * 0.25, H - len], [x + dx - w * 0.1, H - len - 8]];
      near.poly(pts, (px, py) => rampAt([2, 3, 4], 0.55 - (px - (x + dx)) / (w * 2) + (valueNoise(px / 2, py / 9, 46) - 0.5) * 0.5, px, py, 0.4));
    });
  }
  near.outline(1);
  // bioluminescent drips on the tips
  near.apply((x, y, c) => (c === 1 && near.get(x, y - 1) > 1 && hash2(x, y, 47) > 0.9 ? 9 : -1));
  return [
    { pix: sky, parallax: 0, offsetY: 0, repeatX: true, repeatY: false, label: 'darkness gradient' },
    { pix: far, parallax: 0.2, offsetY: 0, repeatX: true, repeatY: false, label: 'distant chamber + glow' },
    { pix: near, parallax: 0.45, offsetY: 0, repeatX: true, repeatY: false, label: 'columns & stalactites' },
  ];
}

// ================================================================== core

function core(pal: Palette): BackdropLayerPix[] {
  const nat = natureRamps(pal);
  const sky = new Pix(W, H);
  vGradient(sky, 0, 0, W, H, [11, 12, 13, 14], 0, 1.05, 0.45);
  // aurora ribbons
  for (let band = 0; band < 3; band++) {
    const yb = 40 + band * 35;
    sky.apply((x, y) => {
      const off = Math.sin((x / W) * Math.PI * 2 * (band + 1) + band) * 18 + (valueNoise(x / 30, band, 51, W / 30) - 0.5) * 30;
      const d = Math.abs(y - (yb + off));
      return d < 6 && bayer(x, y) < (1 - d / 6) * 0.55 ? (band === 1 ? 13 : 12) : -1;
    });
  }
  // the artificial sun's glow (fixed on screen)
  halo(sky, W * 0.7, 120, 90, [13, 14], { core: 1.1 });
  sky.ellipse(W * 0.7, 120, 20, 20, (x, y, nx, ny) => (Math.hypot(nx, ny) > 0.85 ? 15 : 14));
  // L1: far jungle cliffs with waterfalls. S8: the layer is 2 screens tall
  // (the cliffs continue down) so its bottom edge never scrolls into view in
  // the 2400 px hollow (parallax 0.15); the last rows still dissolve into
  // mist (ordered dither) in case a taller level uses the theme.
  const FH = H * 2;
  const far = new Pix(W, FH);
  const prof = ridgeProfile(W, H - 60, 120, 52, 80);
  for (let x = 0; x < W; x++)
    for (let y = Math.round(prof[x]!); y < FH; y++) far.set(x, y, rampAt([5, 6], 0.3 + (fbm(x, y, 53, { scale: 16, tileW: W }) - 0.5) * 0.8, x, y, 0.5));
  const r = mulberry32(54);
  for (let i = 0; i < 5; i++) {
    const x = r.range(0, W);
    const top = Math.round(prof[Math.floor(x) % W]!) + 4;
    wrapped((dx) => waterfall(far, x + dx, top, 5, FH - top, [9, 10, 14], 0, 55 + i));
  }
  far.apply((x, y, c) => (c !== 0 && bayer(x, y) < 0.3 - (y / H) * 0.2 ? 12 : -1));
  const MIST = 110;
  far.apply((x, y, c) => {
    if (c === 0 || y < FH - MIST) return -1;
    const k = (FH - y) / MIST; // 1 at the top of the band -> 0 at the bottom
    const b = bayer(x, y);
    if (b >= k) return 0;
    return b >= k * 0.6 ? 13 : -1;
  });
  // L2: floating rocks with jungle tops + palms
  const mid = new Pix(W, H);
  const r2 = mulberry32(56);
  for (let i = 0; i < 4; i++) {
    const x = (i + 0.5) * (W / 4) + r2.jitter(30),
      y = r2.range(90, 220),
      w = r2.range(40, 80);
    const s = r2.int(1, 999);
    wrapped((dx) => {
      floatingIsland(mid, x + dx, y, w, nat, s, { roots: 6, depth: 0.6 });
      palm(mid, x + dx + w * 0.2, y - 2, 22, [2, 3, 4], [5, 6, 7], s + 1);
    });
  }
  return [
    { pix: sky, parallax: 0, offsetY: 0, repeatX: true, repeatY: false, label: 'aurora sky + sun glow' },
    { pix: far, parallax: 0.15, offsetY: 0, repeatX: true, repeatY: false, label: 'jungle cliffs + waterfalls' },
    { pix: mid, parallax: 0.38, offsetY: 0, repeatX: true, repeatY: false, label: 'floating rocks' },
  ];
}

// ================================================================== boss

function boss(_pal: Palette): BackdropLayerPix[] {
  const sky = new Pix(W, H);
  vGradient(sky, 0, 0, W, H, [1, 2, 3, 4], 0, 0.9, 0.45);
  sky.apply((x, y) => {
    const n = fbm(x, y, 61, { scale: 48, octaves: 3, tileW: W });
    return n > 0.64 && bayer(x, y) < (n - 0.64) * 3 ? 7 : -1;
  });
  const far = new Pix(W, H);
  ridgeBand(far, 70, 60, 62, 40, 2, 3, true);
  // twisted spires from below
  const r = mulberry32(63);
  for (let i = 0; i < 8; i++) {
    const x = r.range(0, W),
      h = r.range(80, 200),
      w = r.range(6, 14);
    const ph = r.range(0, 6);
    wrapped((dx) => {
      for (let k = 0; k < h; k++) {
        const t = k / h;
        const cx = x + dx + Math.sin(ph + t * 5) * 8 * t;
        const hw = w * (1 - t * 0.85);
        far.hline(cx - hw, cx + hw, H - k, 3);
      }
    });
  }
  far.apply((x, y, c) => (c === 3 && far.get(x - 1, y) === 0 ? 4 : -1));
  const near = new Pix(W, H);
  const r2 = mulberry32(64);
  for (let i = 0; i < 40; i++) {
    const x = r2.range(0, W),
      y = r2.range(0, H);
    wrapped((dx) => halo(near, x + dx, y, r2.chance(0.3) ? 3 : 2, [8, 9], { core: 0.8 }));
  }
  for (let i = 0; i < 14; i++) {
    const x = r2.range(0, W);
    strand(near, x, 0, r2.range(30, 110), 4, r2.int(1, 999), 3);
  }
  return [
    { pix: sky, parallax: 0, offsetY: 0, repeatX: true, repeatY: false, label: 'abyssal gradient' },
    { pix: far, parallax: 0.2, offsetY: 0, repeatX: true, repeatY: false, label: 'twisted spires' },
    { pix: near, parallax: 0.45, offsetY: 0, repeatX: true, repeatY: false, label: 'spores + hanging roots' },
  ];
}

// ============================================================== collapse

function collapse(_pal: Palette): BackdropLayerPix[] {
  // bright crust hole / dawn up top, red emergency glow below
  const sky = new Pix(W, H);
  vGradient(sky, 0, 0, W, H, [13, 12, 11, 10, 7, 2], 0, 1, 0.45);
  const towers = (seed: number, count: number, ramp: readonly number[], lit: number[], wmin: number, wmax: number) => {
    const p = new Pix(W, H);
    const r = mulberry32(seed);
    for (let i = 0; i < count; i++) {
      const x = r.range(0, W),
        w = r.range(wmin, wmax),
        broken = r.range(0, H * 0.5);
      const s = r.int(1, 999);
      wrapped(
        (dx, dy) => {
          for (let y = 0; y < H; y++) {
            if (y < broken && (y < broken - 20 || hash2(Math.floor(x), y, s) > (y - broken + 20) / 20)) continue;
            const wob = Math.round(valueNoise(y / 30, 1, s) * 4);
            for (let k = 0; k < w; k++) {
              const px = x + dx + k + wob;
              const shade = k < 2 ? ramp[ramp.length - 1]! : k > w - 3 ? ramp[0]! : ramp[1]!;
              p.set(px, y + dy, shade);
            }
            // windows
            if (y % 10 < 3)
              for (let k = 3; k < w - 3; k += 5) if (hash2(k, Math.floor(y / 10), s) > 0.6) p.set(x + dx + k + wob, y + dy, lit[hash2(k, y, s) > 0.8 ? 1 : 0]!);
          }
        },
        true,
      );
    }
    return p;
  };
  const far = towers(71, 9, [2, 3, 3], [8, 11], 14, 30);
  far.apply((x, y, c) => (c !== 0 && bayer(x, y) < 0.12 ? 10 : -1));
  const near = towers(72, 4, [3, 4, 5], [9, 12], 26, 48);
  near.apply((x, y, c) => (c !== 0 && fbm(x, y, 73, { scale: 12, tileW: W, tileH: H }) > 0.62 ? rampAt([14, 15], 0.5, x, y, 0.5) : -1));
  near.outline(1);
  // silhouettes of falling debris
  const r = mulberry32(74);
  for (let i = 0; i < 16; i++) {
    const x = r.range(0, W),
      y = r.range(0, H),
      s = r.range(2, 5);
    near.ellipse(x, y, s, s * 0.8, 2);
    near.vline(x, y - s * 3, y - s, 11);
  }
  return [
    { pix: sky, parallax: 0, offsetY: 0, repeatX: true, repeatY: false, label: 'dawn above, alarm below' },
    { pix: far, parallax: 0.2, offsetY: 0, repeatX: true, repeatY: true, label: 'far ruined city shafts' },
    { pix: near, parallax: 0.45, offsetY: 0, repeatX: true, repeatY: true, label: 'near towers + falling debris' },
  ];
}

const BUILDERS: Record<ThemeId, (p: Palette) => BackdropLayerPix[]> = { hangar, asteroid, islands, caves, core, boss, collapse };

const cache = new Map<ThemeId, BackdropLayerPix[]>();

/** Layers far -> near (memoised; treat the buffers as read-only). */
export function generateBackdrop(theme: ThemeId): BackdropLayerPix[] {
  let l = cache.get(theme);
  if (!l) {
    l = BUILDERS[theme](padRamps(PALETTES[theme]));
    cache.set(theme, l);
  }
  return l;
}

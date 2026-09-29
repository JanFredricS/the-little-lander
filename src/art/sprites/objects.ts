/**
 * Gameplay objects (obj.*): goo, orbs, fuel, beacons, docks, harpoon, rope,
 * debris, blast door, vine. Mostly CRAFT palette so pickups/hazards read the
 * same in every theme; blast door and vine use their home theme palettes.
 */

import type { ThemeId } from '../../contracts';
import { Pix, type Pt } from '../core/pix';
import { rampAt, shiftMap, type ArtPalette } from '../core/palette';
import { valueNoise } from '../core/noise';
import { mulberry32 } from '../core/rng';
import { halo, rockBlob, sphere } from '../core/shapes';
import { CRAFT, PALETTES } from '../palettes';
import { flameFrame } from './fx';
import type { SpriteDef, SpriteEntry } from './types';

const C = CRAFT.ramps;
const GREY = C.grey!;
const OUT = CRAFT.outline;
const LIGHTER = shiftMap(CRAFT, 1, ['grey', 'foil', 'goo', 'orb', 'red', 'green']);

/** Purple goo ball: wobbling blob, 4-frame pulse, wet glint. 12×12. */
function goo(): Pix[] {
  const G = C.goo!;
  return [0, 1, 2, 3].map((f) => {
    const p = new Pix(12, 12);
    const k = Math.sin((f / 4) * Math.PI * 2);
    const rx = 4.4 + k * 0.5;
    const ry = 4.4 - k * 0.5;
    p.ellipse(6, 6 + k * 0.3, rx, ry, (x, y, nx, ny) => {
      const n = valueNoise(x / 2 + f, y / 2, 61) - 0.5;
      const t = 0.55 - nx * 0.35 - ny * 0.45 + n * 0.5;
      return rampAt(G.slice(0, 3), t, x, y, 0.6);
    });
    // drips / tendrils
    if (f % 2 === 0) p.set(3, 10.5 + k * 0.4, G[1]!);
    else p.set(8, 10.5, G[1]!);
    p.outline(OUT);
    p.set(4, 3 + (f === 2 ? 1 : 0), G[3]!);
    p.set(5, 3 + (f === 2 ? 1 : 0), G[2]!);
    return p;
  });
}

/** Tech orb: teal core + pulsing dithered halo. 12×12, 4 frames. */
function orb(): Pix[] {
  const O = C.orb!;
  return [0, 1, 2, 3].map((f) => {
    const p = new Pix(12, 12);
    const pulse = [0, 1, 2, 1][f]!;
    halo(p, 6, 6, 4.5 + pulse * 0.6, [O[0]!, O[1]!], { core: 0.7 });
    sphere(p, 6, 6, 2.8, 2.8, [O[0]!, O[1]!, O[2]!], { ambient: 0.35 });
    p.set(5, 4, CRAFT.ramps.grey![4]!);
    // orbiting spark
    const a = (f / 4) * Math.PI * 2;
    p.set(6 + Math.cos(a) * 5, 6 + Math.sin(a) * 5, O[2]!);
    return p;
  });
}

/** Fuel canister: white tank, red band, amber cap. 8×12. */
function fuel(): Pix {
  const p = new Pix(8, 12);
  p.rect(1, 2, 6, 9, GREY[3]!);
  for (let y = 2; y < 11; y++) {
    p.set(1, y, GREY[2]!);
    p.set(2, y, GREY[4]!);
    p.set(3, y, GREY[4]!);
    p.set(4, y, GREY[3]!);
    p.set(5, y, GREY[3]!);
    p.set(6, y, GREY[2]!);
  }
  for (let x = 1; x < 7; x++) {
    p.set(x, 5, x < 3 ? C.red![1]! : C.red![0]!);
    p.set(x, 6, x < 3 ? C.red![1]! : C.red![0]!);
  }
  p.rect(3, 0, 2, 2, C.foil![3]!);
  p.set(3, 0, C.foil![4]!);
  p.outline(OUT);
  return p;
}

/** Planted beacon: tripod + mast + blinking green lamp + pennant. 10×22, 4 frames. */
function beacon(): Pix[] {
  const Gr = C.green!;
  return [0, 1, 2, 3].map((f) => {
    const p = new Pix(12, 22);
    // tripod
    p.line(6, 16, 2, 21, GREY[3]!);
    p.line(6, 16, 10, 21, GREY[3]!);
    p.line(6, 16, 6, 21, GREY[2]!);
    // mast
    p.vline(6, 4, 16, GREY[4]!);
    p.vline(7, 5, 16, GREY[2]!);
    // pennant (waves)
    const wave = f % 2;
    p.poly(
      [
        [7, 5],
        [11, 6 + wave],
        [7, 8],
      ] as Pt[],
      C.foil![3]!,
    );
    // lamp
    const on = f < 2;
    if (on) halo(p, 6.5, 3, 3.5, [Gr[0]!, Gr[1]!], { core: 0.6 });
    p.rect(5, 2, 3, 2, on ? Gr[1]! : Gr[0]!);
    p.set(5, 2, on ? GREY[4]! : Gr[0]!);
    return p;
  });
}

/** Beacon landing site marker: dashed pad with chevrons, blinking. 32×6, 2 frames. */
function beaconSite(): Pix[] {
  const Gr = C.green!;
  return [0, 1].map((f) => {
    const p = new Pix(32, 6);
    p.rect(1, 4, 30, 2, GREY[1]!);
    for (let x = 2; x < 30; x += 4) p.rect(x, 4, 2, 1, f === 0 ? Gr[1]! : Gr[0]!);
    // chevrons pointing down to the pad
    for (const cx of [6, 16, 26]) {
      const c = f === 0 ? Gr[1]! : GREY[4]!;
      p.set(cx - 2, 0, c).set(cx - 1, 1, c).set(cx, 2, c).set(cx + 1, 1, c).set(cx + 2, 0, c);
    }
    p.set(1, 3, C.red![1]!).set(30, 3, C.red![1]!);
    return p;
  });
}

/** Exit / docking target: square frame with alignment marks + lights. 32×32, 2 frames. */
function exitDock(): Pix[] {
  const Gr = C.green!;
  return [0, 1].map((f) => {
    const p = new Pix(32, 32);
    // chunky outer frame
    for (let i = 0; i < 3; i++) {
      const c = [GREY[1]!, GREY[3]!, GREY[2]!][i]!;
      p.hline(2 + i, 29 - i, 2 + i, c).hline(2 + i, 29 - i, 29 - i, c);
      p.vline(2 + i, 2 + i, 29 - i, c).vline(29 - i, 2 + i, 29 - i, c);
    }
    // inner crosshair ticks
    for (const [x, y, w, h] of [
      [15, 6, 2, 4],
      [15, 22, 2, 4],
      [6, 15, 4, 2],
      [22, 15, 4, 2],
    ] as const)
      p.rect(x, y, w, h, GREY[4]!);
    // corner lights chase
    const corners: Pt[] = [
      [3, 3],
      [28, 3],
      [28, 28],
      [3, 28],
    ];
    corners.forEach(([x, y], i) => {
      const on = (i + f) % 2 === 0;
      p.rect(x - 1, y - 1, 2, 2, on ? Gr[1]! : Gr[0]!);
    });
    p.outline(OUT);
    return p;
  });
}

function harpoonHead(): Pix {
  const p = new Pix(6, 8);
  p.poly(
    [
      [3, 0],
      [5.5, 4],
      [3.8, 3.6],
      [3.8, 8],
      [2.2, 8],
      [2.2, 3.6],
      [0.5, 4],
    ] as Pt[],
    GREY[3]!,
  );
  p.set(2, 1, GREY[4]!).set(2, 2, GREY[4]!).set(3, 0, C.red![1]!);
  p.set(3, 6, C.red![0]!);
  return p;
}

function ropeSegment(): Pix {
  const p = new Pix(2, 4);
  p.set(0, 0, C.foil![2]!).set(1, 0, C.foil![1]!);
  p.set(0, 1, C.foil![1]!).set(1, 1, C.foil![3]!);
  p.set(0, 2, C.foil![2]!).set(1, 2, C.foil![1]!);
  p.set(0, 3, C.foil![1]!).set(1, 3, C.foil![3]!);
  return p;
}

function debrisChunk(size: number, seed: number): Pix {
  const p = new Pix(size, size);
  const ramp = [GREY[0]!, GREY[1]!, GREY[2]!, GREY[3]!];
  rockBlob(p, size / 2, size / 2, size / 2 - 1.5, size / 2 - 2, seed, ramp, { rough: 0.6, crack: size > 10 ? 2 : 0 });
  // a glint of torn metal
  const r = mulberry32(seed);
  p.set(r.int(2, size - 3), r.int(2, size - 3), C.foil![3]!);
  p.outline(OUT);
  p.rim(LIGHTER, OUT);
  return p;
}

/** Burning debris: chunk with an upward-trailing flame. 14×18, 4 frames. */
function debrisBurning(): Pix[] {
  const chunk = debrisChunk(10, 333);
  return [0, 1, 2, 3].map((f) => {
    const p = new Pix(14, 18);
    const fl = flameFrame(9, 11, f, 707);
    p.blit(fl, 2.5, 0, { flipY: true });
    p.blit(chunk, 2, 8);
    return p;
  });
}

/** Hangar blast door panel with hazard stripes. 16×64 (tiles vertically), themed. */
function blastDoor(pal: ArtPalette): Pix {
  const R = pal.ramps;
  const prim = R.primary!;
  const acc = R.accent!;
  const p = new Pix(16, 64);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 16; x++) {
      let c = prim[x < 3 ? 2 : x > 12 ? 0 : 1]!;
      if (y % 16 === 0) c = prim[0]!;
      if (y % 16 === 1) c = prim[2]!;
      p.set(x, y, c);
    }
  // hazard band (diagonal stripes)
  for (let y = 26; y < 38; y++)
    for (let x = 1; x < 15; x++) p.set(x, y, ((x + y) >> 2) % 2 === 0 ? acc[acc.length - 1]! : pal.outline);
  // rivets
  for (const y of [4, 12, 20, 44, 52, 60]) {
    p.set(3, y, prim[3]!);
    p.set(12, y, prim[3]!);
  }
  // edge frame
  p.vline(0, 0, 63, pal.outline).vline(15, 0, 63, pal.outline);
  return p;
}

/** Vine segment (tiles vertically), themed foliage. 5×8. */
function vineSegment(pal: ArtPalette): Pix {
  const F = pal.ramps.foliage!;
  const p = new Pix(5, 8);
  for (let y = 0; y < 8; y++) {
    const x = 2 + Math.round(Math.sin((y / 8) * Math.PI * 2) * 0.8);
    p.set(x, y, F[1]!);
    p.set(x + 1, y, F[0]!);
  }
  p.set(0, 2, F[2]!).set(1, 2, F[1]!);
  p.set(4, 6, F[2]!).set(3, 6, F[1]!);
  p.set(1, 3, F[Math.min(3, F.length - 1)]!);
  return p;
}

export function objectSprites(): Record<string, () => SpriteDef> {
  return {
    'obj.goo': () => ({ frames: goo(), palette: CRAFT, pivot: { x: 6, y: 6 } }),
    'obj.orb': () => ({ frames: orb(), palette: CRAFT, pivot: { x: 6, y: 6 } }),
    'obj.fuel': () => ({ frames: [fuel()], palette: CRAFT, pivot: { x: 4, y: 6 } }),
    'obj.beacon': () => ({ frames: beacon(), palette: CRAFT, pivot: { x: 6, y: 21 } }),
    'obj.beaconSite': () => ({ frames: beaconSite(), palette: CRAFT, pivot: { x: 16, y: 6 } }),
    'obj.exitDock': () => ({ frames: exitDock(), palette: CRAFT, pivot: { x: 16, y: 16 } }),
    'obj.harpoonHead': () => ({ frames: [harpoonHead()], palette: CRAFT, pivot: { x: 3, y: 0 } }),
    'obj.ropeSegment': () => ({ frames: [ropeSegment()], palette: CRAFT, pivot: { x: 1, y: 0 } }),
    'obj.debrisSmall': () => ({ frames: [debrisChunk(8, 301)], palette: CRAFT, pivot: { x: 4, y: 4 } }),
    'obj.debrisLarge': () => ({ frames: [debrisChunk(16, 307)], palette: CRAFT, pivot: { x: 8, y: 8 } }),
    'obj.debrisBurning': () => ({ frames: debrisBurning(), palette: CRAFT, pivot: { x: 7, y: 13 } }),
  };
}

export function themedObjectSprites(): Record<string, SpriteEntry> {
  const pal = (t: ThemeId) => PALETTES[t];
  return {
    'obj.blastDoor': { home: 'hangar', themed: true, gen: (t) => ({ frames: [blastDoor(pal(t))], palette: pal(t), pivot: { x: 8, y: 32 } }) },
    'obj.vineSegment': { home: 'islands', themed: true, gen: (t) => ({ frames: [vineSegment(pal(t))], palette: pal(t), pivot: { x: 2.5, y: 0 } }) },
  };
}


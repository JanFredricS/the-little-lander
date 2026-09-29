/**
 * Effects: thruster flames (soft amber plume per the LEM landing
 * illustration: white-hot core at the nozzle, orange body, dithered tail),
 * explosion, spark, smoke, dust, radiation pulse, wind streak. CRAFT palette.
 */

import { Pix } from '../core/pix';
import { bayer, rampAt } from '../core/palette';
import { valueNoise } from '../core/noise';
import { hash2, mulberry32 } from '../core/rng';
import { CRAFT } from '../palettes';
import type { SpriteDef } from './types';

const FLAME = CRAFT.ramps.flame!; // 12..15
const GREY = CRAFT.ramps.grey!;

/**
 * Plume: nozzle at the top centre, pointing down. `w`,`h` canvas size.
 * Intensity falls off with distance from the axis and from the nozzle.
 */
export function flameFrame(w: number, h: number, frame: number, seed: number, lengthScale = 1): Pix {
  const p = new Pix(w, h);
  const r = mulberry32(seed + frame * 7919);
  const cx = w / 2;
  const L = h * lengthScale * (0.78 + 0.22 * r.next());
  const nozzle = Math.max(1, w * 0.22);
  const wob = r.range(0, Math.PI * 2);
  for (let y = 0; y < h; y++) {
    const t = (y + 0.5) / L;
    if (t > 1.15) break;
    // bulb just below the nozzle, then taper
    const half = nozzle + (w / 2 - nozzle) * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5) * (1 - 0.55 * t) + Math.sin(wob + y * 0.9) * 0.35;
    for (let x = 0; x < w; x++) {
      const d = Math.abs(x + 0.5 - cx) / Math.max(0.6, half);
      if (d > 1.15) continue;
      const n = valueNoise(x * 0.9, y * 0.45 - frame * 3.1, seed);
      let v = (1 - d) * 0.9 + (1 - t) * 0.75 - 0.35 + (n - 0.5) * 0.5;
      if (t < 0.18) v += 0.35; // white-hot at the nozzle
      if (v <= 0.02) {
        // soft dithered fringe
        if (v > -0.18 && bayer(x, y + frame) < 0.3 && t < 1) p.set(x, y, FLAME[0]!);
        continue;
      }
      p.set(x, y, rampAt(FLAME, Math.min(1, v), x, y + frame, 0.6));
    }
  }
  return p;
}

function flames(w: number, h: number, seed: number): Pix[] {
  return [0, 1, 2, 3].map((f) => flameFrame(w, h, f, seed));
}

function explosion(): Pix[] {
  const frames: Pix[] = [];
  const S = 32;
  const seed = 501;
  for (let f = 0; f < 6; f++) {
    const p = new Pix(S, S);
    const k = f / 5;
    const R = 5 + 10 * Math.sqrt(k);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const dx = x + 0.5 - S / 2;
        const dy = y + 0.5 - S / 2;
        const a = Math.atan2(dy, dx);
        const n = valueNoise(Math.cos(a) * 2 + 5, Math.sin(a) * 2 + f * 0.7, seed);
        const r = Math.hypot(dx, dy) / (R * (0.75 + 0.5 * n));
        if (r > 1) continue;
        const heat = (1 - r) * (1.25 - k * 1.3) + (valueNoise(x / 3, y / 3 + f, seed + 9) - 0.5) * 0.6;
        if (k > 0.55 && valueNoise(x / 2.5, y / 2.5 + f * 2, seed + 3) < (k - 0.5) * 1.3 && r > 0.3) continue; // breaking up
        if (heat > 0.15) p.set(x, y, rampAt(FLAME, heat, x, y, 0.6));
        else p.set(x, y, rampAt([GREY[0]!, GREY[1]!, GREY[2]!], 0.5 + heat, x, y, 0.6));
      }
    // flying sparks
    const r = mulberry32(seed + 77);
    for (let i = 0; i < 10; i++) {
      const a = r.range(0, Math.PI * 2);
      const d = R * (1 + r.next() * 0.4) + f;
      if (f > 0 && f < 5) p.set(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, FLAME[f < 3 ? 3 : 2]!);
    }
    p.outline(CRAFT.outline, { skip: new Set(FLAME) });
    frames.push(p);
  }
  return frames;
}

function spark(): Pix[] {
  return [2, 1, 0].map((r) => {
    const p = new Pix(5, 5);
    p.set(2, 2, FLAME[3]!);
    for (let i = 1; i <= r; i++) {
      const c = i === 1 ? FLAME[2]! : FLAME[1]!;
      p.set(2 - i, 2, c).set(2 + i, 2, c);
      p.set(2, 2 - i, c).set(2, 2 + i, c);
    }
    if (r === 0) p.set(2, 2, FLAME[2]!);
    return p;
  });
}

function puff(w: number, h: number, frames: number, seed: number, ramp: readonly number[], flat = false): Pix[] {
  const out: Pix[] = [];
  for (let f = 0; f < frames; f++) {
    const p = new Pix(w, h);
    const k = f / Math.max(1, frames - 1);
    const rx = (w / 2 - 1) * (0.45 + 0.55 * k);
    const ry = (h / 2 - 1) * (flat ? 0.5 + 0.5 * k : 0.45 + 0.55 * k);
    const cy = flat ? h - 1 - ry : h / 2;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const nx = (x + 0.5 - w / 2) / rx;
        const ny = (y + 0.5 - cy) / ry;
        const n = valueNoise(x / 2.2, y / 2.2 + f * 0.8, seed);
        const d = nx * nx + ny * ny - (n - 0.5) * 0.9;
        if (d > 1) continue;
        // fade out by dithering holes as the puff ages
        if (hash2(x, y, seed + f) < k * 0.7 && bayer(x, y) < k) continue;
        const light = 0.75 - ny * 0.35 - k * 0.35 + (n - 0.5) * 0.3;
        p.set(x, y, rampAt(ramp, light, x, y, 0.5));
      }
    out.push(p);
  }
  return out;
}

function radiationPulse(): Pix[] {
  const S = 48;
  const G = CRAFT.ramps.green!;
  return [0, 1, 2, 3].map((f) => {
    const p = new Pix(S, S);
    const R = 6 + f * 5.5;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const d = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2);
        const band = Math.abs(d - R);
        if (band < 1.2) p.set(x, y, f < 2 ? FLAME[3]! : G[1]!);
        else if (band < 3 && bayer(x, y) < 0.7 - f * 0.12) p.set(x, y, G[1]!);
        else if (band < 5 && d < R && bayer(x, y) < 0.3 - f * 0.06) p.set(x, y, G[0]!);
      }
    return p;
  });
}

function windStreak(): Pix[] {
  return [0, 1, 2].map((f) => {
    const p = new Pix(32, 5);
    const r = mulberry32(900 + f);
    for (let row = 0; row < 3; row++) {
      const y = 1 + row + (row === 2 ? 1 : 0) - 1;
      const x0 = r.int(0, 10) + f * 3;
      const len = r.int(8, 18);
      for (let x = x0; x < Math.min(32, x0 + len); x++) {
        const t = (x - x0) / len;
        if (t > 0.75 && bayer(x, y) < 0.5) continue;
        p.set(x, y + 1, t < 0.3 ? GREY[3]! : t < 0.7 ? GREY[4]! : GREY[3]!);
      }
    }
    return p;
  });
}

export function fxSprites(): Record<string, () => SpriteDef> {
  return {
    'fx.flameMain': () => ({ frames: flames(9, 20, 101), palette: CRAFT, pivot: { x: 4.5, y: 0 } }),
    'fx.flameSmall': () => ({ frames: flames(5, 12, 103), palette: CRAFT, pivot: { x: 2.5, y: 0 } }),
    'fx.explosion': () => ({ frames: explosion(), palette: CRAFT, pivot: { x: 16, y: 16 } }),
    'fx.spark': () => ({ frames: spark(), palette: CRAFT, pivot: { x: 2.5, y: 2.5 } }),
    'fx.smoke': () => ({ frames: puff(12, 12, 4, 211, [GREY[0]!, GREY[1]!, GREY[2]!, GREY[3]!]), palette: CRAFT, pivot: { x: 6, y: 6 } }),
    'fx.dust': () => ({ frames: puff(16, 8, 4, 223, [GREY[1]!, GREY[2]!, GREY[3]!, GREY[4]!], true), palette: CRAFT, pivot: { x: 8, y: 8 } }),
    'fx.radiationPulse': () => ({ frames: radiationPulse(), palette: CRAFT, pivot: { x: 24, y: 24 } }),
    'fx.windStreak': () => ({ frames: windStreak(), palette: CRAFT, pivot: { x: 16, y: 2.5 } }),
  };
}

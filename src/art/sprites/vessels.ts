/**
 * Vessel sprites, after the Apollo references: gold-foil octagonal descent
 * stage, grey angular ascent stage with triangular windows, CSM = silver
 * cone + white service-module cylinder + dark engine bell, spindly legs with
 * pad feet. Friendly, slightly cartoonish proportions.
 *
 * Pipeline: shapes are drawn as MATERIAL codes into a mask (so every
 * drawing is resolution-independent via the scale factor `s`), a shading
 * pass turns materials into CRAFT palette indices (ordered-dither ramps,
 * light from the upper left), then 1px dark outline + top rim light. Thin
 * details (legs, antennas) are drawn after the outline so they stay spindly.
 *
 * Every vessel exposes per-engine flame anchors (VESSEL_ANCHORS): where the
 * top-centre pivot of the flame sprite goes, plus the exhaust direction.
 * VesselState.engines.{main,left,right} (+ the S9 lander top thrusters
 * topLeft/topRight) decides which ones burn.
 */

import { Pix, type Pt } from '../core/pix';
import { rampAt, shiftMap } from '../core/palette';
import { valueNoise } from '../core/noise';
import { hash2 } from '../core/rng';
import { CRAFT } from '../palettes';
import type { SpriteDef } from './types';

// ------------------------------------------------------------- materials

const M = {
  HULL: 1,
  HULL_DK: 2,
  FOIL: 3,
  WIN: 4,
  BELL: 5,
  SILVER: 6,
  SM: 7,
  GUN: 8,
  RED: 9,
  FOIL_DK: 10,
} as const;

const GREY = CRAFT.ramps.grey!; // 2..6
const FOIL = CRAFT.ramps.foil!; // 7..11
const LIGHTER = shiftMap(CRAFT, 1, ['grey', 'foil', 'window', 'red', 'green', 'goo', 'orb', 'flame']);
const OUT = CRAFT.outline;

interface ShadeCtx {
  s: number;
  /** Horizontal centre + half width of the current cylinder-ish body (px). */
  cx: number;
  seed: number;
}

function shade(mask: Pix, ctx: ShadeCtx): Pix {
  const out = new Pix(mask.w, mask.h);
  const { s, cx } = ctx;
  mask.apply((x, y, mat) => {
    if (mat === 0) return -1;
    let c = 0;
    const nx = (x + 0.5 - cx) / (mask.w / 2); // -1..1 across the sprite
    switch (mat) {
      case M.HULL: {
        // angular facets: left face lit, centre mid, right face in shadow
        const f = nx < -0.28 ? 3 : nx > 0.28 ? 1 : 2;
        c = GREY[f]!;
        break;
      }
      case M.HULL_DK:
        c = GREY[nx < 0 ? 1 : 0]!;
        break;
      case M.GUN:
        c = GREY[nx < 0 ? 1 : 0]!;
        if ((y + x) % 3 === 0 && s > 1) c = GREY[1]!;
        break;
      case M.FOIL:
      case M.FOIL_DK: {
        // crinkled foil: lighting from the left + pixel-scale noise patches
        const n = valueNoise(x / 1.1, y / 2.2, ctx.seed) * 0.6 + valueNoise(x / (2.5 * s), y / (2 * s), ctx.seed + 7) * 0.4;
        const glint = hash2(x, y, ctx.seed) > 0.94 ? 0.22 : 0;
        let t = 0.6 - 0.3 * nx + 0.5 * (n - 0.5) + glint;
        if (mat === M.FOIL_DK) t -= 0.35;
        c = rampAt(FOIL, t, x, y, 0.35);
        break;
      }
      case M.WIN:
        c = CRAFT.ramps.window![0]!;
        break;
      case M.BELL: {
        const t = 0.35 - 0.45 * nx;
        c = rampAt([GREY[0]!, GREY[1]!, GREY[2]!], t, x, y, 0.4);
        break;
      }
      case M.SILVER: {
        const t = 0.8 - 0.55 * nx + (Math.abs(nx + 0.35) < 0.08 ? 0.3 : 0);
        c = rampAt([GREY[1]!, GREY[2]!, GREY[3]!, GREY[4]!], t, x, y, 0.25);
        break;
      }
      case M.SM: {
        // white cylinder, lit from the left, rolled-off edges
        const t = 0.85 - 0.45 * nx - 0.35 * nx * nx;
        c = rampAt([GREY[1]!, GREY[2]!, GREY[3]!, GREY[4]!], t, x, y, 0.25);
        break;
      }
      case M.RED:
        c = CRAFT.ramps.red![1]!;
        break;
    }
    out.set(x, y, c);
    return -1;
  });
  return out;
}

function finish(p: Pix): Pix {
  p.outline(OUT);
  p.rim(LIGHTER, OUT);
  return p;
}

const scalePts = (pts: readonly Pt[], s: number, dx = 0, dy = 0): Pt[] => pts.map(([x, y]) => [x * s + dx, y * s + dy] as Pt);

/** Mirror a list of points about the vertical line x = cx (unit coords). */
const mirrorPts = (pts: readonly Pt[], cx: number): Pt[] => pts.map(([x, y]) => [2 * cx - x, y] as Pt);

/** Draw a thin line on the left half, then mirror it onto the right half. */
function mirroredLines(p: Pix, lines: readonly (readonly [number, number, number, number, number])[]): void {
  const half = new Pix(p.w, p.h);
  for (const [x0, y0, x1, y1, c] of lines) half.line(x0, y0, x1, y1, c);
  p.blit(half, 0, 0);
  p.blit(half, 0, 0, { flipX: true });
}

// ------------------------------------------------------------ anchors

export interface EngineAnchor {
  /**
   * Which VesselState.engines flag drives this flame. 'topLeft' / 'topRight'
   * are the S9 lander top thrusters (extra flags beside the frozen
   * main/left/right; see EngineName in src/physics/vessel/types.ts).
   */
  engine: 'main' | 'left' | 'right' | 'topLeft' | 'topRight';
  /** Flame attach point, px from the sprite's top-left (flame pivot goes here). */
  x: number;
  y: number;
  /** Exhaust direction in sprite space (unit vector; {0,1} = straight down). */
  dir: { x: number; y: number };
  flame: 'fx.flameMain' | 'fx.flameSmall';
}

export interface VesselAnchors {
  /** Per frame (vessel frames are POSES, not an animation loop). */
  engines: readonly (readonly EngineAnchor[])[];
  /** Harpoon gun muzzles (pod variants), px from top-left. */
  guns: readonly { x: number; y: number }[];
  /** Landing-pad contact points (lander), px from top-left. */
  feet: readonly { x: number; y: number }[];
}

// -------------------------------------------------------------- lander

/** Lander poses: frame index of vessel.lander. */
export const LANDER_POSE = { flight: 0, contact: 1 } as const;

interface Built {
  pix: Pix;
  engines: EngineAnchor[];
}

/** Ascent-stage (the grey angular cabin) into a material mask, unit coords centred on `cx`. */
function drawAscent(m: Pix, s: number, ox: number, oy: number, cx: number): void {
  const P = (pts: readonly Pt[]) => scalePts(pts, s, ox, oy);
  // hatch / docking collar
  m.poly(P([[cx - 1.5, 2], [cx + 1.5, 2], [cx + 1.5, 3.6], [cx - 1.5, 3.6]]), M.HULL_DK);
  // faceted cabin
  m.poly(P([[cx - 5.5, 10], [cx - 5.5, 6], [cx - 3.5, 3.5], [cx + 3.5, 3.5], [cx + 5.5, 6], [cx + 5.5, 10]]), M.HULL);
  // triangular windows
  m.poly(P([[cx - 3.6, 5.4], [cx - 1, 5.4], [cx - 1, 7.6], [cx - 2.6, 7.6]]), M.WIN);
  m.poly(P([[cx + 1, 5.4], [cx + 3.6, 5.4], [cx + 2.6, 7.6], [cx + 1, 7.6]]), M.WIN);
  if (s >= 2) {
    // front hatch + RCS quads on the sides
    m.poly(P([[cx - 1.2, 8.6], [cx + 1.2, 8.6], [cx + 1.2, 10], [cx - 1.2, 10]]), M.HULL_DK);
    m.rect((cx - 6.4) * s + ox, 6.2 * s + oy, s, s, M.HULL_DK);
    m.rect((cx + 5.4) * s + ox, 6.2 * s + oy, s, s, M.HULL_DK);
  }
}

function glintWindows(p: Pix, s: number, ox: number, oy: number, cx: number): void {
  const g = CRAFT.ramps.window![1]!;
  p.set((cx - 3) * s + ox, 5.5 * s + oy, g);
  p.set((cx + 1.3) * s + ox, 5.5 * s + oy, g);
  if (s >= 2) {
    p.set((cx - 3) * s + ox + 1, 5.5 * s + oy, g);
    p.set((cx + 1.3) * s + ox + 1, 5.5 * s + oy, g);
  }
}

function drawAntennas(p: Pix, s: number, ox: number, oy: number, cx: number): void {
  const L = GREY[3]!;
  // left: whip mast; right: small dish (as in the LEM illustration)
  p.line((cx - 3.6) * s + ox, 3.6 * s + oy, (cx - 4.6) * s + ox, 1 * s + oy, L);
  p.line((cx + 3.6) * s + ox, 3.8 * s + oy, (cx + 5.2) * s + ox, 2.2 * s + oy, L);
  const dx = (cx + 5.6) * s + ox;
  const dy = 1.6 * s + oy;
  p.set(dx, dy, GREY[4]!);
  p.set(dx + 1, dy, GREY[3]!);
  if (s >= 2) p.ellipse(dx + 0.5, dy, 1.4 * (s / 2) + 0.4, 0.8 * (s / 2) + 0.3, GREY[4]!);
}

/** The two-engine lander (24×24 at s=1). */
export function buildLander(s: number, pose: 'flight' | 'contact', seed = 11): Built {
  const W = 24 * s;
  const H = 24 * s;
  const cx = 12;
  const dy = pose === 'contact' ? 2 * s : 0;
  const m = new Pix(W, H);
  const P = (pts: readonly Pt[]) => scalePts(pts, s, 0, dy);

  // descent stage: gold-foil octagon with a darker lower skirt
  m.poly(P([[4.5, 10], [19.5, 10], [20.5, 11], [20.5, 15], [19.5, 16], [4.5, 16], [3.5, 15], [3.5, 11]]), M.FOIL);
  m.poly(P([[3.5, 14.6], [20.5, 14.6], [19.5, 16], [4.5, 16]]), M.FOIL_DK);
  drawAscent(m, s, 0, dy, cx);
  // descent engine bells (two: left + right of centre)
  const bells = [8.5, 15.5];
  for (const bx of bells) m.poly(P([[bx - 0.8, 16], [bx + 0.8, 16], [bx + 1.5, 18], [bx - 1.5, 18]]), M.BELL);
  // S9 top thrusters: small up-facing nozzles on the descent-stage shoulders, beside the cabin
  const tops = [5.2, 18.8];
  for (const bx of tops) m.poly(P([[bx - 0.6, 10], [bx + 0.6, 10], [bx + 1.1, 8.4], [bx - 1.1, 8.4]]), M.BELL);

  const p = finish(shade(m, { s, cx: W / 2, seed }));
  glintWindows(p, s, 0, dy, cx);
  drawAntennas(p, s, 0, dy, cx);

  // legs (after outline: spindly). Main strut, secondary strut, pad foot.
  const legC = GREY[3]!;
  const legHi = GREY[4]!;
  const legs: [number, number, number, number, number][] =
    pose === 'flight'
      ? [
          [4 * s, 11.5 * s, 1.5 * s, 21 * s, legHi],
          [4 * s, 15.5 * s, 2.2 * s, 18.4 * s, legC],
        ]
      : [
          [4 * s, 13.5 * s, 1 * s, 21.2 * s, legHi],
          [4 * s, 17.5 * s, 1.8 * s, 19.5 * s, legC],
        ];
  if (s >= 2) legs.push([legs[0]![0] + 1, legs[0]![1], legs[0]![2] + 1, legs[0]![3], legC]);
  mirroredLines(p, legs);
  // pad feet with a dark underside
  const padX = pose === 'flight' ? 1.5 : 1;
  const pads = new Pix(W, H);
  pads.ellipse(padX * s + 0.5, 21.6 * s, Math.max(1.6, 1.8 * s), Math.max(0.7, 0.8 * s), GREY[3]!);
  if (s >= 2) pads.hline(padX * s + 0.5 - 1.8 * s + 1, padX * s + 0.5 + 1.8 * s - 2, Math.round(21.6 * s - 0.8 * s), GREY[4]!);
  pads.outline(OUT);
  p.blit(pads, 0, 0);
  p.blit(pads, 0, 0, { flipX: true });

  const exitY = 18 * s + dy;
  const engines: EngineAnchor[] = [
    { engine: 'left', x: bells[0]! * s, y: exitY, dir: { x: 0, y: 1 }, flame: 'fx.flameSmall' },
    { engine: 'right', x: bells[1]! * s, y: exitY, dir: { x: 0, y: 1 }, flame: 'fx.flameSmall' },
    { engine: 'topLeft', x: tops[0]! * s, y: 8.4 * s + dy, dir: { x: 0, y: -1 }, flame: 'fx.flameSmall' },
    { engine: 'topRight', x: tops[1]! * s, y: 8.4 * s + dy, dir: { x: 0, y: -1 }, flame: 'fx.flameSmall' },
  ];
  return { pix: p, engines };
}

// ----------------------------------------------------------------- CSM

/** CM cone + SM cylinder + SPS bell into a mask, top of the cone at unit y = top. */
function drawCsmBody(m: Pix, s: number, top: number, cx: number, smLen = 17): number {
  const P = (pts: readonly Pt[]) => scalePts(pts, s);
  const coneBase = top + 8;
  const smBottom = coneBase + smLen;
  const bellBottom = smBottom + 7;
  // docking probe tip + cone
  m.poly(P([[cx - 1, top - 0.8], [cx + 1, top - 0.8], [cx + 1, top + 0.2], [cx - 1, top + 0.2]]), M.HULL_DK);
  m.poly(P([[cx - 1.8, top], [cx + 1.8, top], [cx + 7.5, coneBase], [cx - 7.5, coneBase]]), M.SILVER);
  // service module
  m.poly(P([[cx - 7.5, coneBase], [cx + 7.5, coneBase], [cx + 7.5, smBottom], [cx - 7.5, smBottom]]), M.SM);
  // SPS engine bell
  m.poly(P([[cx - 2.5, smBottom], [cx + 2.5, smBottom], [cx + 5.4, bellBottom], [cx - 5.4, bellBottom]]), M.BELL);
  // RCS quads
  m.rect((cx - 8.6) * s, (coneBase + 2.6) * s, s, s * 2, M.HULL_DK);
  m.rect((cx + 7.6) * s, (coneBase + 2.6) * s, s, s * 2, M.HULL_DK);
  return bellBottom;
}

function detailCsm(p: Pix, s: number, top: number, cx: number, smLen = 17): void {
  const coneBase = top + 8;
  const smBottom = coneBase + smLen;
  // CM / SM separation seam
  for (let x = Math.round((cx - 7.5) * s); x < (cx + 7.5) * s; x++) p.set(x, Math.round(coneBase * s), GREY[0]!);
  const x0 = Math.round((cx - 7.5) * s);
  const x1 = Math.round((cx + 7.5) * s) - 1;
  // panel seams across the service module + radiator stripes on the shaded side
  for (const yy of [coneBase + 4, coneBase + smLen - 5]) {
    for (let x = x0; x <= x1; x++) if (p.get(x, yy * s) !== OUT) p.set(x, yy * s, GREY[x < cx * s ? 2 : 1]!);
  }
  for (let y = Math.round((coneBase + 5) * s); y < (coneBase + smLen - 6) * s; y++) {
    for (let x = Math.round((cx + 3) * s); x < (cx + 6.5) * s; x += 2) p.set(x, y, GREY[1]!);
  }
  // cone windows
  p.set((cx - 3) * s, (top + 5) * s, CRAFT.ramps.window![0]!);
  p.set((cx + 2.5) * s, (top + 5) * s, CRAFT.ramps.window![0]!);
  // high-gain antenna off the aft end
  const ay = (smBottom - 1) * s;
  p.line((cx - 7.5) * s - 1, ay, (cx - 10) * s, ay + 3 * s, GREY[3]!);
  p.ellipse((cx - 10.2) * s, ay + 3.6 * s, Math.max(1.2, 1.4 * s), Math.max(0.8, 0.9 * s), GREY[4]!);
  // bell inner rim highlight
  const by = Math.round((smBottom + 7) * s) - 1;
  for (let x = Math.round((cx - 5) * s); x < (cx + 5) * s; x++) if (p.get(x, by) !== 0 && p.get(x, by) !== OUT) p.set(x, by, GREY[2]!);
}

/** Docked stack: inverted lander (legs folded) nose-docked to the CSM. 24×48 at s=1. */
export function buildCsmStack(s: number, seed = 23): Built {
  const W = 24 * s;
  const H = 48 * s;
  const cx = 12;
  const m = new Pix(W, H);
  const P = (pts: readonly Pt[]) => scalePts(pts, s);
  // inverted descent stage at the nose (legs folded)
  m.poly(P([[4.5, 1], [19.5, 1], [20.5, 2], [20.5, 6], [19.5, 7], [4.5, 7], [3.5, 6], [3.5, 2]]), M.FOIL);
  m.poly(P([[3.5, 1], [20.5, 1], [20.5, 2.4], [3.5, 2.4]]), M.FOIL_DK);
  // inverted ascent stage
  m.poly(P([[6.5, 7], [17.5, 7], [17.5, 10.5], [15.5, 13], [8.5, 13], [6.5, 10.5]]), M.HULL);
  m.poly(P([[9.4, 8.4], [11, 8.4], [11, 10.4], [8.4, 10.4]]), M.WIN);
  m.poly(P([[13, 8.4], [14.6, 8.4], [15.6, 10.4], [13, 10.4]]), M.WIN);
  // docking tunnel
  m.poly(P([[10.5, 13], [13.5, 13], [13.5, 15], [10.5, 15]]), M.HULL_DK);
  const bellBottom = drawCsmBody(m, s, 15, cx, 15.5);

  const p = finish(shade(m, { s, cx: W / 2, seed }));
  detailCsm(p, s, 15, cx, 15.5);
  // folded legs hugging the descent stage
  mirroredLines(p, [
    [3.5 * s, 6 * s, 1.8 * s, 2 * s, GREY[3]!],
    [1.8 * s, 2 * s, 1.8 * s, 1 * s, GREY[4]!],
  ]);
  const exitY = bellBottom * s;
  return { pix: p, engines: [{ engine: 'main', x: cx * s, y: exitY, dir: { x: 0, y: 1 }, flame: 'fx.flameMain' }] };
}

/** The CSM alone (no lander): 24×36 at s=1 (hangar prop, cutscenes). */
export function buildCsmSolo(s: number, seed = 29): Built {
  const W = 24 * s;
  const H = 36 * s;
  const cx = 12;
  const m = new Pix(W, H);
  const bellBottom = drawCsmBody(m, s, 2, cx);
  const p = finish(shade(m, { s, cx: W / 2, seed }));
  detailCsm(p, s, 2, cx);
  return { pix: p, engines: [{ engine: 'main', x: cx * s, y: bellBottom * s, dir: { x: 0, y: 1 }, flame: 'fx.flameMain' }] };
}

// ----------------------------------------------------------------- pods

function drawPodMask(m: Pix, s: number, withBell: boolean): void {
  const cx = 8;
  drawAscent(m, s, -4 * s, 0, cx + 4); // reuse the cabin, centred at x=8
  const P = (pts: readonly Pt[]) => scalePts(pts, s);
  // foil skirt at the base of the cabin
  m.poly(P([[2.5, 9.6], [13.5, 9.6], [13.5, 11.6], [2.5, 11.6]]), M.FOIL);
  if (withBell) m.poly(P([[7, 11.6], [9, 11.6], [9.7, 13.6], [6.3, 13.6]]), M.BELL);
  // harpoon gun housings
  m.poly(P([[0.5, 7.5], [3, 7.5], [3, 10], [0.5, 10]]), M.GUN);
  m.poly(P([[13, 7.5], [15.5, 7.5], [15.5, 10], [13, 10]]), M.GUN);
}

function podGuns(p: Pix, s: number): { x: number; y: number }[] {
  // barrels pointing up-and-out, red harpoon tips
  mirroredLines(p, [[1.6 * s, 7.4 * s, 1.6 * s, 5 * s, GREY[3]!]]);
  const tip = CRAFT.ramps.red![1]!;
  p.set(1.6 * s, 4.4 * s, tip);
  p.set(p.w - 1 - Math.floor(1.6 * s), 4.4 * s, tip);
  return [
    { x: 1.6 * s + 0.5, y: 4.4 * s },
    { x: p.w - Math.floor(1.6 * s) - 0.5, y: 4.4 * s },
  ];
}

/** Harpoon pod: ascent stage + two harpoon guns. 16×16 at s=1. */
export function buildPod(s: number, seed = 31): Built & { guns: { x: number; y: number }[] } {
  const W = 16 * s;
  const m = new Pix(W, W);
  drawPodMask(m, s, true);
  const p = finish(shade(m, { s, cx: W / 2, seed }));
  glintWindows(p, s, -4 * s, 0, 12);
  const guns = podGuns(p, s);
  // the ascent stage's own small bell
  return { pix: p, engines: [{ engine: 'main', x: 8 * s, y: 13.6 * s, dir: { x: 0, y: 1 }, flame: 'fx.flameSmall' }], guns };
}

/** Pod with a re-attached thruster stage (main bell + side RCS). 16×24 at s=1. */
export function buildPodThrust(s: number, seed = 37): Built & { guns: { x: number; y: number }[] } {
  const W = 16 * s;
  const H = 24 * s;
  const m = new Pix(W, H);
  drawPodMask(m, s, false);
  const P = (pts: readonly Pt[]) => scalePts(pts, s);
  // thruster stage: foil drum
  m.poly(P([[4, 11.6], [12, 11.6], [13, 13], [13, 18.5], [12, 19.5], [4, 19.5], [3, 18.5], [3, 13]]), M.FOIL);
  m.poly(P([[3, 17.4], [13, 17.4], [12, 19.5], [4, 19.5]]), M.FOIL_DK);
  m.poly(P([[6.5, 19.5], [9.5, 19.5], [10.7, 22.4], [5.3, 22.4]]), M.BELL);
  // side RCS nozzles
  m.poly(P([[1.6, 14.6], [3, 14.6], [3, 16.4], [1.6, 16.4]]), M.HULL_DK);
  m.poly(P([[13, 14.6], [14.4, 14.6], [14.4, 16.4], [13, 16.4]]), M.HULL_DK);
  const p = finish(shade(m, { s, cx: W / 2, seed }));
  glintWindows(p, s, -4 * s, 0, 12);
  const guns = podGuns(p, s);
  const engines: EngineAnchor[] = [
    { engine: 'main', x: 8 * s, y: 22.4 * s, dir: { x: 0, y: 1 }, flame: 'fx.flameSmall' },
    { engine: 'left', x: 1.6 * s - 0.5, y: 15.5 * s, dir: { x: -1, y: 0 }, flame: 'fx.flameSmall' },
    { engine: 'right', x: 14.4 * s + 0.5, y: 15.5 * s, dir: { x: 1, y: 0 }, flame: 'fx.flameSmall' },
  ];
  return { pix: p, engines, guns };
}

// --------------------------------------------------------------- debris

/** Wreck chunks: 4 frames = 4 different chunks (pick one per piece). 12×12. */
export function buildDebris(seed = 41): Pix[] {
  const frames: Pix[] = [];
  for (let f = 0; f < 4; f++) {
    const m = new Pix(12, 12);
    const r = (k: number) => hash2(f, k, seed);
    const pts: Pt[] = [];
    const n = 5 + Math.floor(r(0) * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r(i + 1) * 0.6;
      const rad = 2.8 + r(i + 20) * 2.4;
      pts.push([6 + Math.cos(a) * rad, 6 + Math.sin(a) * rad]);
    }
    m.poly(pts, f % 2 === 0 ? M.FOIL : M.HULL);
    m.poly(
      pts.map(([x, y]) => [6 + (x - 6) * 0.55 + 1, 6 + (y - 6) * 0.55 - 1] as Pt),
      f % 2 === 0 ? M.HULL : M.FOIL_DK,
    );
    const p = finish(shade(m, { s: 1, cx: 6, seed: seed + f }));
    // a bent strut sticking out
    const a = r(40) * Math.PI * 2;
    p.line(6 + Math.cos(a) * 3, 6 + Math.sin(a) * 3, 6 + Math.cos(a) * 5.5, 6 + Math.sin(a) * 5.5, GREY[3]!);
    frames.push(p);
  }
  return frames;
}

// ------------------------------------------------------ sprite registry

const flightLander = () => buildLander(1, 'flight');
const contactLander = () => buildLander(1, 'contact');

export const VESSEL_SIZES = {
  'vessel.csm': { w: 24, h: 48 },
  'vessel.lander': { w: 24, h: 24 },
  'vessel.pod': { w: 16, h: 16 },
  'vessel.podThrust': { w: 16, h: 24 },
} as const;

export const VESSEL_PIVOTS = {
  'vessel.csm': { x: 12, y: 27 },
  'vessel.lander': { x: 12, y: 12 },
  'vessel.pod': { x: 8, y: 8 },
  'vessel.podThrust': { x: 8, y: 12 },
} as const;

export type VesselSpriteName = keyof typeof VESSEL_SIZES;

let anchorCache: Record<VesselSpriteName, VesselAnchors> | null = null;

/**
 * Flame / gun / foot anchors for each vessel sprite (native px from the
 * sprite's top-left). Renderers: for each anchor whose `engine` flag is set
 * in VesselState.engines, draw anchor.flame with its pivot at (x, y), rotated
 * so the flame points along `dir` (flames point down, +y, unrotated).
 */
export function getVesselAnchors(name: VesselSpriteName): VesselAnchors {
  if (!anchorCache) {
    const pod = buildPod(1);
    const podT = buildPodThrust(1);
    anchorCache = {
      'vessel.csm': { engines: [buildCsmStack(1).engines], guns: [], feet: [] },
      'vessel.lander': {
        engines: [flightLander().engines, contactLander().engines],
        guns: [],
        feet: [
          { x: 1.5, y: 22.5 },
          { x: 22.5, y: 22.5 },
        ],
      },
      'vessel.pod': { engines: [pod.engines], guns: pod.guns, feet: [] },
      'vessel.podThrust': { engines: [podT.engines], guns: podT.guns, feet: [] },
    };
  }
  return anchorCache[name];
}

const groundCache = new Map<VesselSpriteName, readonly number[]>();

/**
 * Visual ground line of a vessel sprite frame: y (px from the sprite's top,
 * i.e. the bottom EDGE of the lowest opaque row) where leg pads / the engine
 * bell rest on the ground. Renderers align this with the collision box bottom.
 * `frame` wraps like ArtApi.getSprite (negative frames count from the end).
 */
export function vesselGroundY(name: VesselSpriteName, frame = 0): number {
  let gs = groundCache.get(name);
  if (!gs) {
    gs = vesselSprites()[name]!().frames.map((p) => {
      for (let y = p.h - 1; y >= 0; y--) for (let x = 0; x < p.w; x++) if (p.get(x, y) !== 0) return y + 1;
      return 0;
    });
    groundCache.set(name, gs);
  }
  const n = gs.length;
  return gs[((Math.floor(frame) % n) + n) % n]!;
}

export function vesselSprites(): Record<string, () => SpriteDef> {
  return {
    'vessel.csm': () => ({ frames: [buildCsmStack(1).pix], palette: CRAFT, pivot: VESSEL_PIVOTS['vessel.csm'] }),
    'vessel.lander': () => ({ frames: [flightLander().pix, contactLander().pix], palette: CRAFT, pivot: VESSEL_PIVOTS['vessel.lander'] }),
    'vessel.pod': () => ({ frames: [buildPod(1).pix], palette: CRAFT, pivot: VESSEL_PIVOTS['vessel.pod'] }),
    'vessel.podThrust': () => ({ frames: [buildPodThrust(1).pix], palette: CRAFT, pivot: VESSEL_PIVOTS['vessel.podThrust'] }),
    'vessel.debris': () => ({ frames: buildDebris(), palette: CRAFT, pivot: { x: 6, y: 6 } }),
    // large versions for hangar backgrounds / close-ups
    'prop.csm': () => ({ frames: [buildCsmSolo(1).pix], palette: CRAFT, pivot: { x: 12, y: 18 } }),
    'prop.parkedLander': () => ({ frames: [buildLander(2, 'contact').pix], palette: CRAFT, pivot: { x: 24, y: 24 } }),
    'prop.parkedCsm': () => ({ frames: [buildCsmSolo(2).pix], palette: CRAFT, pivot: { x: 24, y: 36 } }),
    'prop.landerLarge': () => ({ frames: [buildLander(3, 'flight').pix], palette: CRAFT, pivot: { x: 36, y: 36 } }),
  };
}

export { mirrorPts };

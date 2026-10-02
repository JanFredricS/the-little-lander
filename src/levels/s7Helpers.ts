/**
 * Level-authoring helpers for maps 5-8 (S7). Deterministic noise bands for
 * ground / ceiling polylines, rectangle / blob polygons and prop scatter.
 *
 * Overlaps with S6's kit.ts are gone (kit's rectPoints replaced s7Rect,
 * surfaceY replaced s7YAt and s7Notch's own interpolation — S8, verified
 * byte-identical level specs for all 8 maps).
 * Kept deliberately (S8, see RESIDUALS.md): s7Blob vs kit.blobPoints and
 * s7Band/s7Noise vs kit.roughen seed differently (string hash vs number)
 * and sample differently, so folding them changes map 5-8 geometry that the
 * S7 pilots, fuel budgets and design tests were tuned on; the rest
 * (s7Piece/s7Prop/s7Scatter/s7Notch/s7Profile) has no kit equivalent.
 */

import type { EntitySpec, SpriteName, StaticPropEntity, TerrainPiece, TerrainStyle, Vec2 } from '../contracts';
import { hashString, rng } from '../physics/geom';
import { surfaceY } from './kit';

/** Smooth deterministic 1D value noise in [-1, 1] with feature size `scale` px. */
export function s7Noise(seed: string, scale: number): (x: number) => number {
  const cache = new Map<number, number>();
  const base = hashString(seed);
  const at = (i: number) => {
    let v = cache.get(i);
    if (v === undefined) {
      v = rng((base ^ Math.imul(i, 0x9e3779b1)) >>> 0)() * 2 - 1;
      cache.set(i, v);
    }
    return v;
  };
  return (x: number) => {
    const f = x / scale;
    const i = Math.floor(f);
    const t = f - i;
    const s = t * t * (3 - 2 * t);
    return at(i) * (1 - s) + at(i + 1) * s;
  };
}

/** A key point of a band profile: at x the band sits at y (linear in between). */
export type S7Key = readonly [x: number, y: number];

/** Piecewise-linear profile through key points (clamped at the ends). */
export function s7Profile(keys: readonly S7Key[]): (x: number) => number {
  return (x: number) => {
    if (x <= keys[0]![0]) return keys[0]![1];
    for (let i = 1; i < keys.length; i++) {
      const [x1, y1] = keys[i]!;
      const [x0, y0] = keys[i - 1]!;
      if (x <= x1) return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
    return keys[keys.length - 1]![1];
  };
}

/**
 * Sample a band polyline from x0 to x1 every `step` px: y = profile(x) +
 * amp·noise(x). Returns points with strictly increasing x (ground/ceiling rule).
 */
export function s7Band(x0: number, x1: number, step: number, profile: (x: number) => number, amp = 0, noise?: (x: number) => number): Vec2[] {
  const pts: Vec2[] = [];
  for (let x = x0; x < x1; x += step) pts.push({ x, y: Math.round(profile(x) + (noise ? amp * noise(x) : 0)) });
  pts.push({ x: x1, y: Math.round(profile(x1) + (noise ? amp * noise(x1) : 0)) });
  return pts;
}

/** A rounded rock blob polygon around (cx, cy): rx × ry radii, jitter 0..1, `n` vertices. */
export function s7Blob(seed: string, cx: number, cy: number, rx: number, ry: number, n = 12, jitter = 0.18): Vec2[] {
  const r = rng(hashString(seed));
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 - jitter + r() * jitter * 2;
    pts.push({ x: Math.round(cx + Math.cos(a) * rx * k), y: Math.round(cy + Math.sin(a) * ry * k) });
  }
  return pts;
}

export function s7Piece(id: string, kind: TerrainPiece['kind'], points: Vec2[], style: TerrainStyle, extra: Partial<TerrainPiece> = {}): TerrainPiece {
  return { id, kind, points, style, ...extra };
}

/** Decor prop (not solid). */
export function s7Prop(id: string, sprite: SpriteName, x: number, y: number, w: number, h: number, extra: Partial<StaticPropEntity> = {}): StaticPropEntity {
  return { id, kind: 'staticProp', sprite, x, y, w, h, ...extra };
}

/**
 * Scatter decor props along [x0, x1): count(x) props per 1000 px, placed by
 * place(x, rand) -> {y, w, h} (or null to skip).
 */
export function s7Scatter(
  idPrefix: string,
  sprite: SpriteName,
  x0: number,
  x1: number,
  perThousand: (x: number) => number,
  place: (x: number, rand: () => number) => { y: number; w: number; h: number; foreground?: boolean } | null,
): EntitySpec[] {
  const r = rng(hashString(idPrefix));
  const out: EntitySpec[] = [];
  let x = x0;
  let i = 0;
  while (x < x1) {
    const density = Math.max(0.01, perThousand(x));
    x += (1000 / density) * (0.5 + r());
    if (x >= x1) break;
    const p = place(x, r);
    if (!p) continue;
    out.push(s7Prop(`${idPrefix}${i++}`, sprite, Math.round(x), Math.round(p.y), p.w, p.h, p.foreground ? { foreground: true } : {}));
  }
  return out;
}

/**
 * Cut a rectangular notch into a band polyline between x0 and x1: the band
 * jumps (over `wall` px) to `toY` and back. Ceiling + small toY = a hole up
 * to the surface; ground + large toY = a chasm. Keeps x strictly increasing.
 */
export function s7Notch(points: readonly Vec2[], x0: number, x1: number, toY: number, wall = 10): Vec2[] {
  const yAt = (x: number) => Math.round(surfaceY(points, x));
  const before = points.filter((p) => p.x < x0);
  const after = points.filter((p) => p.x > x1);
  return [...before, { x: x0, y: yAt(x0) }, { x: x0 + wall, y: toY }, { x: x1 - wall, y: toY }, { x: x1, y: yAt(x1) }, ...after];
}

// ------------------------------------------------------------------ spires (round 13 Hollow, round 17 Vaults)

/** A solid spire: a stalagmite from the floor or a stalactite from the roof (round 13, generalised round 17). */
export interface S7Spire {
  id: string;
  from: 'floor' | 'ceiling';
  x: number;
  /** Tip y (px). */
  tip: number;
  /** Base width (px). */
  base: number;
}

/** Spire half-width (px) at its base, by length. */
export const s7SpireHalf = (len: number): number => Math.min(130, Math.max(45, 0.11 * len + 30));

/**
 * A spire as a polygon: base buried 40 px in its surface (the lower / higher of the surface
 * at the base's two corners), slightly crooked flanks, a blunt 12 px tip. Seeded by its id.
 */
export function s7SpirePoints(sp: S7Spire, floorY: (x: number) => number, ceilY: (x: number) => number): Vec2[] {
  const r = rng(hashString(sp.id));
  const dir = sp.from === 'floor' ? 1 : -1; // base side (+y for the floor)
  const surf = sp.from === 'floor' ? Math.max(floorY(sp.x - sp.base / 2), floorY(sp.x + sp.base / 2)) : Math.min(ceilY(sp.x - sp.base / 2), ceilY(sp.x + sp.base / 2));
  const baseY = surf + dir * 40;
  const lean = (r() - 0.5) * 0.25 * sp.base;
  const tipX = sp.x + lean;
  const pts: Vec2[] = [];
  const n = 4;
  const side = (s: -1 | 1) => {
    const out: Vec2[] = [];
    for (let i = 1; i < n; i++) {
      const t = i / n; // 0 base .. 1 tip
      const w = (sp.base / 2) * (1 - t) ** 1.15 + 7;
      out.push({ x: Math.round(sp.x + (tipX - sp.x) * t + s * w * (0.9 + r() * 0.2)), y: Math.round(baseY + (sp.tip - baseY) * t) });
    }
    return out;
  };
  pts.push({ x: Math.round(sp.x - sp.base / 2), y: Math.round(baseY) });
  pts.push(...side(-1));
  pts.push({ x: Math.round(tipX - 6), y: sp.tip }, { x: Math.round(tipX + 6), y: sp.tip });
  pts.push(...side(1).reverse());
  pts.push({ x: Math.round(sp.x + sp.base / 2), y: Math.round(baseY) });
  return pts;
}

/** Distance (px) from a point to a polygon's outline; 0 inside. */
export function s7DistToPolygon(p: Vec2, pts: readonly Vec2[]): number {
  let inside = false;
  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return inside ? 0 : best;
}

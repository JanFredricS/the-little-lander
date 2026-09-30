/**
 * Level-authoring helpers for maps 5-8 (S7). Deterministic noise bands for
 * ground / ceiling polylines, rectangle / blob polygons and prop scatter.
 *
 * Trivial overlaps with S6's kit.ts are gone (use kit's rectPoints for the
 * old s7Rect and surfaceY for s7YAt).
 * TODO(S8): fold the rest into kit.ts - s7Blob vs kit.blobPoints and
 * s7Band/s7Noise vs kit.roughen use different seeding (string hash vs
 * number), so merging them changes map geometry and needs re-verifying the
 * map 5-8 design tests; s7Piece/s7Prop/s7Scatter/s7Notch/s7Profile have no
 * kit equivalent yet.
 */

import type { EntitySpec, SpriteName, StaticPropEntity, TerrainPiece, TerrainStyle, Vec2 } from '../contracts';
import { hashString, rng } from '../physics/geom';

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
  const yAt = (x: number) => {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      if (x <= b.x) return Math.round(a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x));
    }
    return points[points.length - 1]!.y;
  };
  const before = points.filter((p) => p.x < x0);
  const after = points.filter((p) => p.x > x1);
  return [...before, { x: x0, y: yAt(x0) }, { x: x0 + wall, y: toY }, { x: x1 - wall, y: toY }, { x: x1, y: yAt(x1) }, ...after];
}

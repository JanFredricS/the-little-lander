/** Waypoint path sampling for moving islands and creatures (pure maths, world px). */

import type { Vec2 } from '../../contracts';

export interface PathSampler {
  /** Total length (px) of the traversal (loop includes the closing segment). */
  readonly length: number;
  /** Point at arc distance d (wraps for loops, clamps for open paths). */
  at(d: number): Vec2;
}

export function pathSampler(points: readonly Vec2[], closed: boolean): PathSampler {
  const pts = closed && points.length > 2 ? [...points, points[0]!] : [...points];
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
  const length = cum[cum.length - 1]!;
  return {
    length,
    at(d: number): Vec2 {
      if (length <= 0) return { ...pts[0]! };
      let s = closed ? ((d % length) + length) % length : Math.min(length, Math.max(0, d));
      let i = 1;
      while (i < cum.length - 1 && cum[i]! < s) i++;
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const seg = cum[i]! - cum[i - 1]! || 1;
      s = (s - cum[i - 1]!) / seg;
      return { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s };
    },
  };
}

/**
 * Offset (relative to the path origin) of a moving island at time t.
 * 'loop': constant speed around the closed path. 'pingpong': out and back
 * with cosine easing (a gentle sway: slow at the ends, zero speed at the
 * turn-arounds), one full out-and-back per period.
 */
export function islandOffset(path: readonly Vec2[], periodSec: number, motion: 'loop' | 'pingpong', t: number): Vec2 {
  const s = pathSampler(path, motion === 'loop');
  const phase = (((t / periodSec) % 1) + 1) % 1;
  if (motion === 'loop') return s.at(phase * s.length);
  return s.at(((1 - Math.cos(phase * Math.PI * 2)) / 2) * s.length);
}

/** Peak speed (px/s) of an island's motion (for landing-fairness checks). */
export function islandPeakSpeed(path: readonly Vec2[], periodSec: number, motion: 'loop' | 'pingpong'): number {
  const s = pathSampler(path, motion === 'loop');
  return motion === 'loop' ? s.length / periodSec : (Math.PI * s.length) / periodSec;
}

/** px <-> metre conversion and small vector helpers (see contracts/constants.ts). */

import { PX_PER_M } from '../contracts';
import type { Vec2 } from '../contracts';

export const pxToM = (px: number): number => px / PX_PER_M;
export const mToPx = (m: number): number => m * PX_PER_M;
export const vPxToM = (v: Vec2): Vec2 => ({ x: v.x / PX_PER_M, y: v.y / PX_PER_M });
export const vMToPx = (v: Vec2): Vec2 => ({ x: v.x * PX_PER_M, y: v.y * PX_PER_M });

/** Signed area (shoelace); > 0 = counter-clockwise in math (y-up) orientation. */
export function signedArea(points: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

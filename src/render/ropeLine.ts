/**
 * Rope polyline for rendering (pure, world px): straight when taut, sagging
 * along +y (screen down) when the rope is longer than the chord. The sag is a
 * parabola whose arc length approximates the rope length
 * (L ≈ c + 8d²/3c  ->  d = √(3c·slack/8)), capped so a very slack rope never
 * hangs more than half its length.
 */

import type { Vec2 } from '../contracts';

export const ROPE_SEGMENTS = 12;

export function ropePolyline(a: Vec2, b: Vec2, length: number, segments = ROPE_SEGMENTS): Vec2[] {
  return ropePolylineInto([], a.x, a.y, b, length, segments);
}

/**
 * ropePolyline() written into `out` (resized to segments + 1 points, whose
 * objects are reused): the per-frame render path allocates nothing once
 * `out` has grown. Returns `out`.
 */
export function ropePolylineInto(out: Vec2[], ax: number, ay: number, b: Vec2, length: number, segments = ROPE_SEGMENTS): Vec2[] {
  const dx = b.x - ax;
  const dy = b.y - ay;
  const chord = Math.hypot(dx, dy);
  const slack = Math.max(0, length - chord);
  let sag = chord > 1e-6 ? Math.sqrt((3 * chord * slack) / 8) : slack / 2;
  sag = Math.min(sag, length / 2);
  // Sag direction: screen-down, made perpendicular to the chord (a vertical rope just hangs straight).
  let px = 0;
  let py = 1;
  if (chord > 1e-6) {
    const ux = dx / chord;
    const uy = dy / chord;
    const along = px * ux + py * uy;
    px -= along * ux;
    py -= along * uy;
    const m = Math.hypot(px, py);
    if (m < 1e-3) sag = 0;
    else {
      px /= m;
      py /= m;
    }
  }
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const k = 4 * t * (1 - t) * sag; // parabola, 0 at the ends, `sag` mid-way
    const q = out[i] ?? (out[i] = { x: 0, y: 0 });
    q.x = ax + dx * t + px * k;
    q.y = ay + dy * t + py * k;
  }
  out.length = segments + 1;
  return out;
}

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
  const dx = b.x - a.x;
  const dy = b.y - a.y;
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
  const out: Vec2[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const k = 4 * t * (1 - t) * sag; // parabola, 0 at the ends, `sag` mid-way
    out.push({ x: a.x + dx * t + px * k, y: a.y + dy * t + py * k });
  }
  return out;
}

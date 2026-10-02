/**
 * Round 15: one-way (jump-through) platforms. A terrain piece with `oneWay` (and a
 * crumble platform with `oneWay`) lives on its own static body; before every step the
 * gate enables that body only while every hull corner over the platform is above its
 * top surface at that corner's x (per corner: a hull tilted over the edge still stands),
 * so the vessel passes up through it (and in from the side, lower down) and stands on it
 * from above. Gravity is assumed to point down the screen (+y),
 * which is true on every level that uses them.
 *
 * Hysteresis: a DISABLED gate enables only once those corners are at / above the top
 * (+ ENABLE_TOL), an ENABLED gate stays enabled while they are within STAY_TOL below
 * it (resting contact, a sloped top under one foot), so standing never flickers and a
 * vessel rising through is never caught by its own edge.
 */

import type { BodyHandle, PhysicsApi, TerrainPiece, Vec2 } from '../../contracts';
import type { FlightVessel } from '../../physics/vessel';
import { mToPx } from '../../physics/units';
import type { LevelSystem, LevelSystemHost } from './types';

/** px: a disabled gate turns on when the vessel bottom is at most this far below the top. */
export const ONE_WAY_ENABLE_TOL = 0.5;
/** px: an enabled gate stays on while the bottom is at most this far below the top. */
export const ONE_WAY_STAY_TOL = 4;

/** Highest point (smallest y) of a closed outline's boundary over x in [x0, x1]; null when the outline does not span it. */
export function outlineTopOver(points: readonly Vec2[], x0: number, x1: number): number | null {
  let best = Infinity;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    const lo = Math.max(Math.min(a.x, b.x), x0);
    const hi = Math.min(Math.max(a.x, b.x), x1);
    if (lo > hi) continue;
    // a straight edge is extreme at its clipped ends (no per-edge allocation: round 15 audit L7)
    if (a.x === b.x) best = Math.min(best, a.y, b.y);
    else {
      const k = (b.y - a.y) / (b.x - a.x);
      best = Math.min(best, a.y + k * (lo - a.x), a.y + k * (hi - a.x));
    }
  }
  return best === Infinity ? null : best;
}

/**
 * The vessel's collision-box corners in world px (reused scratch: no per-step allocation), plus
 * their lowest / highest point and x extent. read() refreshes it; false = no vessel body.
 */
export class VesselCorners {
  /** x0, y0, x1, y1, ... (world px). */
  readonly xy: number[] = [];
  count = 0;
  bottom = 0;
  top = 0;
  x0 = 0;
  x1 = 0;

  read(physics: PhysicsApi, vessel: FlightVessel): boolean {
    if (!physics.hasBody(vessel.body)) return false;
    const t = physics.getTransform(vessel.body);
    const cx = mToPx(t.x);
    const cy = mToPx(t.y);
    const c = Math.cos(t.angle);
    const s = Math.sin(t.angle);
    let n = 0;
    this.bottom = -Infinity;
    this.top = Infinity;
    this.x0 = Infinity;
    this.x1 = -Infinity;
    for (const b of vessel.geometry.boxes) {
      for (let k = 0; k < 4; k++) {
        const lx = b.x + ((k === 0 || k === 3 ? -1 : 1) * b.w) / 2;
        const ly = b.y + ((k < 2 ? -1 : 1) * b.h) / 2;
        const x = cx + lx * c - ly * s;
        const y = cy + lx * s + ly * c;
        this.xy[n++] = x;
        this.xy[n++] = y;
        if (y > this.bottom) this.bottom = y;
        if (y < this.top) this.top = y;
        if (x < this.x0) this.x0 = x;
        if (x > this.x1) this.x1 = x;
      }
    }
    this.count = n / 2;
    return true;
  }
}

/** One jump-through body: its outline (world px) decides the top surface. */
export class OneWayGate {
  private readonly minX: number;
  private readonly maxX: number;
  private readonly peak: number;

  constructor(
    private readonly physics: PhysicsApi,
    readonly body: BodyHandle,
    private readonly outline: readonly Vec2[],
  ) {
    this.minX = Math.min(...outline.map((p) => p.x));
    this.maxX = Math.max(...outline.map((p) => p.x));
    this.peak = Math.min(...outline.map((p) => p.y));
  }

  /** Top surface (px) at x (clamped to the outline's span). */
  topAt(x: number): number {
    const cx = Math.min(this.maxX, Math.max(this.minX, x));
    return outlineTopOver(this.outline, cx, cx) ?? this.peak;
  }

  /**
   * Per corner (round 15 audit M2): solid while EVERY hull corner over the outline's span is at /
   * above the top surface at that corner's x (+ tolerance). A hull tilted over the edge (its low
   * corner out over the drop) still stands; one rising through (a corner under the top) passes.
   * No corner over the span: solid only when the whole hull is above the platform's peak.
   */
  update(v: VesselCorners | null): void {
    if (!this.physics.hasBody(this.body)) return;
    if (!v) {
      this.physics.setBodyEnabled(this.body, true);
      return;
    }
    const tol = this.physics.isBodyEnabled(this.body) ? ONE_WAY_STAY_TOL : ONE_WAY_ENABLE_TOL;
    let over = false;
    let above = true;
    for (let i = 0; i < v.count && above; i++) {
      const x = v.xy[2 * i]!;
      if (x < this.minX || x > this.maxX) continue;
      over = true;
      if (v.xy[2 * i + 1]! > this.topAt(x) + tol) above = false;
    }
    this.physics.setBodyEnabled(this.body, over ? above : v.bottom <= this.peak + tol);
  }
}

/** Gates every `oneWay` terrain piece (BuiltLevel.oneWay). */
export class OneWaySystem implements LevelSystem {
  readonly gates: OneWayGate[];

  constructor(private readonly host: LevelSystemHost) {
    this.gates = host.built.oneWay.map((o) => new OneWayGate(host.physics, o.body, o.piece.points));
  }

  private readonly corners = new VesselCorners();

  beforeStep(): void {
    const v = this.corners.read(this.host.physics, this.host.vessel) ? this.corners : null;
    for (const g of this.gates) g.update(v);
  }
}

/** Is a terrain piece a one-way platform (only polygons may be)? */
export function isOneWayPiece(p: TerrainPiece): boolean {
  return p.oneWay === true && p.kind === 'polygon';
}

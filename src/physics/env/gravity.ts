/**
 * Gravity field: level gravity, gravity ramp (by vessel progress along an
 * axis) and local gravity zones.
 *
 * Box2D has one world gravity, so: world gravity = the level/ramp gravity
 * ("base"), and a body inside a zone gets a correction force
 * m · gravityScale · (zoneGravity − base) each step, so its net gravity is the
 * zone's (REPLACED, per the GravityZone contract). Bodies with gravityScale 0
 * (free goo) stay weightless.
 */

import type { BodyHandle, GameEventSink, GravityZone, LevelSpec, PhysicsApi, Vec2 } from '../../contracts';
import { polygonContains, rectContains } from '../geom';
import type { PhysicsTuning } from '../tuning';
import { mToPx } from '../units';

export class GravityField {
  readonly zones: readonly GravityZone[];
  private reported: Vec2;
  private reportedZone: string | undefined;

  constructor(
    private readonly physics: PhysicsApi,
    private readonly spec: LevelSpec,
    private readonly tuning: PhysicsTuning['gravity'],
    private readonly events: GameEventSink,
  ) {
    this.zones = spec.zones.filter((z): z is GravityZone => z.kind === 'gravityZone');
    this.reported = { ...spec.gravity };
  }

  /** Level gravity at a vessel position (ramp applied) + ramp progress 0..1. */
  baseAt(vesselPos: Vec2): { g: Vec2; progress?: number } {
    const r = this.spec.gravityRamp;
    if (!r) return { g: { ...this.spec.gravity } };
    const p = r.axis === 'x' ? vesselPos.x : vesselPos.y;
    const t = Math.min(1, Math.max(0, (p - r.from) / (r.to - r.from)));
    return {
      g: { x: r.gravityFrom.x + (r.gravityTo.x - r.gravityFrom.x) * t, y: r.gravityFrom.y + (r.gravityTo.y - r.gravityFrom.y) * t },
      progress: t,
    };
  }

  zoneAt(p: Vec2): GravityZone | undefined {
    return this.zones.find((z) => rectContains(z.rect, p) && (!z.polygon || polygonContains(z.polygon, p)));
  }

  /** Effective gravity (m/s²) at world px `p` given the vessel position driving the ramp. */
  effectiveAt(p: Vec2, vesselPos: Vec2): Vec2 {
    return this.zoneAt(p)?.gravity ?? this.baseAt(vesselPos).g;
  }

  /** Per step, before physics.step(): world gravity + zone corrections + gravityChanged events. */
  update(vesselPos: Vec2, bodies: Iterable<BodyHandle>): void {
    const base = this.baseAt(vesselPos);
    const cur = this.physics.getGravity();
    if (Math.abs(cur.x - base.g.x) + Math.abs(cur.y - base.g.y) > 1e-4) this.physics.setGravity(base.g);

    if (this.zones.length) {
      for (const b of bodies) {
        if (!this.physics.hasBody(b)) continue;
        const scale = this.physics.getGravityScale(b);
        if (scale === 0) continue;
        const t = this.physics.getTransform(b);
        const z = this.zoneAt({ x: mToPx(t.x), y: mToPx(t.y) });
        if (!z) continue;
        const m = this.physics.getMass(b) * scale;
        this.physics.applyForce(b, { x: m * (z.gravity.x - base.g.x), y: m * (z.gravity.y - base.g.y) });
      }
    }

    const zone = this.zoneAt(vesselPos);
    const g = zone?.gravity ?? base.g;
    const moved = Math.hypot(g.x - this.reported.x, g.y - this.reported.y) >= this.tuning.eventThreshold;
    if (moved || zone?.id !== this.reportedZone) {
      this.reported = { ...g };
      this.reportedZone = zone?.id;
      this.events(base.progress !== undefined ? { type: 'gravityChanged', gravity: { ...g }, rampProgress: base.progress } : { type: 'gravityChanged', gravity: { ...g } });
    }
  }
}

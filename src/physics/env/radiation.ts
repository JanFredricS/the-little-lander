/**
 * Radiation emitters (the malfunctioning sun). Pulse k fires at
 * firstAtSec + k·periodSec; warnSec before it a radiationCharging event is
 * the telegraph. On a pulse the vessel is hit if it is within `range` and the
 * segment emitter -> vessel is not blocked by a solid body (terrain, props:
 * castSolid skips goo / debris / pickups / the vessel). A hit drains
 * fuelLoss × CURRENT fuel.
 */

import type { GameEventSink, PhysicsApi, RadiationEmitter, Vec2, ZoneSpec } from '../../contracts';
import { dist } from '../geom';
import { castSolid } from '../tags';
import { vMToPx, vPxToM } from '../units';
import type { FlightVessel } from '../vessel/types';

export interface PulseResult {
  at: number;
  inRange: boolean;
  blocked: boolean;
  hit: boolean;
  /** Vessel position (px) at the pulse. */
  target: Vec2;
  /** Where the ray was blocked (px), if it was. */
  blockedAt?: Vec2;
}

export interface EmitterState {
  spec: RadiationEmitter;
  /** Index of the next pulse. */
  next: number;
  charging: boolean;
  last?: PulseResult;
}

export class RadiationSystem {
  readonly emitters: EmitterState[];

  constructor(
    private readonly physics: PhysicsApi,
    zones: readonly ZoneSpec[],
    private readonly events: GameEventSink,
  ) {
    this.emitters = zones.filter((z): z is RadiationEmitter => z.kind === 'radiationEmitter').map((spec) => ({ spec, next: 0, charging: false }));
  }

  pulseTime(e: EmitterState, k = e.next): number {
    return (e.spec.firstAtSec ?? e.spec.periodSec) + k * e.spec.periodSec;
  }

  /** 0..1 charge-up of the next pulse (render glow). */
  charge(e: EmitterState, t: number): number {
    const p = this.pulseTime(e);
    if (e.spec.warnSec <= 0) return t >= p ? 1 : 0;
    return Math.min(1, Math.max(0, (t - (p - e.spec.warnSec)) / e.spec.warnSec));
  }

  /** After physics.step(), at sim time t. */
  update(t: number, vessel: FlightVessel, vesselPos: Vec2): void {
    for (const e of this.emitters) {
      const p = this.pulseTime(e);
      if (!e.charging && t >= p - e.spec.warnSec - 1e-9) {
        e.charging = true;
        this.events({ type: 'radiationCharging', emitterId: e.spec.id, inSec: Math.max(0, p - t) });
      }
      if (t >= p - 1e-9) {
        e.last = this.fire(e, t, vessel, vesselPos);
        e.next++;
        e.charging = false;
      }
    }
  }

  /** Line of sight from emitter to a world-px point: the first solid hit (px) or null when clear. */
  lineOfSight(from: Vec2, to: Vec2, ignore: readonly number[]): Vec2 | null {
    const hit = castSolid(this.physics, vPxToM(from), vPxToM(to), ignore);
    return hit ? vMToPx(hit.point) : null;
  }

  private fire(e: EmitterState, t: number, vessel: FlightVessel, vesselPos: Vec2): PulseResult {
    const src = { x: e.spec.x, y: e.spec.y };
    const inRange = dist(src, vesselPos) <= e.spec.range;
    const res: PulseResult = { at: t, inRange, blocked: false, hit: false, target: { ...vesselPos } };
    if (!inRange) return res;
    const block = this.lineOfSight(src, vesselPos, [...vessel.parts]);
    if (block) {
      res.blocked = true;
      res.blockedAt = block;
      return res;
    }
    const s = vessel.state();
    const fuelLost = s.fuel * e.spec.fuelLoss;
    res.hit = true;
    this.events({ type: 'radiationHit', emitterId: e.spec.id, fuelLost });
    vessel.addFuel(-fuelLost, 'radiation');
    return res;
  }
}

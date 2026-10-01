/**
 * Orbs (points + fuel) and fuel pickups: static sensor circles. When any
 * vessel part (hull or attached goo) enters one, it is collected once:
 * orbCollected (orbs) then fuelChanged ('orb' / 'pickup').
 */

import type { BodyHandle, EntitySpec, FuelPickupEntity, GameEventSink, OrbEntity, PhysicsApi } from '../../contracts';
import { stepSensors } from '../stepEvents';
import { TAG_FUEL, TAG_ORB } from '../tags';
import type { PhysicsTuning } from '../tuning';
import { pxToM } from '../units';
import type { FlightVessel } from '../vessel/types';

export interface Pickup {
  entity: OrbEntity | FuelPickupEntity;
  body: BodyHandle;
  collected: boolean;
  /** px */
  radius: number;
}

export class PickupSystem {
  readonly pickups: Pickup[];
  orbsCollected = 0;
  points = 0;
  private readonly byBody = new Map<BodyHandle, Pickup>();

  constructor(
    private readonly physics: PhysicsApi,
    entities: readonly EntitySpec[],
    tuning: PhysicsTuning['pickup'],
    private readonly events: GameEventSink,
  ) {
    this.pickups = [];
    for (const e of entities) {
      if (e.kind !== 'orb' && e.kind !== 'fuelPickup') continue;
      const radius = e.kind === 'orb' ? tuning.orbRadius : tuning.fuelRadius;
      const body = physics.createBody({ type: 'static', position: { x: pxToM(e.x), y: pxToM(e.y) }, tag: e.kind === 'orb' ? TAG_ORB : TAG_FUEL });
      physics.addSensorCircle(body, { x: 0, y: 0 }, pxToM(radius));
      const p: Pickup = { entity: e, body, collected: false, radius };
      this.pickups.push(p);
      this.byBody.set(body, p);
    }
  }

  /** Ids of the pickups collected so far. */
  collectedIds(): string[] {
    return this.pickups.filter((p) => p.collected).map((p) => p.entity.id);
  }

  /**
   * Round 12 checkpoint respawn: these pickups are already taken (silently: no events, no
   * fuel - the respawn's fuel is the checkpoint's). Orbs still count toward orbs / points.
   */
  restoreCollected(ids: readonly string[]): void {
    for (const p of this.pickups) {
      if (p.collected || !ids.includes(p.entity.id)) continue;
      p.collected = true;
      this.byBody.delete(p.body);
      if (this.physics.hasBody(p.body)) this.physics.destroyBody(p.body);
      if (p.entity.kind === 'orb') {
        this.orbsCollected++;
        this.points += p.entity.points;
      }
    }
  }

  /** After physics.step(). */
  update(vessel: FlightVessel): void {
    if (!this.byBody.size) return;
    for (const ev of stepSensors(this.physics).begin) {
      const p = this.byBody.get(ev.sensor);
      if (!p || p.collected || !vessel.parts.has(ev.visitor)) continue;
      this.collect(p, vessel);
    }
  }

  private collect(p: Pickup, vessel: FlightVessel): void {
    p.collected = true;
    this.byBody.delete(p.body);
    if (this.physics.hasBody(p.body)) this.physics.destroyBody(p.body);
    const e = p.entity;
    if (e.kind === 'orb') {
      this.orbsCollected++;
      this.points += e.points;
      this.events({ type: 'orbCollected', entityId: e.id, points: e.points, fuelRefill: e.fuelRefill });
      if (e.fuelRefill > 0) vessel.addFuel(e.fuelRefill, 'orb');
    } else {
      vessel.addFuel(e.amount, 'pickup');
    }
  }
}

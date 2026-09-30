/**
 * Vessel controllers, one per VesselMode, built on PhysicsApi (whose
 * bodyContacts() — S8 amendment — feeds soft-landing and impulse damage).
 *
 *   const factory = vesselFactory('lander', vesselOptionsFor(spec));
 *   const vessel = factory(physics, spawn, events);
 *
 * VESSEL_FACTORIES uses default tuning with reference gravity taken from the
 * world at creation time and one harpoon gun.
 */

import type { GameEventSink, PhysicsApi, VesselControllerFactory, VesselMode, VesselSpawn } from '../../contracts';
import { referenceGravity, resolveTuning, type VesselOptions } from '../tuning';
import { CsmController } from './csm';
import { HarpoonController, HarpoonThrustController } from './harpoon';
import { LanderController } from './lander';
import type { FlightVessel } from './types';

export { CsmController } from './csm';
export { LanderController } from './lander';
export { HarpoonController, HarpoonThrustController } from './harpoon';
export type { FlightVessel, VesselGeometry, VesselHooks } from './types';

const CTORS = {
  csm: CsmController,
  lander: LanderController,
  harpoon: HarpoonController,
  harpoonThrust: HarpoonThrustController,
} as const;

export function createVessel(mode: VesselMode, physics: PhysicsApi, spawn: VesselSpawn, events: GameEventSink, options?: VesselOptions): FlightVessel {
  const opts = options ?? { tuning: resolveTuning(), refGravity: referenceGravity(physics.getGravity()), harpoonGuns: 1 };
  return new CTORS[mode](physics, spawn, events, opts);
}

/** A factory for `mode` with fixed options (a VesselControllerFactory returning the FlightVessel view). */
export function vesselFactory(mode: VesselMode, options?: VesselOptions): (physics: PhysicsApi, spawn: VesselSpawn, events: GameEventSink) => FlightVessel {
  return (physics, spawn, events) => createVessel(mode, physics, spawn, events, options);
}

export const VESSEL_FACTORIES: Readonly<Record<VesselMode, VesselControllerFactory>> = {
  csm: vesselFactory('csm'),
  lander: vesselFactory('lander'),
  harpoon: vesselFactory('harpoon'),
  harpoonThrust: vesselFactory('harpoonThrust'),
};

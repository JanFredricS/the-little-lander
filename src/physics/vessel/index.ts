/**
 * Vessel controllers, one per VesselMode. Internally they take FlightPhysics
 * (PhysicsApi + the contact-data extension, src/physics/contactData.ts), so a
 * non-conforming physics is a compile error; VESSEL_FACTORIES adapts them to
 * the frozen VesselControllerFactory signature (plain PhysicsApi) by
 * narrowing with requireContactData() at that single boundary.
 * Proposed contract amendment (S8): type VesselControllerFactory's `physics`
 * as PhysicsApi-with-bodyContacts so this adapter can go.
 *
 *   const factory = vesselFactory('lander', vesselOptionsFor(spec));
 *   const vessel = factory(physics, spawn, events);
 *
 * VESSEL_FACTORIES uses default tuning with reference gravity taken from the
 * world at creation time and one harpoon gun.
 */

import type { GameEventSink, VesselControllerFactory, VesselMode, VesselSpawn } from '../../contracts';
import { requireContactData, type FlightPhysics } from '../contactData';
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

export function createVessel(mode: VesselMode, physics: FlightPhysics, spawn: VesselSpawn, events: GameEventSink, options?: VesselOptions): FlightVessel {
  const opts = options ?? { tuning: resolveTuning(), refGravity: referenceGravity(physics.getGravity()), harpoonGuns: 1 };
  return new CTORS[mode](physics, spawn, events, opts);
}

/** A factory for `mode` with fixed options (strict: FlightPhysics). */
export function vesselFactory(mode: VesselMode, options?: VesselOptions): (physics: FlightPhysics, spawn: VesselSpawn, events: GameEventSink) => FlightVessel {
  return (physics, spawn, events) => createVessel(mode, physics, spawn, events, options);
}

/** Adapt a strict factory to the frozen contract type: the single PhysicsApi -> FlightPhysics narrowing point. */
export function contractFactory(strict: (physics: FlightPhysics, spawn: VesselSpawn, events: GameEventSink) => FlightVessel): VesselControllerFactory {
  return (physics, spawn, events) => strict(requireContactData(physics), spawn, events);
}

export const VESSEL_FACTORIES: Readonly<Record<VesselMode, VesselControllerFactory>> = {
  csm: contractFactory(vesselFactory('csm')),
  lander: contractFactory(vesselFactory('lander')),
  harpoon: contractFactory(vesselFactory('harpoon')),
  harpoonThrust: contractFactory(vesselFactory('harpoonThrust')),
};

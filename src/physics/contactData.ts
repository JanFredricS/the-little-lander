/**
 * Touching-contact data with solver impulses — a physics-local extension of
 * the (frozen) PhysicsApi contract.
 *
 * The REAL interface the flight layer (vessels) builds on is `FlightPhysics`
 * (= `PhysicsApi & ContactDataSource`): soft-land (legs-down contact normals)
 * and impulse-based hull damage need it, and there is no degraded fallback.
 * Vessel constructors, createVessel() and vesselFactory() take FlightPhysics,
 * so a PhysicsApi without it is a compile error. PhysicsWorld
 * (src/physics/engine.ts), our only implementation, conforms structurally.
 *
 * The frozen contract's VesselControllerFactory still passes a plain
 * PhysicsApi; the one place that adapts to it (VESSEL_FACTORIES in
 * src/physics/vessel/index.ts) narrows with requireContactData(), which
 * throws on a non-conforming implementation. VesselBase re-asserts at runtime
 * as a backstop against casts.
 *
 * Proposed contract amendment (S8): fold `bodyContacts` into PhysicsApi (or
 * type VesselControllerFactory's `physics` as FlightPhysics); the narrowing
 * adapter then goes away.
 */

import type { BodyHandle, PhysicsApi, Vec2 } from '../contracts';

export interface BodyContactPoint {
  /** World point (m). */
  point: Vec2;
  /** Total normal impulse (N·s) the solver applied at this point during the last step (all sub-steps). */
  impulse: number;
}

export interface BodyContact {
  other: BodyHandle;
  /** Unit normal (world) pointing FROM the queried body TOWARD `other`. */
  normal: Vec2;
  points: BodyContactPoint[];
}

export interface ContactDataSource {
  /** Current touching contacts of `h` (manifold points, impulses of the last step). */
  bodyContacts(h: BodyHandle): BodyContact[];
}

/** The physics surface flight vessels are built on. */
export type FlightPhysics = PhysicsApi & ContactDataSource;

export function hasContactData(p: PhysicsApi): p is FlightPhysics {
  return typeof (p as Partial<ContactDataSource>).bodyContacts === 'function';
}

/** Narrow a contract PhysicsApi to FlightPhysics; throws if it lacks the contact-data extension. */
export function requireContactData(p: PhysicsApi): FlightPhysics {
  if (!hasContactData(p)) {
    throw new Error('Flight vessels need PhysicsApi + ContactDataSource.bodyContacts() (src/physics/contactData.ts); use PhysicsWorld.');
  }
  return p;
}

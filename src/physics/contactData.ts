/**
 * Touching-contact data with solver impulses — a physics-local extension of
 * the (frozen) PhysicsApi contract. PhysicsWorld implements it; any other
 * PhysicsApi falls back to null and callers use ContactReport.hits instead.
 *
 * Proposed contract amendment: fold `bodyContacts` into PhysicsApi.
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

export function hasContactData(p: PhysicsApi): p is PhysicsApi & ContactDataSource {
  return typeof (p as Partial<ContactDataSource>).bodyContacts === 'function';
}

/** Contacts of `h`, or null when the physics implementation lacks contact data. */
export function bodyContacts(p: PhysicsApi, h: BodyHandle): BodyContact[] | null {
  return hasContactData(p) ? p.bodyContacts(h) : null;
}

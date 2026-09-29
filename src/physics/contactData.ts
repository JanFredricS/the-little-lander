/**
 * Touching-contact data with solver impulses — a physics-local extension of
 * the (frozen) PhysicsApi contract.
 *
 * The REAL interface the flight layer (vessels) builds on is
 * `PhysicsApi & ContactDataSource`: soft-land (legs-down contact normals) and
 * impulse-based hull damage need it, and there is no degraded fallback.
 * PhysicsWorld (src/physics/engine.ts), our only physics implementation,
 * provides it; vessel construction throws on a PhysicsApi without it.
 *
 * Proposed contract amendment (S8): fold `bodyContacts` into PhysicsApi.
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

/** The contact-data extension of `p`; throws if this PhysicsApi lacks it. */
export function requireContactData(p: PhysicsApi): ContactDataSource {
  if (!hasContactData(p)) {
    throw new Error('Flight vessels need PhysicsApi + ContactDataSource.bodyContacts() (src/physics/contactData.ts); use PhysicsWorld.');
  }
  return p;
}

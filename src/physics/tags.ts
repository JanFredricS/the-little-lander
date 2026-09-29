/** Body tags used by the flight systems (BodyTag convention: lowerCamel). */

import type { BodyHandle, PhysicsApi, RayHit, Vec2 } from '../contracts';

export const TAG_VESSEL = 'vessel';
export const TAG_GOO = 'goo';
export const TAG_DEBRIS = 'debris';
export const TAG_DEBRIS_BURNING = 'debrisBurning';
export const TAG_ORB = 'orb';
export const TAG_FUEL = 'fuelPickup';

/** Bodies that never block rays (harpoon flight, radiation line of sight) nor count as landing support. */
export const PASS_THROUGH_TAGS: ReadonlySet<string> = new Set([TAG_VESSEL, TAG_GOO, TAG_DEBRIS, TAG_DEBRIS_BURNING, TAG_ORB, TAG_FUEL]);

/** Hazards that damage the hull on contact but never count as a hard-landing crash. */
export function isDebrisTag(tag: string | undefined): boolean {
  return tag === TAG_DEBRIS || tag === TAG_DEBRIS_BURNING;
}

/**
 * Closest hit from -> to (m) on a SOLID body: skips `ignore` and every body
 * tagged in PASS_THROUGH_TAGS (goo, debris, pickups, vessels).
 */
export function castSolid(physics: PhysicsApi, from: Vec2, to: Vec2, ignore: readonly BodyHandle[] = []): RayHit | null {
  const skip = [...ignore];
  for (let guard = 0; guard < 12; guard++) {
    const hit = physics.rayCast(from, to, skip);
    if (!hit) return null;
    if (!PASS_THROUGH_TAGS.has(physics.getTag(hit.body) ?? '')) return hit;
    skip.push(hit.body);
  }
  return null;
}

/**
 * Physics tuning registry. One constants module per vessel mode plus the
 * environment module; LevelSpec.physicsOverrides patches them per level with
 * flat `<group>.<field>` keys (e.g. `'csm.thrust'`, `'goo.burnSec'`).
 *
 * PHYSICS_OVERRIDE_KEYS is the registered key list: the level validator flags
 * any override key not in it. resolveTuning() ignores unknown keys.
 */

import type { LevelSpec, Vec2 } from '../../contracts';
import { CSM_TUNING } from './csm';
import { LANDER_TUNING } from './lander';
import { HARPOON_TUNING } from './harpoon';
import { HARPOON_THRUST_TUNING } from './harpoonThrust';
import { BEACON_TUNING, DEBRIS_TUNING, GOO_TUNING, GRAVITY_TUNING, PICKUP_TUNING } from './environment';

export { CSM_TUNING, LANDER_TUNING, HARPOON_TUNING, HARPOON_THRUST_TUNING, GOO_TUNING, DEBRIS_TUNING, PICKUP_TUNING, BEACON_TUNING, GRAVITY_TUNING };
export type { CsmTuning } from './csm';
export type { LanderTuning } from './lander';
export type { HarpoonTuning } from './harpoon';
export type { HarpoonThrustTuning } from './harpoonThrust';

const DEFAULTS = {
  csm: CSM_TUNING,
  lander: LANDER_TUNING,
  harpoon: HARPOON_TUNING,
  harpoonThrust: HARPOON_THRUST_TUNING,
  goo: GOO_TUNING,
  debris: DEBRIS_TUNING,
  pickup: PICKUP_TUNING,
  beacon: BEACON_TUNING,
  gravity: GRAVITY_TUNING,
};

export type PhysicsTuning = { readonly [G in keyof typeof DEFAULTS]: Readonly<(typeof DEFAULTS)[G]> };

/** Every key LevelSpec.physicsOverrides may use. */
export const PHYSICS_OVERRIDE_KEYS: readonly string[] = Object.entries(DEFAULTS).flatMap(([group, values]) =>
  Object.keys(values).map((k) => `${group}.${k}`),
);

/** Defaults patched with `overrides` (unknown keys ignored). Returns fresh frozen objects. */
export function resolveTuning(overrides?: Readonly<Record<string, number>>): PhysicsTuning {
  const out: Record<string, Record<string, number>> = {};
  for (const [group, values] of Object.entries(DEFAULTS)) out[group] = { ...values };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    const dot = key.indexOf('.');
    const group = out[key.slice(0, dot)];
    const field = key.slice(dot + 1);
    if (dot > 0 && group && field in group && Number.isFinite(value)) group[field] = value;
  }
  for (const g of Object.values(out)) Object.freeze(g);
  return Object.freeze(out) as unknown as PhysicsTuning;
}

/** Floor for the reference gravity (m/s²) so zero-g levels still have usable engines. */
export const MIN_REFERENCE_GRAVITY = 1.6;

/** Reference gravity magnitude (m/s²) that thrust-to-weight ratios are measured against. */
export function referenceGravity(g: Vec2): number {
  return Math.max(MIN_REFERENCE_GRAVITY, Math.hypot(g.x, g.y));
}

/** Everything a vessel controller needs beyond the contract factory arguments. */
export interface VesselOptions {
  tuning: PhysicsTuning;
  /** m/s², see referenceGravity(). */
  refGravity: number;
  /** Harpoon guns on the pod (harpoon modes). */
  harpoonGuns: 1 | 2;
}

export function vesselOptionsFor(spec: LevelSpec, tuning = resolveTuning(spec.physicsOverrides)): VesselOptions {
  return { tuning, refGravity: referenceGravity(spec.gravity), harpoonGuns: spec.harpoonGuns ?? 1 };
}

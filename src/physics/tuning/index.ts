/**
 * Physics tuning registry. One constants module per vessel mode plus the
 * environment module; LevelSpec.physicsOverrides patches them per level with
 * flat `<group>.<field>` keys (e.g. `'csm.thrust'`, `'goo.burnSec'`).
 *
 * PHYSICS_OVERRIDE_KEYS is the registered key list and FIELD_RANGES the
 * allowed values: the level validator flags unknown keys, out-of-range values
 * and inconsistent pairs; resolveTuning() ignores unknown / out-of-range ones.
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

/** Allowed range of a tuning field: `min`/`max` inclusive, `above` exclusive lower bound, `int` = whole numbers only. */
export interface TuningRange {
  min?: number;
  above?: number;
  max?: number;
  int?: boolean;
}

const POSITIVE: TuningRange = { above: 0 };
const NON_NEGATIVE: TuningRange = { min: 0 };
const UNIT: TuningRange = { min: 0, max: 1 };
const COUNT: TuningRange = { min: 0, int: true };

/**
 * Per-field ranges (field names are shared across groups). EVERY tuning field
 * must be listed — a module-load check throws otherwise. Dimensions that
 * become physics shapes are strictly positive; counts are whole numbers.
 */
const FIELD_RANGES: Readonly<Record<string, TuningRange>> = {
  // sizes (px) and mass
  width: POSITIVE,
  height: POSITIVE,
  legSpan: POSITIVE,
  legDrop: POSITIVE,
  radius: POSITIVE,
  orbRadius: POSITIVE,
  fuelRadius: POSITIVE,
  zoneHeight: POSITIVE,
  density: POSITIVE,
  // engines / rates
  thrust: POSITIVE,
  topThrust: POSITIVE,
  rotateAccel: POSITIVE,
  burnSeconds: POSITIVE,
  headSpeed: POSITIVE,
  reelInSpeed: POSITIVE,
  reelOutSpeed: POSITIVE,
  ropeRange: POSITIVE,
  ropeMin: POSITIVE,
  ropeBreakAccel: POSITIVE,
  // S10 brake assist: max multiplier (1 = off, capped so a retro-burn stays a skill) and full-boost speed (px/s)
  brakeBoost: { min: 1, max: 3 },
  brakeBoostRef: POSITIVE,
  // hull / landing
  crashSpeed: POSITIVE,
  landSpeed: POSITIVE,
  landSpin: POSITIVE,
  landAngle: { above: 0, max: Math.PI },
  hitDamage: UNIT,
  attachDamage: UNIT,
  restitution: UNIT,
  exhaustLength: POSITIVE,
  exhaustHalfAngle: { above: 0, max: Math.PI / 2 },
  // environment
  burnSec: POSITIVE,
  lifetimeSec: POSITIVE,
  refSpeed: POSITIVE,
  maxAlive: COUNT,
  maxAttached: COUNT,
  // non-negative: damping, offsets, grace times, multipliers, thresholds
  angularDamping: NON_NEGATIVE,
  linearDamping: NON_NEGATIVE,
  friction: NON_NEGATIVE,
  damageSpeed: NON_NEGATIVE,
  landSettleSec: NON_NEGATIVE,
  engineOffset: NON_NEGATIVE,
  topOffset: NON_NEGATIVE,
  mountHeight: NON_NEGATIVE,
  attachedDrag: NON_NEGATIVE,
  burnGraceSec: NON_NEGATIVE,
  weldHertz: NON_NEGATIVE,
  weldDamping: NON_NEGATIVE,
  burningMultiplier: NON_NEGATIVE,
  minDamageSpeed: NON_NEGATIVE,
  zoneBelow: NON_NEGATIVE,
  eventThreshold: NON_NEGATIVE,
};

/** Range of a registered `group.field` key (undefined for unknown keys). */
export function tuningRange(key: string): TuningRange | undefined {
  if (!PHYSICS_OVERRIDE_KEYS.includes(key)) return undefined;
  return FIELD_RANGES[key.slice(key.indexOf('.') + 1)];
}

/** Why `value` is not acceptable for registered override `key` (null = ok, or key unknown). */
export function overrideRangeError(key: string, value: number): string | null {
  const r = tuningRange(key);
  if (!r) return null;
  if (!Number.isFinite(value)) return 'must be a finite number';
  if (r.above !== undefined && !(value > r.above)) return `must be > ${r.above}`;
  if (r.min !== undefined && value < r.min) return `must be >= ${r.min}`;
  if (r.max !== undefined && value > r.max) return `must be <= ${+r.max.toFixed(4)}`;
  if (r.int && !Number.isInteger(value)) return 'must be a whole number';
  return null;
}

/** Cross-field consistency of a resolved tuning (e.g. damageSpeed < crashSpeed). */
export function tuningConsistencyErrors(t: PhysicsTuning): string[] {
  const out: string[] = [];
  for (const g of ['csm', 'lander', 'harpoon', 'harpoonThrust'] as const) {
    if (!(t[g].damageSpeed < t[g].crashSpeed)) out.push(`${g}.damageSpeed must be < ${g}.crashSpeed`);
  }
  for (const g of ['harpoon', 'harpoonThrust'] as const) {
    if (!(t[g].ropeMin < t[g].ropeRange)) out.push(`${g}.ropeMin must be < ${g}.ropeRange`);
  }
  return out;
}

/** Defaults patched with `overrides` (unknown keys and out-of-range values ignored). Returns fresh frozen objects. */
export function resolveTuning(overrides?: Readonly<Record<string, number>>): PhysicsTuning {
  const out: Record<string, Record<string, number>> = {};
  for (const [group, values] of Object.entries(DEFAULTS)) out[group] = { ...values };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    const dot = key.indexOf('.');
    const group = out[key.slice(0, dot)];
    const field = key.slice(dot + 1);
    if (dot > 0 && group && field in group && overrideRangeError(key, value) === null) group[field] = value;
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

// Every registered tuning field needs an explicit range.
for (const key of PHYSICS_OVERRIDE_KEYS) {
  if (!FIELD_RANGES[key.slice(key.indexOf('.') + 1)]) throw new Error(`tuning field '${key}' has no range in FIELD_RANGES (src/physics/tuning/index.ts)`);
}

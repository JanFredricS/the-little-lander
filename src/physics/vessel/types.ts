/**
 * The S1 extension of the frozen VesselController: what the environment
 * systems (goo, wind, radiation, pickups, beacons, zones) and the session
 * need from a vessel beyond the contract.
 */

import type { BodyHandle, CrashCause, FuelChangeReason, HullChangeReason, Vec2, VesselController, VesselSpawn, VesselState } from '../../contracts';
import type { Cone } from '../geom';

/** Render-facing geometry (px, body-local, y-down, centred on the body origin). */
export interface VesselGeometry {
  /** Hull bounding size (px). */
  w: number;
  h: number;
  /** Solid boxes (centre + size, px). */
  boxes: readonly { x: number; y: number; w: number; h: number }[];
  /**
   * Nozzles (px): which engine flag drives each. Bottom nozzles exhaust along
   * body-down; `top` nozzles (S9 lander top thrusters) exhaust along body-up.
   */
  nozzles: readonly { x: number; y: number; engine: EngineName; top?: boolean }[];
  /** Rope gun mount (px) for harpoon modes. */
  mount?: Vec2;
}

/** Hooks the environment installs on a vessel (world px). Defaults are neutral. */
export interface VesselHooks {
  /** Beacon-site / exit-dock id whose landing zone contains `pos` (for softLand.siteId). */
  siteAt(pos: Vec2): string | undefined;
  /** Can a harpoon anchor to `body` at `point`? `brittleSec` when the anchor is brittle. */
  anchorAt(body: BodyHandle, point: Vec2): { ok: boolean; brittleSec?: number };
  /** Effective gravity (m/s²) at `pos` (zones, ramp); default = world gravity. */
  gravityAt?(pos: Vec2): Vec2;
}

export interface FlightVessel extends VesselController {
  readonly geometry: VesselGeometry;
  /** Hull body + everything welded to it (attached goo). */
  readonly parts: ReadonlySet<BodyHandle>;
  hooks: VesselHooks;
  addPart(h: BodyHandle): void;
  removePart(h: BodyHandle): void;
  /** Adjust hull linear damping (goo drag) by `delta` (1/s). */
  addDrag(delta: number): void;
  /** Sum of the parts' masses (kg). */
  totalMass(): number;
  /** Refill (+) or drain (-) fuel, emitting fuelChanged. */
  addFuel(delta: number, reason: FuelChangeReason): void;
  /** Hull damage (0..1 fraction), emitting hullChanged; 0 hull = crash('hullDestroyed'). */
  damage(amount: number, reason: HullChangeReason): void;
  crash(cause: CrashCause, speedPx?: number): void;
  setAttachedGoo(n: number): void;
  /** Lit engines this tick INCLUDING the S9 top thrusters (VesselState.engines keeps the frozen main/left/right shape). */
  engineFlags(): Readonly<EngineFlagsExt>;
  /** Exhaust cones (world px) of the engines firing this tick. */
  exhaustCones(): Cone[];
  /** Pose/velocity/fuel/hull, for re-spawning as another mode. */
  snapshot(): VesselSpawn;
}

/**
 * Every engine a vessel may light. 'main' / 'left' / 'right' are the frozen
 * VesselState.engines / `enginesChanged` flags. The S9 lander top thrusters
 * ('topLeft' / 'topRight') are NOT in VesselState.engines:
 * renderers read them from FlightVessel.engineFlags(); the enginesChanged
 * event has them as OPTIONAL fields (S9 amendment, audit cycle 1);
 * VesselState.engines stays exactly main/left/right. Readers go through
 * engineOn(), so contract consumers that only know main/left/right are
 * unaffected.
 */
export type EngineName = 'main' | 'left' | 'right' | 'topLeft' | 'topRight';

/** VesselState.engines / enginesChanged payload including the S9 top-thruster flags. */
export type EngineFlagsExt = VesselState['engines'] & { topLeft: boolean; topRight: boolean };

/** Is `engine` lit in these flags (tolerates the frozen main/left/right-only shape: top = false)? */
export function engineOn(flags: VesselState['engines'], engine: EngineName): boolean {
  return (flags as Partial<Record<EngineName, boolean>>)[engine] === true;
}

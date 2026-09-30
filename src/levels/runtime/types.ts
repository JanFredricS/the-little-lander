/** What the level-entity runtime needs from the session that hosts it. */

import type { CrashCause, LevelSpec, PhysicsApi, Vec2, VesselMode, VesselState } from '../../contracts';
import type { BeaconSite } from '../../physics/env/beacons';
import type { TriggerContext } from '../../physics/env/triggers';

export interface RuntimeHost {
  readonly physics: PhysicsApi;
  readonly spec: LevelSpec;
  /** Trigger context (sim time, completed objectives) for a vessel position. */
  triggerContext(vesselPos: Vec2): TriggerContext;
  /** Switch the vessel mode at the start of the next step (scripted events). */
  requestModeSwitch(mode: VesselMode): void;
  /** Crash the vessel (crushed by a door ...). */
  crashVessel(cause: CrashCause): void;
  /**
   * The flight environment's beacon sites (optional). Sites standing on a
   * moving island get a per-session copy of their entity that the runtime
   * moves with the island, so the zone check and the marker follow it.
   */
  readonly beaconSites?: BeaconSite[];
}

/**
 * One system of level entities the S1 flight environment leaves unhandled.
 * Called once per fixed step around the physics step (see LevelRuntime).
 */
export interface EntitySystem {
  /** Before physics.step(): drive kinematic bodies. */
  beforeStep?(s: VesselState, t: number): void;
  /** After physics.step() and the vessel/environment updates. */
  afterStep?(s: VesselState, t: number): void;
  destroy?(): void;
}

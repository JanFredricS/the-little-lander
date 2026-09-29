/**
 * Level-owned gameplay systems (S7): entities / zones the S1 flight
 * environment leaves unhandled — loose ceiling rocks, crumbling platforms,
 * the collapse kill-front and the Keeper boss. They live in src/levels (not
 * src/physics) and plug into LevelSession through one small hook
 * (src/game/session.ts: createLevelSystems + beforeStep/afterStep +
 * objectiveDone), so the physics internals stay untouched.
 *
 * Step order inside LevelSession.step():
 *   env.beforeStep(); systems.beforeStep()   // forces for this step
 *   vessel.applyInput(); physics.step(); vessel.state()
 *   env.afterStep();  systems.afterStep()    // breakage, hits, kill checks
 *
 * NOTE(S8): S6 may add its own hook for its entities (moving islands, blast
 * doors, vines ...). Both should converge on one LevelSystem registry.
 */

import type { GameEvent, LevelSpec, ObjectiveSpec, VesselState } from '../../contracts';
import type { FlightPhysics } from '../../physics/contactData';
import type { FlightEnvironment } from '../../physics/env/environment';
import type { FlightVessel } from '../../physics/vessel';
import type { BuiltLevel } from '../build';

/** What a level system may see / do. Everything in world px unless stated. */
export interface LevelSystemHost {
  readonly spec: LevelSpec;
  readonly physics: FlightPhysics;
  readonly built: BuiltLevel;
  readonly env: FlightEnvironment;
  /** The CURRENT vessel (replaced on mode switches). */
  readonly vessel: FlightVessel;
  /** Latest vessel snapshot (after the previous step until afterStep refreshes). */
  readonly state: VesselState;
  readonly simTime: number;
  emit(e: GameEvent): void;
}

export interface LevelSystem {
  /** After env.beforeStep(), before the vessel's input + physics.step(). */
  beforeStep?(): void;
  /** After physics.step(), vessel.state() and env.afterStep(). */
  afterStep?(): void;
  /** true once this system considers the objective complete (surviveBoss). */
  objectiveDone?(o: ObjectiveSpec): boolean;
  destroy?(): void;
}

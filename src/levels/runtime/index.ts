/**
 * LevelRuntime: the level-owned entity systems the S1 flight environment
 * leaves unhandled — blast doors, moving islands, vines, creatures (incl.
 * the Map 3 dragon-bird sequence). The session (src/game/session.ts) creates
 * one per play-through and calls it around each physics step:
 *
 *   env.beforeStep(); runtime.beforeStep(state)   // kinematic doors/islands
 *   vessel.applyInput(); physics.step(); vessel.state(); env.afterStep()
 *   runtime.afterStep(state)                       // crush checks, creatures
 *
 * Maps 5-8 (S7) can add systems the same way: implement EntitySystem and
 * append it in the constructor.
 */

import type { VesselState } from '../../contracts';
import { CreatureSystem } from './creatures';
import { DoorSystem } from './doors';
import { IslandSystem } from './islands';
import type { EntitySystem, RuntimeHost } from './types';
import { VineSystem } from './vines';

export type { RuntimeHost, EntitySystem } from './types';

/** Entity kinds the runtime simulates. */
export const RUNTIME_ENTITY_KINDS = ['blastDoor', 'movingIsland', 'vine', 'creature'] as const;

export class LevelRuntime {
  readonly doors: DoorSystem;
  readonly islands: IslandSystem;
  readonly vines: VineSystem;
  readonly creatures: CreatureSystem;
  private readonly systems: EntitySystem[];

  constructor(private readonly host: RuntimeHost) {
    this.doors = new DoorSystem(host);
    this.islands = new IslandSystem(host);
    this.vines = new VineSystem(host);
    this.creatures = new CreatureSystem(host);
    this.systems = [this.doors, this.islands, this.vines, this.creatures];
  }

  beforeStep(s: VesselState): void {
    const t = this.host.physics.simTime;
    for (const sys of this.systems) sys.beforeStep?.(s, t);
  }

  afterStep(s: VesselState): void {
    const t = this.host.physics.simTime;
    for (const sys of this.systems) sys.afterStep?.(s, t);
  }

  destroy(): void {
    for (const sys of this.systems) sys.destroy?.();
  }
}

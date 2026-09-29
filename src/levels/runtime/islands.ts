/**
 * Moving islands (MovingIslandEntity): a kinematic body carrying the outline
 * as a closed terrain chain, driven along its path (see islandOffset: 'loop'
 * = constant speed, 'pingpong' = eased sway). The body is tagged 'terrain'
 * so it behaves like any other ground (landing support, harpoon anchor).
 *
 * Landing fairness: soft-landing measures the vessel's absolute speed
 * (VesselState.vel), so an island meant for beacon planting must move slower
 * than the vessel's landSpeed (islandPeakSpeed() — enforced by map tests).
 */

import type { BodyHandle, MovingIslandEntity, Vec2 } from '../../contracts';
import { FIXED_DT } from '../../contracts';
import { pxToM } from '../../physics/units';
import { islandOffset } from './paths';
import type { EntitySystem, RuntimeHost } from './types';

export interface IslandState {
  entity: MovingIslandEntity;
  body: BodyHandle;
  /** Island origin (px) now / previous step. */
  pos: Vec2;
  prevPos: Vec2;
}

export class IslandSystem implements EntitySystem {
  readonly islands: IslandState[];

  constructor(private readonly host: RuntimeHost) {
    const p = host.physics;
    this.islands = host.spec.entities
      .filter((e): e is MovingIslandEntity => e.kind === 'movingIsland')
      .map((entity) => {
        const off = islandOffset(entity.path, entity.periodSec, entity.motion, 0);
        const pos = { x: entity.x + off.x, y: entity.y + off.y };
        const body = p.createBody({ type: 'kinematic', position: { x: pxToM(pos.x), y: pxToM(pos.y) }, tag: 'terrain' });
        p.addChain(
          body,
          entity.outline.map((q) => ({ x: pxToM(q.x), y: pxToM(q.y) })),
          true,
          { friction: 0.9, restitution: 0.05 },
        );
        return { entity, body, pos, prevPos: pos };
      });
  }

  beforeStep(_s: unknown, t: number): void {
    const p = this.host.physics;
    for (const isl of this.islands) {
      const e = isl.entity;
      const off = islandOffset(e.path, e.periodSec, e.motion, t + FIXED_DT);
      const next = { x: e.x + off.x, y: e.y + off.y };
      p.setLinearVelocity(isl.body, { x: pxToM(next.x - isl.pos.x) / FIXED_DT, y: pxToM(next.y - isl.pos.y) / FIXED_DT });
      isl.prevPos = isl.pos;
      isl.pos = next;
    }
  }
}

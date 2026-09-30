/**
 * Moving islands (MovingIslandEntity): a kinematic body carrying the outline
 * as a closed terrain chain, driven along its path (see islandOffset: 'loop'
 * = constant speed, 'pingpong' = eased sway). The body is tagged 'terrain'
 * so it behaves like any other ground (landing support, harpoon anchor).
 *
 * Landing fairness: soft-landing measures the vessel's absolute speed
 * (VesselState.vel), so an island meant for beacon planting must move slower
 * than the vessel's landSpeed (islandPeakSpeed() — enforced by map tests).
 *
 * Riding beacon sites: a beaconSite whose (x, y) lies on an island's top
 * surface at the island's REST pose (path offset {0, 0}) rides that island.
 * The runtime swaps the environment's site entity for a per-session copy
 * (the LevelSpec itself is never mutated) and moves it with the island each
 * step, so the plant zone (BeaconSystem.inZone), softLand.siteId and the
 * marker (drawn from site.entity) all stay on the pad.
 */

import type { BeaconSiteEntity, BodyHandle, MovingIslandEntity, Vec2 } from '../../contracts';
import type { BeaconSite } from '../../physics/env/beacons';
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
  /** Beacon sites riding this island, with their rest-pose offset from the island origin. */
  riders: { site: BeaconSite; local: Vec2 }[];
}

/** Top surface y of a closed outline at local x (NaN when x misses it). */
function outlineTopAt(outline: readonly Vec2[], x: number): number {
  let top = NaN;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!;
    const b = outline[(i + 1) % outline.length]!;
    if ((a.x <= x && b.x > x) || (b.x <= x && a.x > x)) {
      const y = a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
      if (!(y >= top)) top = y;
    }
  }
  return top;
}

/** Does beacon site `e` stand on `island`'s top surface at its rest pose? */
export function siteRidesIsland(e: BeaconSiteEntity, island: MovingIslandEntity): boolean {
  const top = outlineTopAt(island.outline, e.x - island.x);
  return Number.isFinite(top) && Math.abs(island.y + top - e.y) <= 12;
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
        const riders = (host.beaconSites ?? [])
          .filter((site) => siteRidesIsland(site.entity, entity))
          .map((site) => {
            const local = { x: site.entity.x - entity.x, y: site.entity.y - entity.y };
            site.entity = { ...site.entity, x: pos.x + local.x, y: pos.y + local.y };
            return { site, local };
          });
        return { entity, body, pos, prevPos: pos, riders };
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
      // `next` is the pose after this step: the beacon check runs after it
      for (const r of isl.riders) r.site.entity = { ...r.site.entity, x: next.x + r.local.x, y: next.y + r.local.y };
    }
  }
}

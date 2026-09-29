/**
 * Spawn a LevelSpec's static world into a PhysicsApi: terrain pieces and
 * static/dynamic props. (Gameplay entities — spawners, orbs, beacons, zones —
 * are interpreted by the physics/gameplay slice; S0 only builds what the
 * debug level needs and reports the rest as unhandled.)
 */

import type { BodyHandle, EntitySpec, LevelSpec, PhysicsApi, StaticPropEntity, TerrainPiece } from '../contracts';
import { pxToM } from '../physics/units';

export interface BuiltLevel {
  /** One static body holding every anchorable terrain chain. */
  terrain: BodyHandle;
  /**
   * Static bodies harpoons cannot anchor to (terrain pieces with
   * `anchorable: false` live on their own body, also tagged 'terrain').
   */
  nonAnchorable: ReadonlySet<BodyHandle>;
  /** Prop entity id -> body. */
  props: Map<string, { entity: StaticPropEntity; body: BodyHandle }>;
  /**
   * Entities buildLevel does not spawn. The flight environment
   * (src/physics/env/environment.ts) simulates debris/goo spawners, orbs,
   * fuel pickups and beacon sites from this list and reports the rest.
   */
  unhandled: EntitySpec[];
}

export const TAG_TERRAIN = 'terrain';
export const TAG_PROP = 'prop';

/** Physics chain points (m) for a terrain piece, honouring the ground/ceiling direction rule. */
export function terrainChain(piece: TerrainPiece): { points: { x: number; y: number }[]; loop: boolean } {
  const pts = piece.points.map((p) => ({ x: pxToM(p.x), y: pxToM(p.y) }));
  if (piece.kind === 'polygon') return { points: pts, loop: true };
  // ground: left -> right = solid below (engine rule); ceiling: reverse = solid above
  return { points: piece.kind === 'ceiling' ? pts.reverse() : pts, loop: false };
}

export function buildLevel(physics: PhysicsApi, spec: LevelSpec): BuiltLevel {
  const terrain = physics.createBody({ type: 'static', position: { x: 0, y: 0 }, tag: TAG_TERRAIN });
  let smooth: BodyHandle | null = null;
  for (const piece of spec.terrain.pieces) {
    const { points, loop } = terrainChain(piece);
    let body = terrain;
    if (piece.anchorable === false) body = smooth ??= physics.createBody({ type: 'static', position: { x: 0, y: 0 }, tag: TAG_TERRAIN });
    physics.addChain(body, points, loop, { friction: piece.friction ?? 0.8, restitution: piece.restitution ?? 0.1 });
  }
  const props = new Map<string, { entity: StaticPropEntity; body: BodyHandle }>();
  const unhandled: EntitySpec[] = [];
  for (const e of spec.entities) {
    if (e.kind === 'staticProp' && (e.solid || e.dynamic)) {
      const body = physics.createBody({
        type: e.dynamic ? 'dynamic' : 'static',
        position: { x: pxToM(e.x), y: pxToM(e.y) },
        angle: e.angle ?? 0,
        tag: TAG_PROP,
      });
      physics.addBox(body, pxToM(e.w / 2), pxToM(e.h / 2), { density: e.density ?? 1, friction: 0.6 });
      props.set(e.id, { entity: e, body });
    } else if (e.kind !== 'staticProp' && e.kind !== 'exitDock') {
      unhandled.push(e);
    }
  }
  return { terrain, nonAnchorable: new Set(smooth === null ? [] : [smooth]), props, unhandled };
}

/**
 * Spawn a LevelSpec's static world into a PhysicsApi: terrain pieces and
 * static/dynamic props. (Gameplay entities — spawners, orbs, beacons, zones —
 * are interpreted by the physics/gameplay slice; S0 only builds what the
 * debug level needs and reports the rest as unhandled.)
 */

import type { BodyHandle, EntitySpec, LevelSpec, PhysicsApi, StaticPropEntity, TerrainMaterial, TerrainPiece } from '../contracts';
import type { FlightLevelBodies } from '../physics/env/environment';
import { pxToM } from '../physics/units';

export interface BuiltLevel {
  /** One static body holding every anchorable terrain chain. */
  terrain: BodyHandle;
  /**
   * Static bodies harpoons cannot anchor to (terrain pieces with
   * `anchorable: false` live on their own body, also tagged 'terrain').
   */
  nonAnchorable: ReadonlySet<BodyHandle>;
  /**
   * Static bodies radiation shines through (terrain pieces with
   * `castsShadow: false` live on their own body, also tagged 'terrain').
   */
  shadowless: ReadonlySet<BodyHandle>;
  /**
   * Round 15: jump-through pieces (`oneWay` polygons), one static body each (tagged
   * 'terrain'); src/levels/systems/oneWay.ts enables / disables them per step.
   */
  oneWay: { piece: TerrainPiece; body: BodyHandle }[];
  /** Prop entity id -> body. */
  props: Map<string, { entity: StaticPropEntity; body: BodyHandle }>;
  /**
   * Entities buildLevel does not spawn. The flight environment
   * (src/physics/env/environment.ts) simulates debris/goo spawners, orbs,
   * fuel pickups and beacon sites from this list and reports the rest.
   */
  unhandled: EntitySpec[];
}

/** The slice of a built level the flight environment needs. */
export function flightLevelBodies(built: BuiltLevel): FlightLevelBodies {
  return {
    nonAnchorable: built.nonAnchorable,
    shadowless: built.shadowless,
    dynamicBodies: [...built.props.values()].filter((p) => p.entity.dynamic).map((p) => p.body),
  };
}

/**
 * Every terrain material the level draws (terrain pieces + styled entities: moving
 * islands, crumble platforms, ...): the art warm-up pre-generates their tiles at load,
 * not just the theme's own materials (round 13).
 */
export function levelMaterials(spec: LevelSpec): TerrainMaterial[] {
  const out = new Set<TerrainMaterial>();
  for (const p of spec.terrain.pieces) out.add(p.style.material);
  for (const e of spec.entities) {
    const style = (e as { style?: { material?: TerrainMaterial } }).style;
    if (style?.material) out.add(style.material);
  }
  return [...out];
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
  // extra static bodies keyed by (anchorable, castsShadow); the default pair is `terrain`
  const extra = new Map<string, BodyHandle>();
  const nonAnchorable = new Set<BodyHandle>();
  const shadowless = new Set<BodyHandle>();
  const oneWay: BuiltLevel['oneWay'] = [];
  for (const piece of spec.terrain.pieces) {
    const { points, loop } = terrainChain(piece);
    const anchorable = piece.anchorable !== false;
    const shadow = piece.castsShadow !== false;
    let body = terrain;
    if (piece.oneWay === true && piece.kind === 'polygon') {
      // its own body: the one-way gate switches it on / off alone
      body = physics.createBody({ type: 'static', position: { x: 0, y: 0 }, tag: TAG_TERRAIN });
      if (!anchorable) nonAnchorable.add(body);
      if (!shadow) shadowless.add(body);
      oneWay.push({ piece, body });
    } else if (!anchorable || !shadow) {
      const key = `${anchorable}:${shadow}`;
      let b = extra.get(key);
      if (b === undefined) {
        b = physics.createBody({ type: 'static', position: { x: 0, y: 0 }, tag: TAG_TERRAIN });
        extra.set(key, b);
        if (!anchorable) nonAnchorable.add(b);
        if (!shadow) shadowless.add(b);
      }
      body = b;
    }
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
  return { terrain, nonAnchorable, shadowless, oneWay, props, unhandled };
}

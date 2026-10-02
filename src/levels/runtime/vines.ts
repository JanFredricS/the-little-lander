/**
 * Hanging vines (VineEntity): `segments` light dynamic links joined by
 * revolute joints, the top link pinned to a static anchor at (x, y). They
 * sway when the vessel brushes them and push it about a little — a soft
 * obstacle, never a hull hazard (links are too light to matter to the
 * impact model). Tagged 'vine'.
 */

import type { BodyHandle, VineEntity } from '../../contracts';
import { TAG_VINE } from '../../physics/tags';
import { pxToM } from '../../physics/units';
import type { EntitySystem, RuntimeHost } from './types';

/** Link width (px) and density (kg/m²). */
const VINE_WIDTH = 4;
const VINE_DENSITY = 0.4;
/** Vines only collide with the default category (vessel + terrain), never each other. */
const VINE_CATEGORY = 0x0010;

export interface VineState {
  entity: VineEntity;
  links: BodyHandle[];
  /** Link length (px). */
  linkLen: number;
}

export class VineSystem implements EntitySystem {
  readonly vines: VineState[];

  constructor(host: RuntimeHost) {
    const p = host.physics;
    this.vines = host.spec.entities
      .filter((e): e is VineEntity => e.kind === 'vine')
      .map((entity) => {
        const n = entity.segments;
        const linkLen = entity.length / n;
        const anchor = p.createBody({ type: 'static', position: { x: pxToM(entity.x), y: pxToM(entity.y) }, tag: TAG_VINE });
        const links: BodyHandle[] = [];
        let prev = anchor;
        for (let i = 0; i < n; i++) {
          const cy = entity.y + linkLen * (i + 0.5);
          const b = p.createBody({
            type: 'dynamic',
            position: { x: pxToM(entity.x), y: pxToM(cy) },
            linearDamping: 0.6,
            angularDamping: 2,
            tag: TAG_VINE,
          });
          p.addBox(b, pxToM(VINE_WIDTH / 2), pxToM(linkLen / 2), { density: VINE_DENSITY, friction: 0.3, category: VINE_CATEGORY, mask: 0x0001 });
          p.createRevoluteJoint({ bodyA: prev, bodyB: b, anchor: { x: pxToM(entity.x), y: pxToM(entity.y + linkLen * i) } });
          links.push(b);
          prev = b;
        }
        return { entity, links, linkLen };
      });
  }

  destroy(): void {
    // bodies/joints are freed with the physics world
  }
}

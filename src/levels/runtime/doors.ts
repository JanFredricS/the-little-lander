/**
 * Blast doors (BlastDoorEntity). Each door is a kinematic w×h box that
 * parks fully retracted `h` (or `w`) px out of its slot on the `from` side —
 * design the level so that parking spot is inside solid terrain — and slides
 * into the slot over closeDurationSec once its `close` trigger fires.
 *
 * Rules (documented for level designers):
 *  - A vessel whose centre ends up inside the door box is crushed
 *    (crash 'crushed'); the kinematic door also shoves anything in its way.
 *  - Safety interlock (no soft-locks): if the door is shut while the vessel
 *    is still on the approach side, it re-opens after `REOPEN_AFTER_SEC`
 *    and then stays open for good. Being late costs time, never the run.
 *    The approach side is the side of the trigger rect (enterRegion) or of
 *    the spawn point (other triggers).
 */

import type { BlastDoorEntity, BodyHandle, Vec2, VesselState } from '../../contracts';
import { FIXED_DT } from '../../contracts';
import { triggerMet } from '../../physics/env/triggers';
import { pxToM } from '../../physics/units';
import type { EntitySystem, RuntimeHost } from './types';

/** Seconds a shut door waits with the vessel stuck on the approach side before re-opening. */
export const REOPEN_AFTER_SEC = 2.5;
/** Seconds to re-open. */
const REOPEN_SEC = 1.2;

export type DoorPhase = 'open' | 'closing' | 'closed' | 'reopening' | 'lockedOpen';

export interface DoorState {
  entity: BlastDoorEntity;
  body: BodyHandle;
  phase: DoorPhase;
  /** 0 = fully open (retracted), 1 = shut. */
  closed: number;
  /** Door box centre (px) now / at the previous step (render interpolation). */
  pos: Vec2;
  prevPos: Vec2;
  /** Seconds the vessel has been stuck behind the shut door. */
  stuck: number;
}

/** Door box centre (px) at closure fraction c (0 open .. 1 shut). */
export function doorCentre(e: BlastDoorEntity, c: number): Vec2 {
  const k = 1 - c;
  switch (e.from) {
    case 'top':
      return { x: e.x, y: e.y - e.h * k };
    case 'bottom':
      return { x: e.x, y: e.y + e.h * k };
    case 'left':
      return { x: e.x - e.w * k, y: e.y };
    case 'right':
      return { x: e.x + e.w * k, y: e.y };
  }
}

/** Open gap (px) left in the slot at closure fraction c. */
export function doorGap(e: BlastDoorEntity, c: number): number {
  return (e.from === 'top' || e.from === 'bottom' ? e.h : e.w) * (1 - c);
}

export class DoorSystem implements EntitySystem {
  readonly doors: DoorState[];
  private readonly approach: Map<string, number>;

  constructor(private readonly host: RuntimeHost) {
    const p = host.physics;
    this.approach = new Map();
    this.doors = host.spec.entities
      .filter((e): e is BlastDoorEntity => e.kind === 'blastDoor')
      .map((entity) => {
        const pos = doorCentre(entity, 0);
        const body = p.createBody({ type: 'kinematic', position: { x: pxToM(pos.x), y: pxToM(pos.y) }, tag: 'blastDoor' });
        p.addBox(body, pxToM(entity.w / 2), pxToM(entity.h / 2), { friction: 0.6 });
        const ref = entity.close.kind === 'enterRegion' ? { x: entity.close.rect.x + entity.close.rect.w / 2, y: entity.close.rect.y + entity.close.rect.h / 2 } : host.spec.spawn;
        const axisSide = entity.from === 'top' || entity.from === 'bottom' ? Math.sign(ref.x - entity.x) : Math.sign(ref.y - entity.y);
        this.approach.set(entity.id, axisSide || -1);
        return { entity, body, phase: 'open' as DoorPhase, closed: 0, pos, prevPos: pos, stuck: 0 };
      });
  }

  beforeStep(s: VesselState): void {
    const p = this.host.physics;
    const ctx = this.host.triggerContext(s.pos);
    for (const d of this.doors) {
      const e = d.entity;
      if (d.phase === 'open' && triggerMet(e.close, ctx)) d.phase = 'closing';
      let next = d.closed;
      if (d.phase === 'closing') {
        next = Math.min(1, d.closed + FIXED_DT / e.closeDurationSec);
        if (next >= 1) d.phase = 'closed';
      } else if (d.phase === 'reopening') {
        next = Math.max(0, d.closed - FIXED_DT / REOPEN_SEC);
        if (next <= 0) d.phase = 'lockedOpen';
      }
      // velocity that lands the kinematic box exactly on the next pose this step
      const target = doorCentre(e, next);
      const cur = doorCentre(e, d.closed);
      p.setLinearVelocity(d.body, { x: pxToM(target.x - cur.x) / FIXED_DT, y: pxToM(target.y - cur.y) / FIXED_DT });
      d.prevPos = d.pos;
      d.closed = next;
      d.pos = target;
    }
  }

  afterStep(s: VesselState): void {
    if (s.crashed) return;
    const p = this.host.physics;
    for (const d of this.doors) {
      const e = d.entity;
      // snap to the exact pose (kinematic integration drift)
      p.setTransform(d.body, { x: pxToM(d.pos.x), y: pxToM(d.pos.y) }, 0);
      p.setLinearVelocity(d.body, { x: 0, y: 0 });
      if (d.closed > 0 && Math.abs(s.pos.x - d.pos.x) < e.w / 2 - 1 && Math.abs(s.pos.y - d.pos.y) < e.h / 2 - 1) {
        this.host.crashVessel('crushed');
        return;
      }
      if (d.phase === 'closed') {
        const side = e.from === 'top' || e.from === 'bottom' ? Math.sign(s.pos.x - e.x) : Math.sign(s.pos.y - e.y);
        d.stuck = side === this.approach.get(e.id) ? d.stuck + FIXED_DT : 0;
        if (d.stuck >= REOPEN_AFTER_SEC) d.phase = 'reopening';
      }
    }
  }
}

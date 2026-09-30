/**
 * Closing gaps (BlastDoorEntity) for map 8 — S7's own driver.
 *
 * NOTE(S8 dedup): S6 owns blast doors (src/levels/runtime/doors.ts on the
 * s6-maps-1-4 branch, driven for every level by its LevelRuntime). This is a
 * minimal S7 copy with the SAME semantics, written concurrently so map 8's
 * closing gaps work on this branch; it only runs for levels that opt in via
 * LEVEL_SYSTEM_OPTIONS (`s7Doors: true`, madDash). When S6's runtime lands,
 * delete this file and the opt-in — otherwise every door exists twice.
 *
 * Semantics (as S6): each door is a kinematic w×h box parked fully
 * retracted h (or w) px out of its slot on the `from` side (inside solid
 * terrain), sliding into the slot over closeDurationSec once `close` fires.
 * A vessel whose centre the door box moves over is crushed (checked before
 * the physics step, and again after it). A vessel pinned against terrain
 * usually crashes first on the solver's shove (cause 'impact') — both read
 * as "squashed by the gate". Safety
 * interlock: if the door shuts with the vessel still on the approach side,
 * it re-opens after REOPEN_AFTER_SEC and stays open (being late costs time
 * — on map 8 that is time the collapse front gains — never a soft-lock).
 */

import type { BlastDoorEntity, BodyHandle, Vec2 } from '../../contracts';
import { TriggerLatch } from '../../physics/env/triggers';
import { pxToM } from '../../physics/units';
import type { LevelSystem, LevelSystemHost } from './types';

export const S7_REOPEN_AFTER_SEC = 2.5;
const REOPEN_SEC = 1.2;
const DT = 1 / 60;

export type S7DoorPhase = 'open' | 'closing' | 'closed' | 'reopening' | 'lockedOpen';

export interface S7DoorState {
  entity: BlastDoorEntity;
  body: BodyHandle;
  latch: TriggerLatch;
  phase: S7DoorPhase;
  /** 0 = open (retracted) .. 1 = shut. */
  closed: number;
  /** Door box centre (px). */
  pos: Vec2;
  /** Seconds the vessel has waited behind the shut door. */
  stuck: number;
  /** Which side of the slot the vessel approaches from (-1 / +1, across the door's travel). */
  approach: number;
}

/** Door box centre (px) at closure fraction c (0 open .. 1 shut). */
export function s7DoorCentre(e: BlastDoorEntity, c: number): Vec2 {
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
export function s7DoorGap(e: BlastDoorEntity, c: number): number {
  return (e.from === 'top' || e.from === 'bottom' ? e.h : e.w) * (1 - c);
}

/** Does the door box (centre c) cover point p (the vessel centre)? */
export function s7DoorCovers(e: BlastDoorEntity, c: Vec2, p: Vec2): boolean {
  return Math.abs(p.x - c.x) < e.w / 2 - 1 && Math.abs(p.y - c.y) < e.h / 2 - 1;
}

export class S7DoorSystem implements LevelSystem {
  readonly doors: S7DoorState[];

  constructor(private readonly host: LevelSystemHost) {
    const p = host.physics;
    this.doors = host.spec.entities
      .filter((e): e is BlastDoorEntity => e.kind === 'blastDoor')
      .map((entity) => {
        const pos = s7DoorCentre(entity, 0);
        const body = p.createBody({ type: 'kinematic', position: { x: pxToM(pos.x), y: pxToM(pos.y) }, tag: 'blastDoor' });
        p.addBox(body, pxToM(entity.w / 2), pxToM(entity.h / 2), { friction: 0.6 });
        const ref = entity.close.kind === 'enterRegion' ? { x: entity.close.rect.x + entity.close.rect.w / 2, y: entity.close.rect.y + entity.close.rect.h / 2 } : host.spec.spawn;
        const vertical = entity.from === 'top' || entity.from === 'bottom';
        const approach = Math.sign(vertical ? ref.x - entity.x : ref.y - entity.y) || -1;
        return { entity, body, latch: new TriggerLatch(entity.close), phase: 'open' as S7DoorPhase, closed: 0, pos, stuck: 0, approach };
      });
  }

  beforeStep(): void {
    const h = this.host;
    const p = h.physics;
    const ctx = h.env.triggerContext(h.state.pos);
    for (const d of this.doors) {
      const e = d.entity;
      const fired = d.latch.update(ctx);
      if (d.phase === 'open' && fired) d.phase = 'closing';
      let next = d.closed;
      if (d.phase === 'closing') {
        next = Math.min(1, d.closed + DT / e.closeDurationSec);
        if (next >= 1) d.phase = 'closed';
      } else if (d.phase === 'reopening') {
        next = Math.max(0, d.closed - DT / REOPEN_SEC);
        if (next <= 0) d.phase = 'lockedOpen';
      }
      const target = s7DoorCentre(e, next);
      const cur = s7DoorCentre(e, d.closed);
      // crush before the physics step: a door advancing over the vessel's
      // centre crushes it (otherwise the solver's shove reads as an impact)
      if (next > 0 && !h.state.crashed && s7DoorCovers(e, target, h.state.pos)) {
        h.vessel.crash('crushed', Math.hypot(h.state.vel.x, h.state.vel.y));
      }
      p.setLinearVelocity(d.body, { x: pxToM(target.x - cur.x) / DT, y: pxToM(target.y - cur.y) / DT });
      d.closed = next;
      d.pos = target;
    }
  }

  afterStep(): void {
    const h = this.host;
    const p = h.physics;
    const s = h.vessel.state();
    for (const d of this.doors) {
      const e = d.entity;
      p.setTransform(d.body, { x: pxToM(d.pos.x), y: pxToM(d.pos.y) }, 0);
      p.setLinearVelocity(d.body, { x: 0, y: 0 });
      if (s.crashed) continue;
      if (d.closed > 0 && s7DoorCovers(e, d.pos, s.pos)) {
        h.vessel.crash('crushed', Math.hypot(s.vel.x, s.vel.y));
        return;
      }
      if (d.phase === 'closed') {
        const vertical = e.from === 'top' || e.from === 'bottom';
        const side = Math.sign(vertical ? s.pos.x - e.x : s.pos.y - e.y);
        d.stuck = side === d.approach ? d.stuck + DT : 0;
        if (d.stuck >= S7_REOPEN_AFTER_SEC) d.phase = 'reopening';
      }
    }
  }

  destroy(): void {
    const p = this.host.physics;
    for (const d of this.doors) if (p.hasBody(d.body)) p.destroyBody(d.body);
  }
}

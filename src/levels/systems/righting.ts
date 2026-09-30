/**
 * Self-righting assist (S7) for the harpoonThrust pod on maps 6-7.
 *
 * Playtest finding: a harpoonThrust pod knocked onto its side on a flat floor
 * can never get up again — its reaction wheel (rotateAccel 6 rad/s²) cannot
 * lift its own weight over a corner, its main engine then points sideways
 * and only slides it, and in the Keeper's arena (roof 1,100 px up) no
 * anchor is in rope range. That is a soft-lock.
 *
 * Fix, levels-owned (the physics internals stay untouched): while the pod
 * rests on something, tilted more than ~30°, nearly still, and the player
 * holds rotate towards upright, give it a "leg kick" torque big enough to
 * tip it over the corner. It does nothing in flight.
 *
 * NOTE(S8): proposed as a vessel feature (harpoonThrust.groundRightTorque)
 * in src/physics/vessel/harpoon.ts; this system should go once that lands.
 */

import type { InputFrame } from '../../contracts';
import { resolveTuning } from '../../physics/tuning';
import { pxToM } from '../../physics/units';
import type { LevelSystem, LevelSystemHost } from './types';

export interface RightingOptions {
  /** Kick torque as a multiple of weight × half-height. */
  kick?: number;
  /** Tilt (rad) above which the assist engages (below it the pod is past its corner: gravity finishes the roll). */
  minTilt?: number;
  /** Max speed (px/s) for "resting". */
  maxSpeed?: number;
}

export class RightingSystem implements LevelSystem {
  private readonly kick: number;
  private readonly minTilt: number;
  private readonly maxSpeed: number;
  private readonly halfH: number;
  private readonly maxSpin = 2.2;
  /** Steps the assist has been active in a row (exposed for tests). */
  active = 0;

  constructor(private readonly host: LevelSystemHost, o: RightingOptions = {}) {
    this.kick = o.kick ?? 2.2;
    this.minTilt = o.minTilt ?? 0.8;
    this.maxSpeed = o.maxSpeed ?? 40;
    this.halfH = pxToM(resolveTuning(host.spec.physicsOverrides).harpoonThrust.height / 2);
  }

  beforeStep(frame?: InputFrame): void {
    const h = this.host;
    const v = h.vessel;
    if (!frame || v.mode !== 'harpoonThrust') return void (this.active = 0);
    const st = h.state;
    if (st.crashed) return void (this.active = 0);
    const p = h.physics;
    const g = v.hooks.gravityAt?.(st.pos) ?? p.getGravity();
    // tilt from "up" = against the local gravity (the Hollow's up-zones flip it)
    const up = Math.atan2(-g.x, g.y);
    const tilt = Math.atan2(Math.sin(st.angle - up), Math.cos(st.angle - up));
    const rot = (frame.rotateCW ? 1 : 0) - (frame.rotateCCW ? 1 : 0);
    const towardsUpright = rot !== 0 && Math.sign(rot) === -Math.sign(tilt);
    const resting = Math.hypot(st.vel.x, st.vel.y) < this.maxSpeed && p.bodyContacts(v.body).length > 0;
    if (!towardsUpright || !resting || Math.abs(tilt) < this.minTilt) return void (this.active = 0);
    const weight = p.getMass(v.body) * Math.hypot(g.x, g.y);
    // a firm push, not a spin: no kick once it is rolling fast enough
    if (p.getAngularVelocity(v.body) * rot > this.maxSpin) return void (this.active = 0);
    p.applyTorque(v.body, rot * this.kick * weight * this.halfH);
    this.active++;
  }
}

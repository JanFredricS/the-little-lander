/**
 * Self-righting assist (S7) for the harpoonThrust pod (maps 6-7) and, since
 * the Descent grounded soft-lock report (round 3), the CSM and the lander.
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
 * The CSM (Descent, round 3): at the bottom of Descent (1.2 g) a CSM that
 * settles on its side or nose-down is the same soft-lock - rotateAccel
 * (7 rad/s²) cannot lift its 44 px hull over a corner, and its thrust only
 * slides it along the floor or pushes it into the ground. Same kick, scaled
 * by the CSM's own half-height. Above ~150° from upright (nose-down) either
 * rotate key counts as "towards upright" (CSM / lander only: the harpoon pod
 * keeps its original rule). Thrust lifts a CSM tilted less
 * than ~60° (T/W 2 at the bottom), so the kick (from ~46°) closes the gap.
 * The lander has the same lock on its side: one main engine + the opposite
 * top thruster give ~9 weight·px of torque against the ~16 weight·px needed
 * to lift it over a foot. It has no rotate control, so its turn intent is
 * the net engine torque of the frame (engineLeft / topRight = clockwise,
 * engineRight / topLeft = counter-clockwise; `thrust` / both of a pair
 * cancel) - one engine in the ENGINE scheme. Under DIRECT steering the layer
 * reports the player's own intent in InputFrame.turnIntent (the held rotate
 * key, or the finger's angle hold) and that is read instead, so the layer's
 * synthetic release brake never counts as a command. A lander with no fuel
 * (its engines cannot fire) gets no kick.
 * It acts only while the player commands a turn towards upright: no input,
 * no power, never an auto-upright.
 *
 * "Resting" (audit round 3): a contact whose normal is within ~60° of the
 * local gravity (ground below - never a wall or the ceiling) and a speed
 * under maxSpeed RELATIVE to that contact body (a moving island counts).
 * The ground-normal requirement is CSM / lander only: the harpoon pod keeps
 * its S7 "any contact" rule (the Hollow's flipped-gravity playtest is tuned
 * on it - with the normal check the careful run takes 6 radiation hits).
 *
 * NOTE(S8): proposed as a vessel feature (harpoonThrust.groundRightTorque)
 * in src/physics/vessel/harpoon.ts; this system should go once that lands.
 */

import type { InputFrame, Vec2, VesselMode } from '../../contracts';
import { resolveTuning } from '../../physics/tuning';
import { mToPx, pxToM } from '../../physics/units';
import type { LevelSystem, LevelSystemHost } from './types';

/** Tilt (rad) beyond which the vessel counts as nose-down: rotating either way is "towards upright". */
const INVERTED_TILT = 2.6;
/** A supporting contact's normal (vessel -> other) must be within ~60° of local gravity. */
const GROUND_NORMAL_COS = 0.5;

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
  /** Half-height (m) per mode it serves: the lever the kick torque is scaled by. */
  private readonly halfH: Partial<Record<VesselMode, number>>;
  private readonly maxSpin = 2.2;
  /** Steps the assist has been active in a row (exposed for tests). */
  active = 0;

  constructor(private readonly host: LevelSystemHost, o: RightingOptions = {}) {
    this.kick = o.kick ?? 2.2;
    this.minTilt = o.minTilt ?? 0.8;
    this.maxSpeed = o.maxSpeed ?? 40;
    const t = resolveTuning(host.spec.physicsOverrides);
    this.halfH = {
      harpoonThrust: pxToM(t.harpoonThrust.height / 2),
      csm: pxToM(t.csm.height / 2),
      lander: pxToM(t.lander.height / 2 + t.lander.legDrop),
    };
  }

  beforeStep(frame?: InputFrame): void {
    const h = this.host;
    const v = h.vessel;
    const halfH = this.halfH[v.mode];
    if (!frame || halfH === undefined) return void (this.active = 0);
    const st = h.state;
    if (st.crashed) return void (this.active = 0);
    const p = h.physics;
    const g = v.hooks.gravityAt?.(st.pos) ?? p.getGravity();
    // tilt from "up" = against the local gravity (the Hollow's up-zones flip it)
    const up = Math.atan2(-g.x, g.y);
    const tilt = Math.atan2(Math.sin(st.angle - up), Math.cos(st.angle - up));
    if (v.mode === 'lander' && !(st.fuel > 0)) return void (this.active = 0); // dry: its engines cannot turn it
    const rot = v.mode === 'lander' ? (frame.turnIntent ?? landerTurn(frame)) : (frame.rotateCW ? 1 : 0) - (frame.rotateCCW ? 1 : 0);
    const eitherWay = v.mode !== 'harpoonThrust' && Math.abs(tilt) > INVERTED_TILT;
    const towardsUpright = rot !== 0 && (eitherWay || Math.sign(rot) === -Math.sign(tilt));
    if (!towardsUpright || Math.abs(tilt) < this.minTilt || !this.resting(g, st.vel)) return void (this.active = 0);
    const weight = p.getMass(v.body) * Math.hypot(g.x, g.y);
    // a firm push, not a spin: no kick once it is rolling fast enough
    if (p.getAngularVelocity(v.body) * rot > this.maxSpin) return void (this.active = 0);
    p.applyTorque(v.body, rot * this.kick * weight * halfH);
    this.active++;
  }

  /** On the ground: a contact below (against local gravity `g`) and slow relative to that body. */
  private resting(g: Vec2, velPx: Vec2): boolean {
    const p = this.host.physics;
    const v = this.host.vessel;
    const gm = Math.hypot(g.x, g.y);
    const down = gm < 0.05 ? { x: 0, y: 1 } : { x: g.x / gm, y: g.y / gm };
    for (const c of p.bodyContacts(v.body)) {
      if (v.parts.has(c.other) || !p.hasBody(c.other)) continue;
      // the harpoon pod keeps its S7 rule (any contact): its tuned Hollow play leans on it
      if (v.mode !== 'harpoonThrust' && c.normal.x * down.x + c.normal.y * down.y < GROUND_NORMAL_COS) continue;
      const o = p.getLinearVelocity(c.other);
      if (Math.hypot(velPx.x - mToPx(o.x), velPx.y - mToPx(o.y)) < this.maxSpeed) return true;
    }
    return false;
  }
}

/** Lander turn intent (+1 clockwise, -1 counter-clockwise, 0 none) from its engine flags. */
function landerTurn(f: InputFrame): number {
  const left = f.engineLeft || f.thrust;
  const right = f.engineRight || f.thrust;
  return Math.sign((left ? 1 : 0) - (right ? 1 : 0) + (f.topRight ? 1 : 0) - (f.topLeft ? 1 : 0));
}

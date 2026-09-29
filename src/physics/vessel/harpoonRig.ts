/**
 * Harpoon rope guns (harpoon / harpoonThrust modes).
 *
 *  - fire (edge): the harpoon head flies from the mount along the aim
 *    direction at headSpeed; each step a ray (castSolid) is swept along its
 *    path. First solid hit: anchorable (VesselHooks.anchorAt) -> rope
 *    attached; otherwise, or past ropeRange -> harpoonMissed.
 *  - The rope is a PhysicsApi rope-style distance joint (slack below its max
 *    length, taut at it). Reel in/out moves the max length at reel speed
 *    within [ropeMin, ropeRange] — a motorised winch with unlimited torque.
 *  - release (edge): drops every rope / flying head.
 *  - With every gun busy, fire re-uses the gun fired longest ago (re-fire
 *    mid-air without a separate release).
 *  - Brittle anchors break after their timer; an over-tensioned rope snaps
 *    ('overload'); a rope whose anchor body disappears also counts as overload.
 */

import type { BodyHandle, GameEventSink, InputFrame, JointHandle, PhysicsApi, RopeGunState, RopeState, Vec2 } from '../../contracts';
import { normalize } from '../geom';
import { castSolid } from '../tags';
import type { HarpoonTuning } from '../tuning';
import { mToPx, pxToM, vMToPx, vPxToM } from '../units';
import type { VesselHooks } from './types';

export type RigTuning = Pick<
  HarpoonTuning,
  'mountHeight' | 'ropeRange' | 'ropeMin' | 'reelInSpeed' | 'reelOutSpeed' | 'headSpeed' | 'ropeBreakAccel'
>;

export interface RigHost {
  readonly physics: PhysicsApi;
  readonly events: GameEventSink;
  readonly body: BodyHandle;
  readonly parts: ReadonlySet<BodyHandle>;
  readonly hooks: VesselHooks;
  /** Dry mass (kg) for the rope break force. */
  readonly dryMass: number;
}

interface Gun {
  index: number;
  phase: 'idle' | 'flying' | 'anchored';
  /** Flying: head position (m). */
  head: Vec2;
  dir: Vec2;
  travelled: number;
  joint: JointHandle | null;
  /** Rope max length (m). */
  length: number;
  brittleLeft: number | undefined;
  tension: number;
  firedSeq: number;
}

/** Tension low-pass factor per step (spikes of a single step never snap the rope). */
const TENSION_SMOOTHING = 0.25;

export class HarpoonRig {
  private readonly guns: Gun[];
  private seq = 0;
  private lastAim: Vec2 = { x: 0, y: -1 };

  constructor(
    private readonly host: RigHost,
    private readonly t: RigTuning,
    gunCount: 1 | 2,
  ) {
    this.guns = Array.from({ length: gunCount }, (_, index) => ({
      index,
      phase: 'idle',
      head: { x: 0, y: 0 },
      dir: { x: 0, y: -1 },
      travelled: 0,
      joint: null,
      length: 0,
      brittleLeft: undefined,
      tension: 0,
      firedSeq: 0,
    }));
  }

  /** Mount point (body-local px). */
  get mountLocal(): Vec2 {
    return { x: 0, y: -this.t.mountHeight };
  }

  input(frame: InputFrame, dt: number): void {
    if (frame.aim.x !== 0 || frame.aim.y !== 0) this.lastAim = normalize(frame.aim);
    if (frame.release) for (const g of this.guns) if (g.phase !== 'idle') this.free(g, 'released');
    if (frame.fire) this.fire();
    const reel = (frame.reelIn ? -this.t.reelInSpeed : 0) + (frame.reelOut ? this.t.reelOutSpeed : 0);
    if (reel !== 0) {
      for (const g of this.guns) {
        if (g.phase !== 'anchored' || g.joint === null) continue;
        const next = Math.min(pxToM(this.t.ropeRange), Math.max(pxToM(this.t.ropeMin), g.length + pxToM(reel) * dt));
        if (next !== g.length) {
          g.length = next;
          this.host.physics.setJointLength(g.joint, next);
        }
      }
    }
  }

  postStep(dt: number): void {
    const p = this.host.physics;
    for (const g of this.guns) {
      if (g.phase === 'flying') this.advance(g, dt);
      else if (g.phase === 'anchored') {
        if (g.joint === null || !p.hasJoint(g.joint)) {
          g.joint = null;
          this.snap(g, 'overload');
          continue;
        }
        const f = p.getJointForce(g.joint);
        g.tension += (Math.hypot(f.x, f.y) - g.tension) * TENSION_SMOOTHING;
        if (g.tension > this.host.dryMass * this.t.ropeBreakAccel) {
          this.snap(g, 'overload');
          continue;
        }
        if (g.brittleLeft !== undefined) {
          g.brittleLeft -= dt;
          if (g.brittleLeft <= 0) this.snap(g, 'brittle');
        }
      }
    }
  }

  ropeState(): RopeState {
    const p = this.host.physics;
    return {
      guns: this.guns.map((g): RopeGunState => {
        const s: RopeGunState = { gun: g.index, phase: g.phase, maxLength: this.t.ropeRange };
        if (g.phase === 'flying') s.head = vMToPx(g.head);
        else if (g.phase === 'anchored' && g.joint !== null && p.hasJoint(g.joint)) {
          s.head = vMToPx(p.getJointAnchors(g.joint).a);
          s.length = mToPx(g.length);
          if (g.brittleLeft !== undefined) s.brittleTimeLeft = Math.max(0, g.brittleLeft);
        }
        return s;
      }),
    };
  }

  /** Current mount point in world px (render). */
  mountWorld(): Vec2 {
    return vMToPx(this.host.physics.localToWorld(this.host.body, vPxToM(this.mountLocal)));
  }

  destroy(): void {
    for (const g of this.guns) this.dropJoint(g);
  }

  // ------------------------------------------------------------ internals

  private fire(): void {
    let g = this.guns.find((x) => x.phase === 'idle');
    if (!g) {
      g = this.guns.reduce((a, b) => (b.firedSeq < a.firedSeq ? b : a));
      this.free(g, 'released');
    }
    const dir = this.lastAim;
    g.phase = 'flying';
    g.dir = dir;
    g.head = this.host.physics.localToWorld(this.host.body, vPxToM(this.mountLocal));
    g.travelled = 0;
    g.firedSeq = ++this.seq;
    this.host.events({ type: 'harpoonFired', gun: g.index, dir: { ...dir } });
  }

  private advance(g: Gun, dt: number): void {
    const range = pxToM(this.t.ropeRange);
    const d = Math.min(pxToM(this.t.headSpeed) * dt, range - g.travelled);
    const next = { x: g.head.x + g.dir.x * d, y: g.head.y + g.dir.y * d };
    const hit = castSolid(this.host.physics, g.head, next, [...this.host.parts]);
    if (hit) {
      const info = this.host.hooks.anchorAt(hit.body, vMToPx(hit.point));
      if (info.ok) this.attach(g, hit.body, hit.point, info.brittleSec);
      else this.miss(g);
      return;
    }
    g.head = next;
    g.travelled += d;
    if (g.travelled >= range - 1e-9) this.miss(g);
  }

  private attach(g: Gun, anchorBody: BodyHandle, point: Vec2, brittleSec: number | undefined): void {
    const p = this.host.physics;
    const mount = p.localToWorld(this.host.body, vPxToM(this.mountLocal));
    const dist = Math.hypot(point.x - mount.x, point.y - mount.y);
    const length = Math.min(pxToM(this.t.ropeRange), Math.max(pxToM(this.t.ropeMin), dist));
    g.joint = p.createDistanceJoint({ bodyA: anchorBody, bodyB: this.host.body, anchorA: point, anchorB: mount, rope: true, length, maxLength: length });
    g.length = length;
    g.phase = 'anchored';
    g.tension = 0;
    g.brittleLeft = brittleSec;
    this.host.events({ type: 'ropeAttached', gun: g.index, anchor: vMToPx(point), brittle: brittleSec !== undefined });
  }

  private miss(g: Gun): void {
    g.phase = 'idle';
    this.host.events({ type: 'harpoonMissed', gun: g.index });
  }

  private snap(g: Gun, reason: 'brittle' | 'overload'): void {
    this.dropJoint(g);
    g.phase = 'idle';
    this.host.events({ type: 'ropeBroken', gun: g.index, reason });
  }

  private free(g: Gun, _why: 'released'): void {
    this.dropJoint(g);
    g.phase = 'idle';
    this.host.events({ type: 'ropeReleased', gun: g.index });
  }

  private dropJoint(g: Gun): void {
    if (g.joint !== null && this.host.physics.hasJoint(g.joint)) this.host.physics.destroyJoint(g.joint);
    g.joint = null;
    g.brittleLeft = undefined;
  }
}

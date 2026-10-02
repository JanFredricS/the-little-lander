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
  'width' | 'height' | 'mountHeight' | 'ropeRange' | 'ropeMin' | 'reelInSpeed' | 'reelOutSpeed' | 'headSpeed' | 'ropeBreakAccel'
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
  /** Winch direction the player is holding on this anchored rope (ropeReeling edges). */
  reeling: 'in' | 'out' | null;
  tension: number;
  firedSeq: number;
}

/** Tension low-pass factor per step (spikes of a single step never snap the rope). */
const TENSION_SMOOTHING = 0.25;
/** Reel-in stalls while the pod is this far (px) short of the rope length. */
const STALL_SLACK_PX = 3;
/** Reel-in stalls when rock is within this many px of the pod's leading side (towards the anchor). */
const STALL_PROBE_PX = 4;
/**
 * Round 17: ...and when rock lies within this many px along the line from a leading
 * corner to the ANCHOR itself (a rope anchored on a spire's flank pulls the pod along
 * that flank: the rock converges on the rope line from the side, where the short
 * probe above never looks). 20 px measured best on The Vaults' reel-in matrix
 * (test/vaults.test.ts): 0 crashes at dx 0 / +-45 and 1 of 378 at dx +-90; 0 px (no
 * probe) lost the tipped x 8650 pod, and 28-40 px stalled so early that the stall /
 * resume cycle pumped swings (3-23 of 378 at dx +-90).
 */
const STALL_LINE_PX = 20;
/** The rope-line probe stops this far short of the anchor (the anchor's own surface). */
const STALL_LINE_SKIP_PX = 10;

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
      reeling: null,
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
    const dir = reel < 0 ? 'in' : reel > 0 ? 'out' : null;
    for (const g of this.guns) {
      if (g.phase !== 'anchored' || g.reeling === dir) continue;
      g.reeling = dir;
      this.host.events({ type: 'ropeReeling', gun: g.index, dir });
    }
    if (reel !== 0) {
      for (const g of this.guns) {
        // the anchor body may have vanished since the last step (postStep reports the snap)
        if (g.phase !== 'anchored' || g.joint === null || !this.host.physics.hasJoint(g.joint)) continue;
        const next = Math.min(pxToM(this.t.ropeRange), Math.max(pxToM(this.t.ropeMin), g.length + pxToM(reel) * dt));
        // Winch stall (S7 fix): never reel in while the pod lags behind the rope length
        // (pinned against rock / the rope bent over a corner) — an unlimited winch would
        // crush the pod into terrain now that roped pods collide with it.
        if (next < g.length && (this.host.physics.getJointCurrentLength(g.joint) > g.length + pxToM(STALL_SLACK_PX) || this.blockedTowardAnchor(g))) continue;
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

  /**
   * S7 winch stall: rock right at the pod's side facing the anchor (the rope
   * would drag the pod into it). A rigid rope limit fighting a contact reads
   * as a fatal impact, so the winch must stop before that happens.
   */
  private blockedTowardAnchor(g: Gun): boolean {
    const p = this.host.physics;
    if (g.joint === null) return false;
    const { a, b } = p.getJointAnchors(g.joint);
    const d = normalize({ x: a.x - b.x, y: a.y - b.y });
    const c = p.localToWorld(this.host.body, { x: 0, y: 0 });
    const hw = pxToM(this.t.width / 2);
    const hh = pxToM(this.t.height / 2);
    const probe = pxToM(STALL_PROBE_PX);
    const ignore = [...this.host.parts];
    const line = pxToM(STALL_LINE_PX);
    const skip = pxToM(STALL_LINE_SKIP_PX);
    for (const [lx, ly] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh], [0, -hh]] as const) {
      const w = p.localToWorld(this.host.body, { x: lx, y: ly });
      if ((w.x - c.x) * d.x + (w.y - c.y) * d.y <= 0) continue;
      if (castSolid(p, c, { x: w.x + d.x * probe, y: w.y + d.y * probe }, ignore)) return true;
      // along the rope line: from this corner straight at the anchor
      const ta = { x: a.x - w.x, y: a.y - w.y };
      const dist = Math.hypot(ta.x, ta.y);
      const len = Math.min(line, dist - skip);
      if (len > 0 && castSolid(p, w, { x: w.x + (ta.x / dist) * len, y: w.y + (ta.y / dist) * len }, ignore)) return true;
    }
    return false;
  }

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
    // collideConnected: the anchor body is usually the level's single terrain body; without it
    // the roped pod would stop colliding with ALL terrain (fix by S7, see RESIDUALS/S7 report).
    g.joint = p.createDistanceJoint({ bodyA: anchorBody, bodyB: this.host.body, anchorA: point, anchorB: mount, rope: true, length, maxLength: length, collideConnected: true });
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
    g.reeling = null; // the rope is gone: reeling just ends (contract: no ropeReeling event)
    if (g.joint !== null && this.host.physics.hasJoint(g.joint)) this.host.physics.destroyJoint(g.joint);
    g.joint = null;
    g.brittleLeft = undefined;
  }
}

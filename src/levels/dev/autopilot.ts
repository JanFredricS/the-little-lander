/**
 * Dev autopilot: flies a LevelSession along a designer route with the SAME
 * InputFrame a player produces (no physics shortcuts), so level tests can
 * prove a map is beatable within its fuel / hull budget, and the browser
 * playtest can fly the real game (src/levels/dev/browserPilot.ts).
 *
 * Control (both modes): desired velocity toward the current route node
 * (braking profile sqrt(2·a·d), capped at the node's cruise speed) -> desired
 * acceleration -> required thrust vector (minus gravity and wind) ->
 *  - lander: tilt target + per-engine duty (sigma-delta PWM on the two
 *    independent engines; differential duty = torque),
 *  - csm: rotate the stack toward the thrust vector (bang-bang with
 *    damping), fire the main engine with PWM when aligned.
 * It is a competent pilot, not a perfect one: it pulses like a player.
 */

import { emptyFrame } from '../../shell/input';
import type { InputFrame, Vec2 } from '../../contracts';
import type { LevelSession } from '../../game/session';
import { mToPx, pxToM } from '../../physics/units';

export interface RouteNode {
  x: number;
  y: number;
  /** Arrival radius (px). Default 40. */
  tol?: number;
  /** Cruise speed cap (px/s) on the way to this node. Default 140. */
  speed?: number;
  /** Soft-land here: approach from above, descend slowly, stay landed `hold` s. */
  land?: boolean;
  /** Seconds to stay landed (land nodes) or hover (other nodes). Default 0. */
  hold?: number;
  /** Stop at this node (arrive at ~0 speed) instead of flying through. */
  stop?: boolean;
}

const G_ALIGN = 0.5; // csm: max angle error (rad) to fire the main engine
const GOO_DEFEND_RADIUS = 95; // csm: burn free goo closer than this (px)

function nearestGoo(s: LevelSession, pos: Vec2, radius: number): Vec2 | null {
  let best: Vec2 | null = null;
  let bd = radius;
  for (const b of s.env.goo.balls) {
    if (b.attached || !s.physics.hasBody(b.body)) continue;
    const p = s.physics.getTransform(b.body);
    const q = { x: mToPx(p.x), y: mToPx(p.y) };
    const d = Math.hypot(q.x - pos.x, q.y - pos.y);
    // only blobs level with / below the stack: burning one overhead would
    // mean thrusting at the ground
    if (d < bd && q.y - pos.y > -0.3 * d) {
      bd = d;
      best = q;
    }
  }
  return best;
}

export class Autopilot {
  private i = 0;
  private held = 0;
  private accL = 0;
  private accR = 0;
  private accM = 0;
  private descending = false;

  constructor(readonly route: readonly RouteNode[]) {}

  get nodeIndex(): number {
    return this.i;
  }

  get done(): boolean {
    return this.i >= this.route.length;
  }

  frame(s: LevelSession): InputFrame {
    const f: InputFrame = emptyFrame();
    const st = s.state;
    if (st.crashed) return f;
    const node = this.route[this.i];
    if (!node) return f; // route done: engines off

    const pos = st.pos;
    const vel = st.vel;
    const dx = node.x - pos.x;
    const dy = node.y - pos.y;
    const dist = Math.hypot(dx, dy);
    const tol = node.tol ?? 40;

    // ---- node bookkeeping
    if (!this.done) {
      if (node.land) {
        if (st.landed && Math.abs(dx) < Math.max(tol, 30)) {
          this.held += 1 / 60;
          if (this.held >= (node.hold ?? 0.2)) this.advance();
          return f; // engines off while landed
        }
        this.held = 0;
      } else if ((dist < tol || this.passed(node, pos, tol)) && (!node.stop || Math.hypot(vel.x, vel.y) < 30)) {
        this.held += 1 / 60;
        if (this.held >= (node.hold ?? 0)) this.advance();
      }
    }

    // ---- physics numbers (px, px/s²)
    const env = s.env;
    const g = env.gravity.effectiveAt(pos, pos);
    const gx = mToPx(g.x + env.windAccel.x);
    const gy = mToPx(g.y + env.windAccel.y);
    const gMag = Math.hypot(gx, gy);
    const t = s.tuning;
    const vessel = s.vessel;
    const body = vessel.body;
    const dryMass = s.physics.getMass(body);
    const massRatio = dryMass / Math.max(1e-6, vessel.totalMass());
    const refG = mToPx(Math.max(1.6, Math.hypot(s.spec.gravity.x, s.spec.gravity.y)));

    // ---- desired velocity / acceleration
    const cruise = node.speed ?? 140;
    const lander = st.mode === 'lander';
    const kpos = lander ? 1.0 : 2.0;
    let vdx: number;
    let vdy: number;
    if (node.land) {
      const above = node.y - 50;
      // hysteresis: start the final descent once centred (10 px), abandon
      // it only when blown well off (30 px)
      if (this.descending ? Math.abs(dx) > 30 : Math.abs(dx) > 10 || pos.y < above - 60) this.descending = false;
      else this.descending = true;
      if (!this.descending) {
        // get above the pad first
        const tx = node.x - pos.x;
        const ty = Math.min(above, pos.y) - pos.y;
        const d = Math.hypot(tx, ty);
        const sp = Math.min(cruise, Math.sqrt(2 * 60 * d) + 5, d * kpos);
        vdx = d > 1 ? (tx / d) * sp : 0;
        vdy = d > 1 ? (ty / d) * sp : 0;
        if (Math.abs(dx) <= 10) vdy = Math.min(40, Math.max(-40, (above - pos.y) * 1.5));
      } else {
        vdx = dx * kpos;
        vdy = Math.min(40, Math.max(14, (node.y - pos.y) * 0.5));
      }
    } else {
      const brake = node.stop || this.isLast() ? 70 : 140;
      const sp = Math.min(cruise, Math.sqrt(2 * brake * dist), dist * kpos);
      vdx = dist > 1 ? (dx / dist) * sp : 0;
      vdy = dist > 1 ? (dy / dist) * sp : 0;
    }
    const kv = lander ? 1.2 : 2.0;
    let ax = kv * (vdx - vel.x);
    let ay = kv * (vdy - vel.y);
    const amax = 1.1 * gMag + 60;
    const am = Math.hypot(ax, ay);
    if (am > amax) {
      ax = (ax / am) * amax;
      ay = (ay / am) * amax;
    }
    // required thrust acceleration (world px/s²)
    const Tx = ax - gx;
    const Ty = ay - gy;
    const angle = st.angle;
    const w = st.angularVel;

    if (st.mode === 'lander') {
      const lt = t.lander;
      const aEng = lt.thrust * refG * massRatio; // one engine, px/s²
      let target = Math.atan2(Tx, -Ty);
      target = clamp(target, -0.5, 0.5);
      const up = { x: Math.sin(angle), y: -Math.cos(angle) };
      const along = Tx * up.x + Ty * up.y;
      const base = clamp(along / (2 * aEng), 0, 1);
      // angular accel of one engine alone (rad/s²)
      const inertia = landerInertia(lt);
      const alphaEng = (lt.thrust * pxToM(refG) * dryMass * pxToM(lt.engineOffset)) / inertia;
      const alphaDes = 14 * (target - angle) - 7 * w;
      const diff = clamp(alphaDes / alphaEng, -1, 1);
      let dl = base + diff / 2;
      let dr = base - diff / 2;
      if (dl > 1) {
        dr -= dl - 1;
        dl = 1;
      }
      if (dr > 1) {
        dl -= dr - 1;
        dr = 1;
      }
      if (dl < 0) {
        dr = clamp(dr - dl, 0, 1);
        dl = 0;
      }
      if (dr < 0) {
        dl = clamp(dl - dr, 0, 1);
        dr = 0;
      }
      this.accL += dl;
      this.accR += dr;
      if (this.accL >= 0.5) {
        f.engineLeft = true;
        this.accL -= 1;
      }
      if (this.accR >= 0.5) {
        f.engineRight = true;
        this.accR -= 1;
      }
    } else if (st.mode === 'csm') {
      const ct = t.csm;
      // goo defence (the Map 2 skill): swing the nozzle onto the nearest
      // free blob closing in, and burn it before it latches.
      const threat = nearestGoo(s, pos, GOO_DEFEND_RADIUS);
      if (threat) {
        const gx2 = threat.x - pos.x;
        const gy2 = threat.y - pos.y;
        const target = Math.atan2(-gx2, gy2);
        const err = wrap(target - angle);
        const sw = err * 5 - w * 1.2;
        if (sw > 0.35) f.rotateCW = true;
        else if (sw < -0.35) f.rotateCCW = true;
        this.accM += Math.abs(err) < 0.35 ? 0.6 : 0;
        if (this.accM >= 0.5) {
          f.thrust = true;
          this.accM -= 1;
        }
        return f;
      }
      const aMain = ct.thrust * refG * massRatio;
      const Tm = Math.hypot(Tx, Ty);
      let target = Math.atan2(Tx, -Ty);
      if (Tm < 0.05 * aMain) target = 0;
      const err = wrap(target - angle);
      // bang-bang rotation with a damped switching line
      const sw = err * 5 - w * 1.2;
      if (sw > 0.35) f.rotateCW = true;
      else if (sw < -0.35) f.rotateCCW = true;
      const up = { x: Math.sin(angle), y: -Math.cos(angle) };
      const along = Tx * up.x + Ty * up.y;
      const duty = Math.abs(err) < G_ALIGN ? clamp(along / aMain, 0, 1) : 0;
      this.accM += duty;
      if (this.accM >= 0.5) {
        f.thrust = true;
        this.accM -= 1;
      }
    }
    return f;
  }

  /** Flew past a pass-through node (beyond it along the leg from the previous node, within 3·tol). */
  private passed(node: RouteNode, pos: Vec2, tol: number): boolean {
    const prev = this.route[this.i - 1];
    if (!prev || node.stop || node.hold) return false;
    const lx = node.x - prev.x;
    const ly = node.y - prev.y;
    return (pos.x - node.x) * lx + (pos.y - node.y) * ly > 0 && Math.hypot(pos.x - node.x, pos.y - node.y) < 3 * tol;
  }

  private isLast(): boolean {
    return this.i >= this.route.length - 1;
  }

  private advance(): void {
    this.i++;
    this.descending = false;
    this.held = 0;
  }
}

function landerInertia(lt: { width: number; height: number; legSpan: number; legDrop: number; density: number }): number {
  const footW = 4;
  const footX = lt.legSpan / 2 - footW / 2;
  const footY = lt.height / 2 + lt.legDrop / 2;
  const boxes = [
    { x: 0, y: 0, w: lt.width, h: lt.height },
    { x: -footX, y: footY, w: footW, h: lt.legDrop },
    { x: footX, y: footY, w: footW, h: lt.legDrop },
  ];
  let inertia = 0;
  for (const b of boxes) {
    const m = lt.density * pxToM(b.w) * pxToM(b.h);
    inertia += (m * (pxToM(b.w) ** 2 + pxToM(b.h) ** 2)) / 12 + m * (pxToM(b.x) ** 2 + pxToM(b.y) ** 2);
  }
  return inertia;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export interface FlightReport {
  outcome: 'complete' | 'failed' | 'timeout';
  cause?: string;
  timeSec: number;
  fuel: number;
  hull: number;
  node: number;
  pos: Vec2;
  /** Worst hull loss events (for tuning). */
  hullEvents: number;
}

/** Fly `session` along `route` until the level ends or `maxSec` passes. */
export function flyRoute(s: LevelSession, route: readonly RouteNode[], maxSec = 600, onStep?: (s: LevelSession, pilot: Autopilot) => void): FlightReport {
  const pilot = new Autopilot(route);
  let hullEvents = 0;
  const off = s.on((e) => {
    if (e.type === 'hullChanged' && e.delta < 0) hullEvents++;
  });
  const steps = Math.round(maxSec * 60);
  for (let k = 0; k < steps && !s.outcome; k++) {
    s.step(pilot.frame(s));
    onStep?.(s, pilot);
  }
  off();
  const o = s.outcome;
  return {
    outcome: o ? o.kind : 'timeout',
    cause: o && o.kind === 'failed' ? o.cause : undefined,
    timeSec: s.simTime,
    fuel: s.state.fuel,
    hull: s.state.hull,
    node: pilot.nodeIndex,
    pos: { x: Math.round(s.state.pos.x), y: Math.round(s.state.pos.y) },
    hullEvents,
  };
}

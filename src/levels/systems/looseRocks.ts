/**
 * Loose ceiling rocks (LooseRockEntity). Each rock is a dynamic circle held
 * in place by a rigid weld to the terrain body, so the weld's constraint
 * force measures everything pulling on it: |F_weld + m·g| = the rope pull
 * (a harpoon anchored to the rock). Past `breakForce` (low-passed, N) the
 * rock breaks loose: the held body is destroyed — which also drops the rope
 * joint, so the harpoon rig reports ropeBroken('overload'), i.e. "the rock
 * came away" — and a free-falling rock body replaces it. Reeling in on a
 * taut rope counts as a winch pull of winchPull x the vessel's weight (see
 * winchingOn): "harpoon a rock, reel in hard, it comes away".
 *
 * Falling rocks are solid (tag 'fallingRock'): they hurt the vessel like any
 * heavy body, and the Keeper system consumes them as boss hits. Harpoons
 * cannot anchor to falling rocks (the vessel's anchorAt hook is wrapped).
 * Rocks may regrow at their site (`respawnSec`, the boss arena).
 */

import type { BodyHandle, JointHandle, LooseRockEntity, Vec2 } from '../../contracts';
import { mToPx, pxToM, vMToPx } from '../../physics/units';
import type { VesselHooks } from '../../physics/vessel';
import type { LevelSystem, LevelSystemHost } from './types';

export const TAG_LOOSE_ROCK = 'looseRock';
export const TAG_FALLING_ROCK = 'fallingRock';

export interface LooseRockOptions {
  /** Seconds after a rock falls before it regrows at its site. Default: never. */
  respawnSec?: number;
  /** Rock density (kg/m²). */
  density?: number;
  /** Tension low-pass factor per step. */
  smoothing?: number;
  /** Falling rocks are removed this long after they come to rest (s). */
  restFadeSec?: number;
  /** ... or after this long in total (s). */
  maxFallSec?: number;
  /** Winch pull on a taut rope while reeling in, x the vessel's weight. */
  winchPull?: number;
  /** A rock torn loose snaps down at this speed (px/s, along gravity): a crisp, aimable drop. */
  snapSpeed?: number;
}

const DEFAULTS: Required<LooseRockOptions> = {
  respawnSec: Infinity,
  density: 2,
  smoothing: 0.3,
  restFadeSec: 1.5,
  maxFallSec: 12,
  winchPull: 2.6,
  snapSpeed: 0,
};

export interface HangingRock {
  entity: LooseRockEntity;
  /** null while the site is empty (fallen, waiting to regrow). */
  body: BodyHandle | null;
  weld: JointHandle | null;
  /** Smoothed pull (N). */
  pull: number;
  /** Sim time the site emptied. */
  fellAt: number;
}

export interface FallingRock {
  id: number;
  siteId: string;
  body: BodyHandle;
  /** px */
  radius: number;
  bornAt: number;
  restSec: number;
  /** Set when the rock shattered (boss hit) — removed next cleanup. */
  consumed: boolean;
}

export class LooseRockSystem implements LevelSystem {
  readonly rocks: HangingRock[];
  falling: FallingRock[] = [];
  private readonly o: Required<LooseRockOptions>;
  private nextId = 1;
  private wrapped: VesselHooks | null = null;
  private readonly lastLen: (number | undefined)[] = [];

  constructor(
    private readonly host: LevelSystemHost,
    options: LooseRockOptions = {},
  ) {
    this.o = { ...DEFAULTS, ...options };
    this.rocks = host.spec.entities
      .filter((e): e is LooseRockEntity => e.kind === 'looseRock')
      .map((entity) => ({ entity, body: null, weld: null, pull: 0, fellAt: -Infinity }));
    for (const r of this.rocks) this.hang(r);
  }

  /** Rope pull (N) currently measured on a hanging rock (tests / render). */
  pullOf(id: string): number {
    return this.rocks.find((r) => r.entity.id === id)?.pull ?? 0;
  }

  isHanging(id: string): boolean {
    return this.rocks.find((r) => r.entity.id === id)?.body != null;
  }

  beforeStep(): void {
    this.wrapAnchorHook();
    const t = this.host.simTime;
    for (const r of this.rocks) {
      if (r.body === null && t - r.fellAt >= this.o.respawnSec && this.siteClear(r)) this.hang(r);
    }
  }

  afterStep(): void {
    const p = this.host.physics;
    const g = p.getGravity();
    const winching = this.winchingOn();
    for (const r of this.rocks) {
      if (r.body === null || r.weld === null || !p.hasJoint(r.weld)) continue;
      const f = p.getJointForce(r.weld);
      const m = p.getMass(r.body);
      let pull = Math.hypot(f.x + m * g.x, f.y + m * g.y);
      if (winching !== null && winching.rock === r) pull = Math.max(pull, winching.force);
      r.pull += (pull - r.pull) * this.o.smoothing;
      if (r.pull > r.entity.breakForce) {
        const pos = vMToPx(this.host.physics.getTransform(r.body));
        const g = this.host.vessel.hooks.gravityAt?.(pos) ?? this.host.physics.getGravity();
        const gl = Math.hypot(g.x, g.y) || 1;
        this.drop(r.entity.id, { x: (g.x / gl) * this.o.snapSpeed, y: (g.y / gl) * this.o.snapSpeed });
      }
    }
    this.cleanup();
  }

  /**
   * The winch pulling on a rock: the rope is anchored on it, taut, and being
   * reeled in this step. Box2D resets a distance joint's accumulated impulse
   * when its length changes, so the measured joint force reads ~0 exactly
   * while the winch works; the winch pull is modelled instead as
   * winchPull x the vessel's weight (a hanging pod alone never breaks a rock).
   */
  private winchingOn(): { rock: HangingRock; force: number } | null {
    const h = this.host;
    const guns = h.state.ropeState?.guns ?? [];
    let out: { rock: HangingRock; force: number } | null = null;
    guns.forEach((gun, i) => {
      const prev = this.lastLen[i];
      this.lastLen[i] = gun.phase === 'anchored' ? gun.length : undefined;
      if (gun.phase !== 'anchored' || gun.head === undefined || gun.length === undefined || prev === undefined) return;
      if (prev - gun.length < 0.5) return; // not reeling in
      const rock = this.rocks.find((r) => r.body !== null && Math.hypot(gun.head!.x - r.entity.x, gun.head!.y - r.entity.y) <= r.entity.radius + 6);
      if (!rock) return;
      const mount = (h.vessel as { mountWorld?: () => Vec2 }).mountWorld?.() ?? h.state.pos;
      const dist = Math.hypot(gun.head.x - mount.x, gun.head.y - mount.y);
      if (dist < gun.length - 3) return; // slack
      const gv = h.vessel.hooks.gravityAt?.(h.state.pos) ?? h.physics.getGravity();
      out = { rock, force: this.o.winchPull * h.physics.getMass(h.vessel.body) * Math.hypot(gv.x, gv.y) };
    });
    return out;
  }

  /** Break a hanging rock loose (rope pull, boss slam). Returns false if the site is empty. */
  drop(id: string, vel: Vec2 = { x: 0, y: 0 }): boolean {
    const r = this.rocks.find((x) => x.entity.id === id);
    if (!r || r.body === null) return false;
    const p = this.host.physics;
    const tr = p.getTransform(r.body);
    p.destroyBody(r.body); // also destroys the weld and any rope anchored here
    r.body = null;
    r.weld = null;
    r.pull = 0;
    r.fellAt = this.host.simTime;
    const body = p.createBody({ type: 'dynamic', position: { x: tr.x, y: tr.y }, linearVelocity: { x: pxToM(vel.x), y: pxToM(vel.y) }, angularVelocity: 0.8, bullet: true, tag: TAG_FALLING_ROCK });
    p.addCircle(body, { x: 0, y: 0 }, pxToM(r.entity.radius), { density: this.o.density, friction: 0.6, restitution: 0.1, sensorEvents: false });
    this.falling.push({ id: this.nextId++, siteId: id, body, radius: r.entity.radius, bornAt: this.host.simTime, restSec: 0, consumed: false });
    return true;
  }

  /** Falling rock positions (px) + velocities (px/s). */
  fallingInfo(): { rock: FallingRock; pos: Vec2; vel: Vec2 }[] {
    const p = this.host.physics;
    const out: { rock: FallingRock; pos: Vec2; vel: Vec2 }[] = [];
    for (const f of this.falling) {
      if (f.consumed || !p.hasBody(f.body)) continue;
      out.push({ rock: f, pos: vMToPx(p.getTransform(f.body)), vel: vMToPx(p.getLinearVelocity(f.body)) });
    }
    return out;
  }

  /** Shatter a falling rock (it hit the boss). */
  consume(rock: FallingRock): void {
    rock.consumed = true;
    if (this.host.physics.hasBody(rock.body)) this.host.physics.destroyBody(rock.body);
  }

  destroy(): void {
    const p = this.host.physics;
    for (const f of this.falling) if (p.hasBody(f.body)) p.destroyBody(f.body);
    for (const r of this.rocks) if (r.body !== null && p.hasBody(r.body)) p.destroyBody(r.body);
    this.falling = [];
  }

  // ------------------------------------------------------------ internals

  private hang(r: HangingRock): void {
    const p = this.host.physics;
    const e = r.entity;
    const pos = { x: pxToM(e.x), y: pxToM(e.y) };
    const body = p.createBody({ type: 'dynamic', position: pos, enableSleep: false, tag: TAG_LOOSE_ROCK });
    p.addCircle(body, { x: 0, y: 0 }, pxToM(e.radius), { density: this.o.density, friction: 0.7, restitution: 0.05, sensorEvents: false });
    r.body = body;
    r.weld = p.createWeldJoint({ bodyA: this.host.built.terrain, bodyB: body, anchor: pos });
    r.pull = 0;
  }

  /** A regrowing rock must not appear inside the vessel. */
  private siteClear(r: HangingRock): boolean {
    const s = this.host.state.pos;
    return Math.hypot(s.x - r.entity.x, s.y - r.entity.y) > r.entity.radius + 30;
  }

  private cleanup(): void {
    const p = this.host.physics;
    const t = this.host.simTime;
    const W = this.host.spec.worldSize;
    this.falling = this.falling.filter((f) => {
      if (f.consumed || !p.hasBody(f.body)) return false;
      const pos = p.getTransform(f.body);
      const v = p.getLinearVelocity(f.body);
      f.restSec = mToPx(Math.hypot(v.x, v.y)) < 8 ? f.restSec + 1 / 60 : 0;
      const x = mToPx(pos.x);
      const y = mToPx(pos.y);
      const gone = f.restSec > this.o.restFadeSec || t - f.bornAt > this.o.maxFallSec || x < -100 || y < -100 || x > W.w + 100 || y > W.h + 100;
      if (gone) p.destroyBody(f.body);
      return !gone;
    });
  }

  /** Harpoons never anchor to falling rocks (re-wrapped after a mode switch installs new hooks). */
  private wrapAnchorHook(): void {
    const v = this.host.vessel;
    if (v.hooks === this.wrapped) return;
    const inner = v.hooks;
    const falling = () => this.falling;
    this.wrapped = {
      ...inner,
      anchorAt: (body, point) => (falling().some((f) => f.body === body) ? { ok: false } : inner.anchorAt(body, point)),
    };
    v.hooks = this.wrapped;
  }
}

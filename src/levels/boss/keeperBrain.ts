/**
 * The Keeper's AI (map 7 boss) — pure logic, no physics, so every rule is
 * unit-testable (test/s7.keeper.test.ts). src/levels/boss/keeperSystem.ts
 * feeds it the vessel, the exhaust cones and the falling rocks each step and
 * applies what it returns (hull damage, knockback, grab pull, slams).
 *
 *  - hp 1 -> 0. Phases by hp (keeperTuning.phaseThresholds); entering a
 *    phase emits bossPhase and pauses attacks (transition). Phase 1 is
 *    announced on the first update.
 *  - Damage: a falling rock overlapping the body while falling faster than
 *    rockMinSpeed (main damage, the rock shatters; staggers the boss), and
 *    burning off a grabbing tendril with the thruster exhaust. Every hit
 *    emits bossHit {damage actually applied, hp after, source}. hp 0 ->
 *    bossDefeated (once), then a death animation; `finished` after deathSec.
 *  - Attacks cycle through keeperTuning.pattern[phase]: sweep (telegraphed
 *    lunge through the vessel's position), grab (tendril tips home on the
 *    vessel; caught = pulled in + hull damage until burnt off or crushed),
 *    slam (rises to the roof: shakes debris loose, regrows loose rocks).
 *  - Contact with the body hurts (cooldown) and knocks the vessel away.
 */

import type { GameEventSink, Rect, Vec2 } from '../../contracts';
import { coneContains, type Cone } from '../../physics/geom';
import { KEEPER_TUNING, type KeeperAttack, type KeeperTuning } from './keeperTuning';

export type KeeperMode =
  | 'intro'
  | 'idle'
  | 'sweepWindup'
  | 'sweep'
  | 'grab'
  | 'slamWindup'
  | 'slamRecover'
  | 'stagger'
  | 'transition'
  | 'dying'
  | 'dead';

export interface Tendril {
  state: 'reaching' | 'holding' | 'retracting';
  /** Tip (px). */
  tip: Vec2;
  /** Seconds of accumulated exhaust burn. */
  burn: number;
  /** Seconds the vessel has been held. */
  held: number;
  /** Retract progress timer (s). */
  t: number;
  /** Angular offset of the tendril root on the body (rad, for render + multi-grab spread). */
  rootAngle: number;
}

export interface KeeperRockSample {
  id: number;
  pos: Vec2;
  vel: Vec2;
  radius: number;
}

export interface KeeperInput {
  dt: number;
  vessel: { pos: Vec2; vel: Vec2; crashed: boolean };
  /** Exhaust cones of the engines firing this step (world px). */
  exhaust: readonly Cone[];
  rocks: readonly KeeperRockSample[];
}

export interface KeeperOutput {
  /** Rock ids that hit the boss (shatter them). */
  rockHits: number[];
  /** Hull damage (fraction) to deal to the vessel this step. */
  vesselDamage: number;
  /** Instant velocity change for the vessel (px/s). */
  knockback: Vec2 | null;
  /** Acceleration on the vessel (m/s², mass independent) — grab pull. */
  pull: Vec2 | null;
  /** A slam landed this step: shake `debris` pieces loose, regrow rocks. */
  slam: { debris: number } | null;
  /** Ambient debris pieces to spawn this step (phase 3). */
  ambientDebris: number;
}

export class KeeperBrain {
  hp = 1;
  phase = 1;
  mode: KeeperMode = 'intro';
  /** Boss centre (px). */
  pos: Vec2;
  vel: Vec2 = { x: 0, y: 0 };
  tendrils: Tendril[] = [];
  /** Seconds in the current mode. */
  modeTime = 0;
  /** Sim seconds since the fight started. */
  time = 0;
  /** Hurt flash timer (render). */
  hurtFlash = 0;
  /** Total damage by source (accounting / tests). */
  readonly damageBy = { rock: 0, exhaust: 0 };
  private attackIndex = 0;
  private cooldown: number;
  private contactCd = 0;
  /** Sweep aim (unit): tracks the vessel during the windup, then locks (render: telegraph line). */
  sweepDir: Vec2 = { x: 1, y: 0 };
  /** true once the sweep aim is locked (last sweepLock s of the windup). */
  sweepLocked = false;
  private sweepLeft = 0;
  private announced = false;
  private defeatedEmitted = false;
  private ambientAcc = 0;

  constructor(
    readonly arena: Rect,
    spawn: Vec2,
    private readonly events: GameEventSink,
    readonly t: KeeperTuning = KEEPER_TUNING,
  ) {
    this.pos = { ...spawn };
    this.cooldown = t.attackCooldown[0]!;
  }

  get defeated(): boolean {
    return this.hp <= 0;
  }

  /** The fight is over and its death animation has played (surviveBoss). */
  get finished(): boolean {
    return this.mode === 'dead';
  }

  /** Is the vessel currently held by a tendril? */
  get grabbing(): boolean {
    return this.tendrils.some((d) => d.state === 'holding');
  }

  update(inp: KeeperInput): KeeperOutput {
    const t = this.t;
    const dt = inp.dt;
    const out: KeeperOutput = { rockHits: [], vesselDamage: 0, knockback: null, pull: null, slam: null, ambientDebris: 0 };
    if (!this.announced) {
      this.announced = true;
      this.events({ type: 'bossPhase', phase: 1, hp: this.hp });
    }
    this.time += dt;
    this.modeTime += dt;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.contactCd = Math.max(0, this.contactCd - dt);
    if (this.mode === 'dead') return out;
    if (this.mode === 'dying') {
      this.vel = { x: 0, y: 60 };
      this.pos.y = Math.min(this.arena.y + this.arena.h - t.bodyRadius, this.pos.y + this.vel.y * dt);
      if (this.modeTime >= t.deathSec) this.setMode('dead');
      return out;
    }

    // --- damage in: falling rocks
    for (const r of inp.rocks) {
      if (this.defeated) break;
      if (r.vel.y < t.rockMinSpeed) continue;
      if (Math.hypot(r.pos.x - this.pos.x, r.pos.y - this.pos.y) > t.bodyRadius + r.radius) continue;
      out.rockHits.push(r.id);
      const k = Math.min(1.4, Math.max(0.7, r.radius / t.refRockRadius));
      this.hit(t.rockDamage * k, 'rock');
      if (!this.defeated && this.mode !== 'transition') this.stagger();
    }
    if (this.defeated) {
      this.releaseAll();
      return out;
    }

    const v = inp.vessel;
    const pi = this.phase - 1;
    const inArena = !v.crashed && v.pos.x >= this.arena.x && v.pos.x <= this.arena.x + this.arena.w && v.pos.y >= this.arena.y && v.pos.y <= this.arena.y + this.arena.h;

    // --- tendrils (grab)
    this.updateTendrils(inp, out);
    if (this.defeated) return out;

    // --- behaviour
    switch (this.mode) {
      case 'intro':
        this.moveToward(this.hoverTarget(v.pos), t.followSpeed[0]!, dt);
        if (this.modeTime >= t.introSec) this.setMode('idle');
        break;
      case 'transition':
        this.moveToward({ x: this.arena.x + this.arena.w / 2, y: this.arena.y + t.hoverY - 120 }, 160, dt);
        if (this.modeTime >= t.transitionSec) this.setMode('idle');
        break;
      case 'stagger':
        this.vel = { x: this.vel.x * 0.9, y: this.vel.y * 0.9 };
        this.integrate(dt);
        if (this.modeTime >= t.staggerSec) this.setMode('idle');
        break;
      case 'idle': {
        // drift after the vessel; climb back to the hover band briskly after a low sweep
        const target = this.hoverTarget(v.pos);
        this.moveToward(target, Math.abs(target.y - this.pos.y) > 60 ? Math.max(t.returnSpeed, t.followSpeed[pi]!) : t.followSpeed[pi]!, dt);
        if (inArena) this.cooldown -= dt;
        if (this.cooldown <= 0 && inArena) this.startAttack(v.pos);
        break;
      }
      case 'sweepWindup': {
        // shiver in place, tracking the vessel — then the aim locks for the
        // last sweepLock seconds (the telegraph line the player dodges)
        this.vel = { x: 0, y: 0 };
        if (this.modeTime < t.sweepWindup[pi]! - t.sweepLock[pi]!) {
          const d = { x: v.pos.x - this.pos.x, y: v.pos.y - this.pos.y };
          const l = Math.hypot(d.x, d.y) || 1;
          this.sweepDir = { x: d.x / l, y: d.y / l };
          this.sweepLocked = false;
        } else this.sweepLocked = true;
        if (this.modeTime >= t.sweepWindup[pi]!) {
          this.sweepLeft = t.sweepDistance;
          this.setMode('sweep');
        }
        break;
      }
      case 'sweep': {
        const sp = t.sweepSpeed[pi]!;
        this.vel = { x: this.sweepDir.x * sp, y: this.sweepDir.y * sp };
        const before = { ...this.pos };
        this.integrate(dt);
        this.sweepLeft -= Math.hypot(this.pos.x - before.x, this.pos.y - before.y);
        const stuck = Math.hypot(this.pos.x - before.x, this.pos.y - before.y) < sp * dt * 0.5; // hit the arena edge
        if (this.sweepLeft <= 0 || stuck) this.endAttack();
        break;
      }
      case 'grab':
        this.moveToward(this.hoverTarget(v.pos), t.followSpeed[pi]! * 0.4, dt);
        if (this.tendrils.length === 0) this.endAttack();
        break;
      case 'slamWindup':
        this.moveToward({ x: this.pos.x, y: this.arena.y + t.bodyRadius + 10 }, 260, dt);
        if (this.modeTime >= t.slamWindup) {
          out.slam = { debris: t.slamDebris[pi]! };
          this.setMode('slamRecover');
        }
        break;
      case 'slamRecover':
        this.moveToward(this.hoverTarget(v.pos), 140, dt);
        if (this.modeTime >= t.slamRecover) this.endAttack();
        break;
      default:
        break;
    }

    // --- contact with the body
    if (inArena) {
      const d = { x: v.pos.x - this.pos.x, y: v.pos.y - this.pos.y };
      const l = Math.hypot(d.x, d.y);
      if (l < t.bodyRadius + 10 && this.contactCd <= 0) {
        this.contactCd = t.contactCooldown;
        // a sweep hits hard; a bump hurts a little; while it is stunned or
        // between phases the body only shoves
        const passive = this.mode === 'stagger' || this.mode === 'transition';
        out.vesselDamage += this.mode === 'sweep' ? t.sweepDamage : passive ? 0 : t.contactDamage;
        const n = l > 1e-6 ? { x: d.x / l, y: d.y / l } : { x: 0, y: -1 };
        const kb = this.mode === 'sweep' ? t.knockback : t.knockback * 0.6;
        out.knockback = { x: n.x * kb, y: n.y * kb };
        if (this.mode === 'sweep') this.endAttack();
      }
    }

    // --- ambient debris (phase 3)
    this.ambientAcc += (t.ambientDebrisRate[pi] ?? 0) * dt;
    while (this.ambientAcc >= 1) {
      this.ambientAcc -= 1;
      out.ambientDebris++;
    }
    return out;
  }

  // ------------------------------------------------------------ internals

  /** Apply damage from a source; handles phase changes and defeat. */
  hit(damage: number, source: 'rock' | 'exhaust'): void {
    if (this.defeated || damage <= 0) return;
    const applied = Math.min(this.hp, damage);
    this.hp = Math.max(0, this.hp - applied);
    this.damageBy[source] += applied;
    this.hurtFlash = 0.3;
    this.events({ type: 'bossHit', damage: applied, hp: this.hp, source });
    if (this.hp <= 0) {
      if (!this.defeatedEmitted) {
        this.defeatedEmitted = true;
        this.events({ type: 'bossDefeated' });
      }
      this.releaseAll();
      this.setMode('dying');
      return;
    }
    const phase = this.phaseFor(this.hp);
    if (phase > this.phase) {
      this.phase = phase;
      this.events({ type: 'bossPhase', phase, hp: this.hp });
      this.releaseAll();
      this.attackIndex = 0;
      this.cooldown = this.t.attackCooldown[phase - 1]!;
      this.setMode('transition');
    }
  }

  phaseFor(hp: number): number {
    const [a, b] = this.t.phaseThresholds;
    return hp > a! ? 1 : hp > b! ? 2 : 3;
  }

  private stagger(): void {
    this.releaseAll();
    this.vel = { x: 0, y: -80 };
    this.cooldown = this.t.attackCooldown[this.phase - 1]!;
    this.setMode('stagger');
  }

  private startAttack(target: Vec2): void {
    const pattern = this.t.pattern[this.phase - 1]!;
    const a = pattern[this.attackIndex % pattern.length]!;
    this.attackIndex++;
    this.beginAttack(a, target);
  }

  /** Start a specific attack (tests / scripted). */
  beginAttack(a: KeeperAttack, target: Vec2): void {
    switch (a) {
      case 'sweep': {
        const d = { x: target.x - this.pos.x, y: target.y - this.pos.y };
        const l = Math.hypot(d.x, d.y) || 1;
        this.sweepDir = { x: d.x / l, y: d.y / l };
        this.sweepLocked = false;
        this.setMode('sweepWindup');
        break;
      }
      case 'grab': {
        const n = this.t.grabTendrils[this.phase - 1]!;
        this.tendrils = [];
        for (let i = 0; i < n; i++) {
          const spread = n === 1 ? 0 : (i - (n - 1) / 2) * 0.5;
          const base = Math.atan2(target.y - this.pos.y, target.x - this.pos.x) + spread;
          this.tendrils.push({ state: 'reaching', tip: this.root(base), burn: 0, held: 0, t: 0, rootAngle: base });
        }
        this.setMode('grab');
        break;
      }
      case 'slam':
        this.setMode('slamWindup');
        break;
    }
  }

  private endAttack(): void {
    this.cooldown = this.t.attackCooldown[this.phase - 1]!;
    this.setMode('idle');
  }

  private setMode(m: KeeperMode): void {
    this.mode = m;
    this.modeTime = 0;
  }

  private releaseAll(): void {
    for (const d of this.tendrils) if (d.state !== 'retracting') this.retract(d);
  }

  private retract(d: Tendril): void {
    d.state = 'retracting';
    d.t = 0;
  }

  /** Tendril root on the body edge. */
  root(angle: number): Vec2 {
    const r = this.t.bodyRadius * 0.7;
    return { x: this.pos.x + Math.cos(angle) * r, y: this.pos.y + Math.sin(angle) * r };
  }

  private updateTendrils(inp: KeeperInput, out: KeeperOutput): void {
    const t = this.t;
    const v = inp.vessel;
    for (const d of this.tendrils) {
      if (d.state === 'reaching') {
        if (v.crashed) {
          this.retract(d);
          continue;
        }
        const to = { x: v.pos.x - d.tip.x, y: v.pos.y - d.tip.y };
        const l = Math.hypot(to.x, to.y);
        const step = t.grabTipSpeed * inp.dt;
        d.tip = l <= step ? { ...v.pos } : { x: d.tip.x + (to.x / l) * step, y: d.tip.y + (to.y / l) * step };
        const root = this.root(d.rootAngle);
        const len = Math.hypot(d.tip.x - root.x, d.tip.y - root.y);
        if (Math.hypot(v.pos.x - d.tip.x, v.pos.y - d.tip.y) <= t.grabRadius) {
          d.state = 'holding';
          d.tip = { ...v.pos };
        } else if (len >= t.grabReach) this.retract(d);
      } else if (d.state === 'holding') {
        if (v.crashed) {
          this.retract(d);
          continue;
        }
        d.tip = { ...v.pos };
        d.held += inp.dt;
        out.vesselDamage += t.grabDamagePerSec * inp.dt;
        // reel the vessel in to the hold distance (no closer: no contact
        // damage on top), damping its motion so it hangs instead of orbiting
        const to = { x: this.pos.x - v.pos.x, y: this.pos.y - v.pos.y };
        const l = Math.hypot(to.x, to.y) || 1;
        const reel = Math.max(-1, Math.min(1, (l - t.grabHoldDistance) / 40)) * t.grabPull;
        const damp = t.grabDamping / 30; // px/s -> m/s² per 1/s
        const pull = out.pull ?? { x: 0, y: 0 };
        out.pull = { x: pull.x + (to.x / l) * reel - v.vel.x * damp, y: pull.y + (to.y / l) * reel - v.vel.y * damp };
        // burn: exhaust on the tendril near the vessel
        if (this.tendrilBurning(d, inp.exhaust)) d.burn += inp.dt;
        else d.burn = Math.max(0, d.burn - t.burnDecay * inp.dt);
        if (d.burn >= t.burnToBreak) {
          this.retract(d);
          this.hit(t.tendrilBurnDamage, 'exhaust');
          if (this.defeated) return;
        } else if (d.held >= t.crushAfterSec) {
          this.retract(d);
          out.vesselDamage += t.crushDamage;
          const n = { x: -to.x / l, y: -to.y / l };
          out.knockback = { x: n.x * t.knockback, y: n.y * t.knockback };
        }
      } else {
        d.t += inp.dt;
        const root = this.root(d.rootAngle);
        const k = Math.max(0, 1 - d.t / t.retractSec);
        d.tip = { x: root.x + (d.tip.x - root.x) * k, y: root.y + (d.tip.y - root.y) * k };
      }
    }
    this.tendrils = this.tendrils.filter((d) => !(d.state === 'retracting' && d.t >= t.retractSec));
  }

  /** Sample the tendril from the tip back towards the root: any point in an exhaust cone? */
  tendrilBurning(d: Tendril, cones: readonly Cone[]): boolean {
    if (cones.length === 0) return false;
    const root = this.root(d.rootAngle);
    const dir = { x: root.x - d.tip.x, y: root.y - d.tip.y };
    const l = Math.hypot(dir.x, dir.y);
    if (l < 1e-6) return false;
    for (let s = 10; s <= Math.min(60, l); s += 10) {
      const p = { x: d.tip.x + (dir.x / l) * s, y: d.tip.y + (dir.y / l) * s };
      if (cones.some((c) => coneContains(c, p))) return true;
    }
    return false;
  }

  private hoverTarget(vesselPos: Vec2): Vec2 {
    const a = this.arena;
    const m = this.t.bodyRadius + 40;
    const dx = vesselPos.x - this.pos.x;
    const dz = this.t.followDeadzone;
    const want = Math.abs(dx) <= dz ? this.pos.x : vesselPos.x - Math.sign(dx) * dz;
    const x = Math.min(a.x + a.w - m, Math.max(a.x + m, want));
    const y = a.y + this.t.hoverY + Math.sin((this.time / this.t.bobSec) * Math.PI * 2) * this.t.bobAmp;
    return { x, y };
  }

  private moveToward(target: Vec2, speed: number, dt: number): void {
    const d = { x: target.x - this.pos.x, y: target.y - this.pos.y };
    const l = Math.hypot(d.x, d.y);
    const sp = Math.min(speed, l / Math.max(dt, 1e-6));
    this.vel = l > 1e-6 ? { x: (d.x / l) * sp, y: (d.y / l) * sp } : { x: 0, y: 0 };
    this.integrate(dt);
  }

  private integrate(dt: number): void {
    const a = this.arena;
    const r = this.t.bodyRadius;
    this.pos = {
      x: Math.min(a.x + a.w - r, Math.max(a.x + r, this.pos.x + this.vel.x * dt)),
      y: Math.min(a.y + a.h - r, Math.max(a.y + r, this.pos.y + this.vel.y * dt)),
    };
  }
}

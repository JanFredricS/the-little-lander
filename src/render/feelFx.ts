/**
 * Feel layer (S8): small, event-driven juice on top of the S6/S7 renderers,
 * which it never draws over or replaces.
 *
 *  - Particles (one fixed-capacity pool, sprites from a SpritePool, no
 *    per-frame allocation): landing dust (softLand, scrapes), impact sparks
 *    + shake only for hits at or above the active vessel's damageSpeed (a
 *    safe landing never sparks), a crash explosion + smoke, and exhaust
 *    smoke from every burning nozzle.
 *  - Screen shake: a trauma value (0..1) raised by hits / crash / radiation
 *    / boss blows and decaying over ~0.6 s; offset = trauma² × SHAKE_MAX_PX,
 *    rounded to whole px (pixel-perfect). Capped, and off with
 *    Settings.reducedMotion.
 *  - Hit flash: `flashing` is true for HIT_FLASH_SEC after hull damage
 *    (FlightView tints the hull); off with reducedMotion.
 *
 * Events arrive during fixed steps; update() runs per rendered frame on
 * wall-clock time and freezes while paused.
 */

import { Container } from 'pixi.js';
import type { GameEvent, SpriteName, Vec2 } from '../contracts';
import type { LevelSession } from '../game/session';
import { engineOn } from '../physics/vessel/types';
import { SpritePool, type SpriteTextures } from './spritePool';

/** Largest shake offset (px) at full trauma. */
export const SHAKE_MAX_PX = 4;
/** Trauma lost per second. */
const TRAUMA_DECAY = 1.6;
/** Seconds the hull stays tinted after damage. */
export const HIT_FLASH_SEC = 0.12;
/** Particle pool size; the oldest particle is recycled when it is full. */
const CAPACITY = 96;
/** Seconds between exhaust smoke puffs (per burning nozzle). */
const EXHAUST_EVERY = 0.07;
/** Impacts below this (px/s) leave no dust at all (grazes, resting contact). */
const DUST_MIN_SPEED = 30;

type Kind = 'dust' | 'spark' | 'smoke' | 'explosion';

const SPRITE: Record<Kind, SpriteName> = { dust: 'fx.dust', spark: 'fx.spark', smoke: 'fx.smoke', explosion: 'fx.explosion' };
const FRAMES: Record<Kind, number> = { dust: 4, spark: 3, smoke: 4, explosion: 6 };

interface Particle {
  live: boolean;
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Acceleration y (px/s²): sparks fall, smoke rises. */
  ay: number;
  drag: number;
  age: number;
  life: number;
  scale: number;
}

export interface FeelOptions {
  reducedMotion?: boolean;
}

/** Deterministic cheap jitter (no Math.random in render code). */
function hash(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

export class FeelFx {
  /** World-space layer; LevelView puts it in front of the flight bodies. */
  readonly layer = new Container();
  private readonly pool: SpritePool;
  private readonly parts: Particle[] = [];
  private next = 0;
  private seq = 0;
  private trauma = 0;
  private flash = 0;
  private exhaustClock = 0;
  private lastMs: number | null = null;
  private readonly off: () => void;
  private readonly shakeOffset: Vec2 = { x: 0, y: 0 };

  constructor(
    private readonly session: LevelSession,
    tex: SpriteTextures,
    private readonly opts: FeelOptions = {},
  ) {
    this.pool = new SpritePool(this.layer, tex);
    // the first crash / landing must not create textures or sprites mid-flight
    tex.warm(Object.values(SPRITE));
    this.pool.reserve(CAPACITY);
    for (let i = 0; i < CAPACITY; i++) this.parts.push({ live: false, kind: 'dust', x: 0, y: 0, vx: 0, vy: 0, ay: 0, drag: 0, age: 0, life: 1, scale: 1 });
    this.off = session.on((e) => this.onEvent(e));
  }

  /** True while the hull should show the hit tint. */
  get flashing(): boolean {
    return !this.opts.reducedMotion && this.flash > 0;
  }

  /** Current shake (whole px), to add to the world offset. Reused object. */
  get shake(): Readonly<Vec2> {
    return this.shakeOffset;
  }

  /** Current trauma 0..1 (tests / debugging). */
  get traumaLevel(): number {
    return this.trauma;
  }

  /** Live particle count (tests / debugging). */
  get particleCount(): number {
    let n = 0;
    for (const p of this.parts) if (p.live) n++;
    return n;
  }

  onEvent(e: GameEvent): void {
    switch (e.type) {
      case 'softLand':
        this.dust(e.pos, 6, 40);
        break;
      case 'impact': {
        // keyed to the active vessel: sparks + shake only where the hull takes damage
        const t = this.session.tuning[this.session.state.mode];
        const debris = e.with.startsWith('debris');
        if (e.speed < t.damageSpeed) {
          if (!debris && e.speed >= DUST_MIN_SPEED) this.dust(e.pos, 2, 20 + 20 * (e.speed / t.damageSpeed));
          break;
        }
        const k = Math.min(1, (e.speed - t.damageSpeed) / Math.max(1, t.crashSpeed - t.damageSpeed));
        this.burst('spark', e.pos, 3 + Math.round(5 * k), 60 + 140 * k, 320, 0.5);
        if (!debris) this.dust(e.pos, 2 + Math.round(3 * k), 30 + 40 * k);
        this.addTrauma(0.1 + 0.25 * k);
        break;
      }
      case 'hullChanged':
        if (e.delta < 0 && e.reason !== 'goo') {
          this.flash = HIT_FLASH_SEC;
          this.addTrauma(Math.min(0.5, 0.1 - e.delta * 1.5)); // hull is 0..1
        }
        break;
      case 'crash':
        this.spawn('explosion', e.pos.x, e.pos.y, 0, 0, 0, 0, 0.6, 1);
        this.burst('smoke', e.pos, 6, 50, -40, 1.1);
        this.burst('spark', e.pos, 10, 220, 320, 0.7);
        this.addTrauma(0.9);
        break;
      case 'radiationHit':
        this.addTrauma(0.35);
        break;
      case 'bossHit':
        this.addTrauma(0.2);
        break;
      case 'bossDefeated':
        this.addTrauma(0.7);
        break;
      // round 15: spring legs + crumbling islets
      case 'springJump': {
        const v = this.session.state;
        this.dust({ x: v.pos.x, y: v.pos.y + this.session.vessel.geometry.h / 2 }, 2 + Math.round(4 * e.power), 30 + 40 * e.power);
        break;
      }
      case 'platformCrumbling':
        this.dust(e.pos, 4, 25);
        break;
      case 'platformCrumbled':
        this.dust(e.pos, 8, 60);
        this.burst('smoke', e.pos, 3, 30, -20, 0.8);
        this.addTrauma(0.15);
        break;
      default:
        break;
    }
  }

  update(nowMs: number, paused: boolean): void {
    const dt = this.lastMs === null || paused ? 0 : Math.min(0.05, Math.max(0, (nowMs - this.lastMs) / 1000));
    this.lastMs = nowMs;

    this.trauma = Math.max(0, this.trauma - TRAUMA_DECAY * dt);
    this.flash = Math.max(0, this.flash - dt);
    if (this.opts.reducedMotion || this.trauma <= 0) {
      this.shakeOffset.x = 0;
      this.shakeOffset.y = 0;
    } else {
      const a = this.trauma * this.trauma * SHAKE_MAX_PX;
      const t = nowMs * 0.001;
      this.shakeOffset.x = Math.round(a * (Math.sin(t * 71) * 0.6 + Math.sin(t * 43 + 1.7) * 0.4));
      this.shakeOffset.y = Math.round(a * (Math.sin(t * 59 + 0.6) * 0.6 + Math.sin(t * 37 + 2.9) * 0.4));
    }

    this.exhaust(dt);

    this.pool.begin();
    for (const p of this.parts) {
      if (!p.live) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.live = false;
        continue;
      }
      const damp = Math.max(0, 1 - p.drag * dt);
      p.vx *= damp;
      p.vy = p.vy * damp + p.ay * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const k = p.age / p.life;
      const sp = this.pool.next(SPRITE[p.kind], Math.min(FRAMES[p.kind] - 1, Math.floor(k * FRAMES[p.kind])), Math.round(p.x), Math.round(p.y));
      sp.scale.set(p.scale);
      if (p.kind !== 'explosion') sp.alpha = k < 0.7 ? 1 : (1 - k) / 0.3;
    }
    this.pool.end();
  }

  destroy(): void {
    this.off();
    this.layer.destroy({ children: true });
  }

  private addTrauma(v: number): void {
    this.trauma = Math.min(1, this.trauma + v);
  }

  /** Sparse smoke from each nozzle whose engine burns (main puffs are larger). */
  private exhaust(dt: number): void {
    const s = this.session;
    const vs = s.state;
    const e = s.vessel.engineFlags(); // incl. the S9 top thrusters
    if (vs.crashed || dt === 0 || !(e.main || e.left || e.right || e.topLeft || e.topRight)) {
      this.exhaustClock = 0;
      return;
    }
    this.exhaustClock -= dt;
    if (this.exhaustClock > 0) return;
    this.exhaustClock = EXHAUST_EVERY;
    const c = Math.cos(vs.angle);
    const sn = Math.sin(vs.angle);
    for (const n of s.vessel.geometry.nozzles) {
      if (!engineOn(e, n.engine)) continue;
      const main = n.engine === 'main';
      const k = n.top ? -1 : 1; // top thrusters exhaust along body-up
      const ly = n.y + k * (main ? 12 : 7); // just past the flame's hot core
      const x = vs.pos.x + n.x * c - ly * sn;
      const y = vs.pos.y + n.x * sn + ly * c;
      const j = hash(++this.seq) - 0.5;
      // along the nozzle axis, plus the vessel's own drift
      this.spawn('smoke', x, y, k * -sn * 70 + j * 30 + vs.vel.x * 0.3, k * c * 70 + vs.vel.y * 0.3, -30, 2.2, 0.65, (main ? 0.6 : 0.45) + 0.2 * hash(this.seq * 3));
    }
  }

  private dust(pos: Vec2, n: number, speed: number): void {
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const j = hash(++this.seq);
      this.spawn('dust', pos.x + side * (2 + j * 6), pos.y - 2, side * speed * (0.5 + j), -10 - 20 * j, 30, 3, 0.5 + 0.2 * j, 0.6 + 0.4 * j);
    }
  }

  private burst(kind: Kind, pos: Vec2, n: number, speed: number, ay: number, life: number): void {
    for (let i = 0; i < n; i++) {
      const a = hash(++this.seq) * Math.PI * 2;
      const v = speed * (0.4 + 0.6 * hash(this.seq * 7));
      this.spawn(kind, pos.x, pos.y, Math.cos(a) * v, Math.sin(a) * v - (kind === 'spark' ? speed * 0.4 : 0), ay, kind === 'smoke' ? 1.5 : 1, life * (0.7 + 0.3 * hash(this.seq * 5)), 1);
    }
  }

  private spawn(kind: Kind, x: number, y: number, vx: number, vy: number, ay: number, drag: number, life: number, scale: number): void {
    const p = this.parts[this.next]!;
    this.next = (this.next + 1) % CAPACITY;
    p.live = true;
    p.kind = kind;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.ay = ay;
    p.drag = drag;
    p.age = 0;
    p.life = life;
    p.scale = scale;
  }
}

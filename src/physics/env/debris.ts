/**
 * Debris spawners: dynamic balls raining from each spawner's `area` at
 * `ratePerSec` while active (activate trigger, optional durationSec). Seeded
 * per spawner (seed ?? hash(id)) so runs are deterministic. Pieces are
 * removed after lifetimeSec or when they leave the world. Hull damage from
 * debris hits is applied by the vessel (tags debris / debrisBurning).
 */

import type { BodyHandle, DebrisSpawnerEntity, EntitySpec, PhysicsApi } from '../../contracts';
import { hashString, rng } from '../geom';
import { TAG_DEBRIS, TAG_DEBRIS_BURNING } from '../tags';
import type { PhysicsTuning } from '../tuning';
import { mToPx, pxToM, vPxToM } from '../units';
import { TriggerLatch, type TriggerContext } from './triggers';

export interface DebrisPiece {
  body: BodyHandle;
  /** px */
  radius: number;
  burning: boolean;
  bornAt: number;
  spawnerId: string;
}

interface Spawner {
  e: DebrisSpawnerEntity;
  latch: TriggerLatch;
  rand: () => number;
  activeSec: number;
  acc: number;
}

/** Margin (px) outside the world before a piece is dropped. */
const OUT_MARGIN = 100;

export class DebrisSystem {
  pieces: DebrisPiece[] = [];
  private readonly spawners: Spawner[];

  constructor(
    private readonly physics: PhysicsApi,
    entities: readonly EntitySpec[],
    private readonly tuning: PhysicsTuning['debris'],
    private readonly world: { w: number; h: number },
  ) {
    this.spawners = entities
      .filter((e): e is DebrisSpawnerEntity => e.kind === 'debrisSpawner')
      .map((e) => ({ e, latch: new TriggerLatch(e.activate), rand: rng(e.seed ?? hashString(e.id)), activeSec: 0, acc: 0 }));
  }

  /** Is this spawner currently raining? (render/audio) */
  isActive(id: string): boolean {
    const s = this.spawners.find((x) => x.e.id === id);
    return !!s && s.latch.hasFired && (s.e.durationSec === undefined || s.activeSec < s.e.durationSec);
  }

  /** Per step, before physics.step(): spawn due pieces. */
  update(ctx: TriggerContext, dt: number): void {
    for (const s of this.spawners) {
      if (!s.latch.update(ctx)) continue;
      if (s.e.durationSec !== undefined && s.activeSec >= s.e.durationSec) continue;
      s.activeSec += dt;
      s.acc += s.e.ratePerSec * dt;
      while (s.acc >= 1) {
        s.acc -= 1;
        this.spawn(s, ctx.simTime);
      }
    }
  }

  /** Per step, after physics.step(): drop old / lost pieces. */
  cleanup(simTime: number): void {
    const keep: DebrisPiece[] = [];
    for (const p of this.pieces) {
      if (!this.physics.hasBody(p.body)) continue;
      const t = this.physics.getTransform(p.body);
      const x = mToPx(t.x);
      const y = mToPx(t.y);
      const lost = x < -OUT_MARGIN || x > this.world.w + OUT_MARGIN || y < -OUT_MARGIN || y > this.world.h + OUT_MARGIN;
      if (lost || simTime - p.bornAt > this.tuning.lifetimeSec) this.physics.destroyBody(p.body);
      else keep.push(p);
    }
    this.pieces = keep;
  }

  bodies(): BodyHandle[] {
    return this.pieces.map((p) => p.body);
  }

  destroy(): void {
    for (const p of this.pieces) if (this.physics.hasBody(p.body)) this.physics.destroyBody(p.body);
    this.pieces = [];
  }

  private spawn(s: Spawner, simTime: number): void {
    const r = s.rand;
    // Always consume the same random numbers, even when capped, so streams stay aligned.
    const x = s.e.area.x + r() * s.e.area.w;
    const y = s.e.area.y + r() * s.e.area.h;
    const size = s.e.sizeMin + r() * (s.e.sizeMax - s.e.sizeMin);
    const spin = (r() - 0.5) * 4;
    if (this.pieces.length >= this.tuning.maxAlive) return;
    const burning = !!s.e.burning;
    const body = this.physics.createBody({
      type: 'dynamic',
      position: { x: pxToM(x), y: pxToM(y) },
      linearVelocity: vPxToM(s.e.velocity ?? { x: 0, y: 0 }),
      angularVelocity: spin,
      tag: burning ? TAG_DEBRIS_BURNING : TAG_DEBRIS,
    });
    const radius = size / 2;
    this.physics.addCircle(body, { x: 0, y: 0 }, pxToM(radius), {
      density: this.tuning.density,
      restitution: this.tuning.restitution,
      friction: this.tuning.friction,
      sensorEvents: false,
    });
    this.pieces.push({ body, radius, burning, bornAt: simTime, spawnerId: s.e.id });
  }
}

/**
 * The Keeper in the physics world: feeds KeeperBrain (pure AI) the vessel,
 * its exhaust cones and the falling loose rocks every step, then applies the
 * result — shatters rocks that hit, hull damage (cause 'boss' when fatal),
 * knockback impulses, the grab pull force, slam debris + rock regrowth and
 * phase-3 ambient debris. The boss itself has no Box2D body: contact and
 * rock hits are circle tests in the brain (see keeperBrain.ts).
 */

import type { BodyHandle, BossSpawnEntity, ObjectiveSpec } from '../../contracts';
import { hashString, rng } from '../../physics/geom';
import { TAG_DEBRIS } from '../../physics/tags';
import { pxToM } from '../../physics/units';
import type { LooseRockSystem } from '../systems/looseRocks';
import type { LevelSystem, LevelSystemHost } from '../systems/types';
import { KeeperBrain } from './keeperBrain';
import { KEEPER_TUNING, type KeeperTuning } from './keeperTuning';

interface SlamPiece {
  body: BodyHandle;
  radius: number;
  bornAt: number;
}

const PIECE_LIFE_SEC = 6;

export class KeeperSystem implements LevelSystem {
  readonly brain: KeeperBrain;
  readonly entity: BossSpawnEntity;
  pieces: SlamPiece[] = [];
  private readonly rand: () => number;
  private pendingDamage = 0;

  constructor(
    private readonly host: LevelSystemHost,
    entity: BossSpawnEntity,
    private readonly rocks: LooseRockSystem | null,
    tuning: KeeperTuning = KEEPER_TUNING,
  ) {
    this.entity = entity;
    this.brain = new KeeperBrain(entity.arena, { x: entity.x, y: entity.y }, (e) => host.emit(e), tuning);
    this.rand = rng(hashString(entity.id));
  }

  beforeStep(): void {
    const h = this.host;
    const v = h.vessel;
    const s = h.state;
    const out = this.brain.update({
      dt: 1 / 60,
      vessel: { pos: s.pos, vel: s.vel, crashed: s.crashed },
      exhaust: v.exhaustCones(),
      rocks: this.rocks ? this.rocks.fallingInfo().map((f) => ({ id: f.rock.id, pos: f.pos, vel: f.vel, radius: f.rock.radius })) : [],
    });
    if (this.rocks && out.rockHits.length) {
      for (const f of this.rocks.falling) if (out.rockHits.includes(f.id)) this.rocks.consume(f);
    }
    if (s.crashed) return;
    const p = h.physics;
    if (out.pull) {
      const m = v.totalMass();
      p.applyForce(v.body, { x: m * out.pull.x, y: m * out.pull.y });
    }
    if (out.knockback) {
      const m = v.totalMass();
      p.applyImpulse(v.body, { x: m * pxToM(out.knockback.x), y: m * pxToM(out.knockback.y) });
    }
    if (out.slam) {
      this.spawnDebris(out.slam.debris);
      if (this.rocks) for (const r of this.rocks.rocks) r.fellAt = -Infinity; // regrow every fallen rock
    }
    if (out.ambientDebris) this.spawnDebris(out.ambientDebris);
    this.pendingDamage += out.vesselDamage;
  }

  afterStep(): void {
    const v = this.host.vessel;
    // damage is applied after the step so a crash lands in this step's state
    if (this.pendingDamage > 0) {
      const s = v.state();
      if (!s.crashed) {
        if (s.hull - this.pendingDamage <= 1e-9) v.crash('boss');
        else v.damage(this.pendingDamage, 'boss');
      }
      this.pendingDamage = 0;
    }
    const p = this.host.physics;
    const t = this.host.simTime;
    this.pieces = this.pieces.filter((d) => {
      const alive = p.hasBody(d.body) && t - d.bornAt < PIECE_LIFE_SEC;
      if (!alive && p.hasBody(d.body)) p.destroyBody(d.body);
      return alive;
    });
  }

  objectiveDone(o: ObjectiveSpec): boolean {
    return o.kind === 'surviveBoss' && o.bossEntityId === this.entity.id && this.brain.finished;
  }

  destroy(): void {
    const p = this.host.physics;
    for (const d of this.pieces) if (p.hasBody(d.body)) p.destroyBody(d.body);
    this.pieces = [];
  }

  /** Small debris shaken from the roof across the arena. */
  private spawnDebris(n: number): void {
    const p = this.host.physics;
    const a = this.entity.arena;
    for (let i = 0; i < n; i++) {
      const x = a.x + 60 + this.rand() * (a.w - 120);
      const radius = 4 + this.rand() * 5;
      const body = p.createBody({ type: 'dynamic', position: { x: pxToM(x), y: pxToM(a.y + 20) }, linearVelocity: { x: 0, y: 2 }, tag: TAG_DEBRIS });
      p.addCircle(body, { x: 0, y: 0 }, pxToM(radius), { density: 2, restitution: 0.2, friction: 0.5, sensorEvents: false });
      this.pieces.push({ body, radius, bornAt: this.host.simTime });
    }
  }
}

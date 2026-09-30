/**
 * Creatures (CreatureEntity). No physics bodies: creatures are scripted.
 *
 *  - Ambient creatures (no `action`): once their `activate` trigger fires
 *    (default: level start) they glide around their waypoint loop (relative
 *    to x, y) at `speed` px/s. depth > 0 = background (the renderer applies
 *    parallax factor 1 - depth).
 *  - action 'seizeCsm' (Map 3's dragon-bird): DragonBirdSequence below.
 */

import type { CreatureEntity, Vec2, VesselMode, VesselState } from '../../contracts';
import { FIXED_DT } from '../../contracts';
import { TriggerLatch } from '../../physics/env/triggers';
import { pathSampler, type PathSampler } from './paths';
import type { EntitySystem, RuntimeHost } from './types';

export type DragonBirdPhase = 'dormant' | 'stalking' | 'seizing' | 'carrying' | 'gone';

/** Grab distance (px, bird centre to vessel centre). */
export const SEIZE_RADIUS = 34;
/** The bird hovers this far above the vessel it carries (px). */
export const CARRY_OFFSET_Y = -26;
/** Seconds the bird flies off with the CSM before it is gone. */
export const CARRY_SEC = 7;

/**
 * The dragon-bird's scripted sequence (pure state machine; tested headless):
 *
 *   dormant --activate--> stalking --within SEIZE_RADIUS of a CSM--> seizing
 *   seizing --vessel is no longer a CSM--> carrying --CARRY_SEC--> gone
 *   stalking --vessel mode changed some other way (the level's modeSwitch
 *             backstop region)--> carrying (snaps onto the vessel: the
 *             csmSeized cutscene covers the jump)
 *
 * stalking: pursuit at `speed` px/s aimed a little above the vessel (it
 * strikes from above). seizing: asks the host for the CSM -> lander switch
 * (the session applies it next step and the App plays the modeSwitch
 * cutscene). carrying: flies away along `exitDir` hauling the empty CSM.
 */
export class DragonBirdSequence {
  phase: DragonBirdPhase = 'dormant';
  pos: Vec2;
  prevPos: Vec2;
  /** Facing: +1 right, -1 left. */
  facing = 1;
  /** Seconds in the current phase. */
  timeInPhase = 0;
  private readonly latch: TriggerLatch;

  constructor(
    readonly entity: CreatureEntity,
    /** Unit direction of the getaway flight. */
    private readonly exitDir: Vec2 = { x: 0.6, y: -0.8 },
  ) {
    this.pos = { x: entity.x, y: entity.y };
    this.prevPos = { ...this.pos };
    this.latch = new TriggerLatch(entity.activate);
  }

  /** Carrying the CSM hull (render it under the bird). */
  get carrying(): boolean {
    return this.phase === 'carrying';
  }

  /**
   * One fixed step. `activated` = the entity's trigger state this step.
   * Returns 'seize' on the step the host must switch the vessel to lander.
   */
  update(s: Pick<VesselState, 'pos' | 'mode' | 'crashed'>, activated: boolean): 'seize' | null {
    this.prevPos = { ...this.pos };
    this.timeInPhase += FIXED_DT;
    const speed = this.entity.speed;
    const to = (phase: DragonBirdPhase) => {
      this.phase = phase;
      this.timeInPhase = 0;
    };
    switch (this.phase) {
      case 'dormant':
        if (activated) to('stalking');
        return null;
      case 'stalking': {
        if (s.mode !== 'csm') {
          this.pos = { x: s.pos.x, y: s.pos.y + CARRY_OFFSET_Y };
          to('carrying');
          return null;
        }
        const target = { x: s.pos.x, y: s.pos.y + CARRY_OFFSET_Y };
        const dx = target.x - this.pos.x;
        const dy = target.y - this.pos.y;
        const d = Math.hypot(dx, dy);
        if (Math.abs(dx) > 1) this.facing = Math.sign(dx);
        if (!s.crashed && Math.hypot(s.pos.x - this.pos.x, s.pos.y - this.pos.y) <= SEIZE_RADIUS) {
          this.pos = target;
          to('seizing');
          return 'seize';
        }
        const step = Math.min(d, speed * FIXED_DT);
        if (d > 0) this.pos = { x: this.pos.x + (dx / d) * step, y: this.pos.y + (dy / d) * step };
        return null;
      }
      case 'seizing':
        this.pos = { x: s.pos.x, y: s.pos.y + CARRY_OFFSET_Y };
        if (s.mode !== 'csm') to('carrying');
        else if (this.timeInPhase > 0.5) return 'seize'; // re-ask if the switch was dropped
        return null;
      case 'carrying': {
        const v = speed * 0.8 * Math.min(1, 0.3 + this.timeInPhase);
        this.facing = Math.sign(this.exitDir.x) || this.facing;
        this.pos = { x: this.pos.x + this.exitDir.x * v * FIXED_DT, y: this.pos.y + this.exitDir.y * v * FIXED_DT };
        if (this.timeInPhase >= CARRY_SEC) to('gone');
        return null;
      }
      case 'gone':
        return null;
    }
  }

  /** The trigger latch (shared so callers can evaluate activation). */
  activation(ctx: Parameters<TriggerLatch['update']>[0]): boolean {
    return this.latch.update(ctx);
  }
}

export interface AmbientCreature {
  entity: CreatureEntity;
  path: PathSampler;
  latch: TriggerLatch;
  /** Arc distance travelled (px). */
  travelled: number;
  pos: Vec2;
  prevPos: Vec2;
  facing: number;
  active: boolean;
}

export class CreatureSystem implements EntitySystem {
  readonly ambient: AmbientCreature[] = [];
  readonly birds: DragonBirdSequence[] = [];

  constructor(private readonly host: RuntimeHost) {
    for (const e of host.spec.entities) {
      if (e.kind !== 'creature') continue;
      if (e.action === 'seizeCsm') {
        this.birds.push(new DragonBirdSequence(e));
        continue;
      }
      const pts = (e.path.length ? e.path : [{ x: 0, y: 0 }]).map((p) => ({ x: e.x + p.x, y: e.y + p.y }));
      const pos = { ...pts[0]! };
      this.ambient.push({ entity: e, path: pathSampler(pts, true), latch: new TriggerLatch(e.activate), travelled: 0, pos, prevPos: pos, facing: 1, active: false });
    }
  }

  afterStep(s: VesselState): void {
    const ctx = this.host.triggerContext(s.pos);
    for (const c of this.ambient) {
      c.prevPos = c.pos;
      c.active = c.latch.update(ctx);
      if (!c.active) continue;
      c.travelled += c.entity.speed * FIXED_DT;
      const next = c.path.at(c.travelled);
      if (Math.abs(next.x - c.pos.x) > 0.01) c.facing = Math.sign(next.x - c.pos.x);
      c.pos = next;
    }
    for (const b of this.birds) {
      if (b.update(s, b.activation(ctx)) === 'seize') this.host.requestModeSwitch('lander' satisfies VesselMode);
    }
  }
}

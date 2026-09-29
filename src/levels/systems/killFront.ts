/**
 * Kill fronts (KillFront zones, map 8's collapse): a line along `axis` that
 * starts at `start` when its trigger fires and moves at `speed` px/s. The
 * "wrong side" is the side it comes from: speed < 0 (rising, towards 0) kills
 * everything with a larger coordinate. A vessel caught behind it is crashed
 * ('crushed'); crumble platforms it overtakes collapse.
 *
 * Optional catch-up (`maxLag`, level option): the front never trails the
 * vessel by more than maxLag px, so a fast pilot who stops still feels it.
 */

import type { KillFront, Vec2 } from '../../contracts';
import { TriggerLatch } from '../../physics/env/triggers';
import type { CrumbleSystem } from './crumble';
import type { LevelSystem, LevelSystemHost } from './types';

export interface KillFrontOptions {
  /** Max distance (px) the front may trail the vessel. Default: unlimited. */
  maxLag?: number;
}

export interface FrontState {
  spec: KillFront;
  latch: TriggerLatch;
  /** Current coordinate along the axis (px); spec.start until activated. */
  pos: number;
  active: boolean;
}

/** Signed distance (px) of `p` ahead of the front (>0 = safe side). */
export function aheadOfFront(spec: KillFront, frontPos: number, p: Vec2): number {
  const c = spec.axis === 'x' ? p.x : p.y;
  return spec.speed < 0 ? frontPos - c : c - frontPos;
}

export class KillFrontSystem implements LevelSystem {
  readonly fronts: FrontState[];

  constructor(
    private readonly host: LevelSystemHost,
    private readonly options: KillFrontOptions = {},
    private readonly crumble: CrumbleSystem | null = null,
  ) {
    this.fronts = host.spec.zones
      .filter((z): z is KillFront => z.kind === 'killFront')
      .map((spec) => ({ spec, latch: new TriggerLatch(spec.activate), pos: spec.start, active: false }));
  }

  beforeStep(): void {
    const h = this.host;
    const ctx = h.env.triggerContext(h.state.pos);
    for (const f of this.fronts) {
      if (!f.active && f.latch.update(ctx)) f.active = true;
      if (!f.active) continue;
      f.pos += f.spec.speed / 60;
      const lag = this.options.maxLag;
      if (lag !== undefined && !h.state.crashed) {
        const ahead = aheadOfFront(f.spec, f.pos, h.state.pos);
        if (ahead > lag) f.pos += Math.sign(f.spec.speed) * (ahead - lag);
      }
    }
  }

  afterStep(): void {
    const h = this.host;
    for (const f of this.fronts) {
      if (!f.active) continue;
      if (this.crumble) {
        for (const s of this.crumble.platforms) if (!s.gone && aheadOfFront(f.spec, f.pos, s.entity) < 0) this.crumble.crumbleNow(s.entity.id);
      }
      const s = h.vessel.state();
      if (!s.crashed && aheadOfFront(f.spec, f.pos, s.pos) < 0) h.vessel.crash('crushed', Math.hypot(s.vel.x, s.vel.y));
    }
  }
}

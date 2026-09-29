/** TriggerSpec evaluation (level data -> "has this fired yet?"). */

import type { TriggerSpec, Vec2 } from '../../contracts';
import { rectContains } from '../geom';

export interface TriggerContext {
  /** Simulation seconds since level start. */
  simTime: number;
  /** Vessel centre, world px. */
  vesselPos: Vec2;
  /** Completed objective ids. */
  completed: ReadonlySet<string>;
}

export function triggerMet(t: TriggerSpec, ctx: TriggerContext): boolean {
  switch (t.kind) {
    case 'start':
      return true;
    case 'time':
      return ctx.simTime >= t.atSec - 1e-9;
    case 'enterRegion':
      return rectContains(t.rect, ctx.vesselPos);
    case 'objective':
      return ctx.completed.has(t.objectiveId);
  }
}

/** Latches the first time its trigger is met (default trigger: level start). */
export class TriggerLatch {
  private fired = false;

  constructor(private readonly spec: TriggerSpec = { kind: 'start' }) {}

  get hasFired(): boolean {
    return this.fired;
  }

  update(ctx: TriggerContext): boolean {
    if (!this.fired && triggerMet(this.spec, ctx)) this.fired = true;
    return this.fired;
  }
}

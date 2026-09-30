/**
 * Lander mode: two independent engines left and right of centre, no direct
 * rotation input. Each engine pushes along the body axis AT its nozzle
 * (x = ±engineOffset), so one engine alone both lifts and rotates the lander
 * (left engine pushes the left side up -> clockwise) and the tilted thrust
 * drifts it sideways. Torque emerges from the offset: attached goo / extra
 * mass changes the angular response. The `thrust` control fires both.
 *
 * S9 top thrusters: two smaller engines on the top of the body at
 * x = ±topOffset push along body-DOWN (opposite to the main pair). An
 * inverted lander lifts off with both and flips upright with one: top-left
 * alone turns it counter-clockwise, top-right clockwise (the mirror of the
 * main pair). Each burns fuel at the same rate as one main engine.
 */

import type { GameEventSink, InputFrame, PhysicsApi, VesselSpawn } from '../../contracts';
import type { LanderTuning, VesselOptions } from '../tuning';
import { VesselBase } from './base';
import type { VesselGeometry } from './types';

export function landerGeometry(t: LanderTuning): VesselGeometry {
  const footW = 4;
  const footX = t.legSpan / 2 - footW / 2;
  const footY = t.height / 2 + t.legDrop / 2;
  return {
    w: t.legSpan,
    h: t.height + 2 * t.legDrop,
    boxes: [
      { x: 0, y: 0, w: t.width, h: t.height },
      { x: -footX, y: footY, w: footW, h: t.legDrop },
      { x: footX, y: footY, w: footW, h: t.legDrop },
    ],
    nozzles: [
      { x: -t.engineOffset, y: t.height / 2, engine: 'left' },
      { x: t.engineOffset, y: t.height / 2, engine: 'right' },
      { x: -t.topOffset, y: -t.height / 2, engine: 'topLeft', top: true },
      { x: t.topOffset, y: -t.height / 2, engine: 'topRight', top: true },
    ],
  };
}

export class LanderController extends VesselBase {
  readonly mode = 'lander' as const;

  constructor(physics: PhysicsApi, spawn: VesselSpawn, events: GameEventSink, options: VesselOptions) {
    const t = options.tuning.lander;
    super(physics, spawn, events, landerGeometry(t), t, options, t);
  }

  protected control(frame: InputFrame, dt: number): void {
    const t = this.options.tuning.lander;
    const left = (frame.engineLeft || frame.thrust) && this.canBurn;
    const right = (frame.engineRight || frame.thrust) && this.canBurn;
    const topL = frame.topLeft && this.canBurn;
    const topR = frame.topRight && this.canBurn;
    this.setEngines(false, left, right, topL, topR);
    const n = (left ? 1 : 0) + (right ? 1 : 0) + (topL ? 1 : 0) + (topR ? 1 : 0);
    if (n === 0) return;
    const f = t.thrust * this.weight;
    if (left) this.thrustAt(f, { x: -t.engineOffset, y: t.height / 2 });
    if (right) this.thrustAt(f, { x: t.engineOffset, y: t.height / 2 });
    const ft = t.topThrust * this.weight;
    if (topL) this.thrustDownAt(ft, { x: -t.topOffset, y: -t.height / 2 });
    if (topR) this.thrustDownAt(ft, { x: t.topOffset, y: -t.height / 2 });
    this.burnFuel((n * 0.5 * dt) / t.burnSeconds);
  }
}

/**
 * Lander mode: two independent engines left and right of centre, no direct
 * rotation input. Each engine pushes along the body axis AT its nozzle
 * (x = ±engineOffset), so one engine alone both lifts and rotates the lander
 * (left engine pushes the left side up -> clockwise) and the tilted thrust
 * drifts it sideways. Torque emerges from the offset: attached goo / extra
 * mass changes the angular response. The `thrust` control fires both.
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
    this.setEngines(false, left, right);
    const n = (left ? 1 : 0) + (right ? 1 : 0);
    if (n === 0) return;
    const f = t.thrust * this.weight;
    if (left) this.thrustAt(f, { x: -t.engineOffset, y: t.height / 2 });
    if (right) this.thrustAt(f, { x: t.engineOffset, y: t.height / 2 });
    this.burnFuel((n * 0.5 * dt) / t.burnSeconds);
  }
}

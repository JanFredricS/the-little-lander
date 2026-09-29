/**
 * Lander mode: two independent engines left and right of centre, no direct
 * rotation input. Both engines = straight climb along the body axis; one
 * engine alone = its share of thrust plus a differential torque (left engine
 * pushes the left side up -> clockwise), so the tilted thrust vector drifts
 * the lander sideways. The `thrust` control fires both.
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
    this.thrust(n * t.thrust * this.weight);
    const diff = (left ? 1 : 0) - (right ? 1 : 0);
    if (diff !== 0) this.physics.applyTorque(this.body, diff * t.spinAccel * this.inertia);
    this.burnFuel((n * 0.5 * dt) / t.burnSeconds);
  }
}

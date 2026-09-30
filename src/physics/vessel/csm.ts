/**
 * CSM mode: lander + command/service module stack. One big main engine along
 * the body axis (thrust input) and torque rotation (rotateCW / rotateCCW).
 * Thrust-to-weight ~1.8: holding thrust runs away, so the skill is pulsing.
 */

import type { GameEventSink, InputFrame, PhysicsApi, VesselSpawn } from '../../contracts';
import type { VesselOptions } from '../tuning';
import { VesselBase } from './base';
import type { VesselGeometry } from './types';
import type { BrakeTuning } from './brakeAssist';

export function csmGeometry(t: { width: number; height: number }): VesselGeometry {
  return {
    w: t.width,
    h: t.height,
    boxes: [{ x: 0, y: 0, w: t.width, h: t.height }],
    nozzles: [{ x: 0, y: t.height / 2, engine: 'main' }],
  };
}

export class CsmController extends VesselBase {
  readonly mode = 'csm' as const;

  constructor(physics: PhysicsApi, spawn: VesselSpawn, events: GameEventSink, options: VesselOptions) {
    const t = options.tuning.csm;
    super(physics, spawn, events, csmGeometry(t), t, options, t);
  }

  protected override brakeTuning(): BrakeTuning {
    return this.options.tuning.csm;
  }

  protected control(frame: InputFrame, dt: number): void {
    const t = this.options.tuning.csm;
    const main = frame.thrust && this.canBurn;
    this.setEngines(main, false, false);
    if (main) {
      this.mainThrust(t.thrust * this.weight);
      this.burnFuel(dt / t.burnSeconds);
    }
    const rot = (frame.rotateCW ? 1 : 0) - (frame.rotateCCW ? 1 : 0);
    if (rot !== 0) this.physics.applyTorque(this.body, rot * t.rotateAccel * this.inertia);
  }
}

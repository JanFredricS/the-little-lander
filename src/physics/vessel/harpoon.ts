/**
 * Harpoon mode (ascent-stage pod, no thrusters) and harpoonThrust mode (the
 * pod with a re-attached CSM-style main engine + rotation, levels 6-8).
 * Rope guns: see harpoonRig.ts.
 */

import type { GameEventSink, InputFrame, PhysicsApi, RopeState, VesselSpawn } from '../../contracts';
import type { HarpoonThrustTuning, HarpoonTuning, VesselOptions } from '../tuning';
import { VesselBase } from './base';
import { HarpoonRig, type RigHost } from './harpoonRig';
import type { VesselGeometry } from './types';

export function podGeometry(t: HarpoonTuning | HarpoonThrustTuning, withEngine: boolean): VesselGeometry {
  return {
    w: t.width,
    h: t.height,
    boxes: [{ x: 0, y: 0, w: t.width, h: t.height }],
    nozzles: withEngine ? [{ x: 0, y: t.height / 2, engine: 'main' }] : [],
    mount: { x: 0, y: -t.mountHeight },
  };
}

abstract class RopeVessel extends VesselBase {
  protected readonly rig: HarpoonRig;

  constructor(
    physics: PhysicsApi,
    spawn: VesselSpawn,
    events: GameEventSink,
    options: VesselOptions,
    t: HarpoonTuning | HarpoonThrustTuning,
    withEngine: boolean,
  ) {
    super(physics, spawn, events, podGeometry(t, withEngine), t, options, withEngine ? (t as HarpoonThrustTuning) : undefined);
    const self = this;
    const host: RigHost = {
      physics,
      events,
      body: this.body,
      parts: this.parts,
      get hooks() {
        return self.hooks;
      },
      dryMass: this.dryMass,
    };
    this.rig = new HarpoonRig(host, t, options.harpoonGuns);
  }

  /** Rope mount in world px (render). */
  mountWorld() {
    return this.rig.mountWorld();
  }

  protected override postStep(dt: number): void {
    this.rig.postStep(dt);
  }

  protected override ropeState(): RopeState {
    return this.rig.ropeState();
  }

  protected override destroyExtras(): void {
    this.rig.destroy();
  }
}

export class HarpoonController extends RopeVessel {
  readonly mode = 'harpoon' as const;

  constructor(physics: PhysicsApi, spawn: VesselSpawn, events: GameEventSink, options: VesselOptions) {
    super(physics, spawn, events, options, options.tuning.harpoon, false);
  }

  protected control(frame: InputFrame, dt: number): void {
    this.rig.input(frame, dt);
  }
}

export class HarpoonThrustController extends RopeVessel {
  readonly mode = 'harpoonThrust' as const;

  constructor(physics: PhysicsApi, spawn: VesselSpawn, events: GameEventSink, options: VesselOptions) {
    super(physics, spawn, events, options, options.tuning.harpoonThrust, true);
  }

  protected control(frame: InputFrame, dt: number): void {
    const t = this.options.tuning.harpoonThrust;
    this.rig.input(frame, dt);
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

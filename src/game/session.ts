/**
 * One play-through of a level: physics world + vessel + camera + objective
 * bookkeeping, advanced one fixed step at a time. Rendering reads it (see
 * src/render/levelView.ts); it never touches the DOM, so it runs in tests.
 *
 * S1 scope: the per-mode vessel controllers (src/physics/vessel), the flight
 * environment (gravity ramp/zones, wind, debris, goo, radiation, pickups,
 * beacons: src/physics/env), mode switches (LevelSpec.modeSwitch and debug
 * requests), reachExit / plantBeacons / collectOrbs objectives,
 * out-of-bounds crash.
 *
 * S7 hook: level-owned systems (src/levels/systems: loose rocks, crumble
 * platforms, kill fronts, the Keeper boss) step right after the flight
 * environment, and answer the surviveBoss objective.
 */

import { FIXED_DT } from '../contracts';
import type {
  GameEvent,
  GameEventSink,
  InputFrame,
  LevelOutcome,
  LevelSpec,
  ExitDockEntity,
  Vec2,
  VesselMode,
  VesselState,
} from '../contracts';
import { PhysicsWorld } from '../physics/engine';
import { buildLevel, flightLevelBodies, type BuiltLevel } from '../levels/build';
import { createLevelSystems, type LevelSystems } from '../levels/systems';
import { FlightEnvironment } from '../physics/env/environment';
import { LevelRuntime } from '../levels/runtime';
import { TriggerLatch } from '../physics/env/triggers';
import { feltGravity, resolveTuning, vesselOptionsFor, type PhysicsTuning, type VesselOptions } from '../physics/tuning';
import { createVessel, type FlightVessel } from '../physics/vessel';
import { Camera } from '../shell/camera';
import { exitGate } from './exitGate';

/** How far outside the world rect (px) the vessel may go before it is lost. */
const OUT_OF_BOUNDS_MARGIN = 64;

export class LevelSession {
  readonly camera: Camera;
  private vesselState: VesselState;
  private _outcome: LevelOutcome | null = null;
  private readonly completed = new Set<string>();
  private readonly listeners: GameEventSink[] = [];

  static async create(spec: LevelSpec): Promise<LevelSession> {
    // felt gravity (GRAVITY_TUNING.scale); GravityField keeps it current from the first step on
    const physics = await PhysicsWorld.create({ gravity: feltGravity(spec.gravity, resolveTuning(spec.physicsOverrides).gravity.scale), hitSpeedThreshold: 0.5 });
    return new LevelSession(spec, physics);
  }

  /** The active vessel (replaced on a mode switch). */
  vessel: FlightVessel;
  readonly built: BuiltLevel;
  readonly env: FlightEnvironment;
  /** Level-owned entities the flight environment leaves unhandled (doors, islands, vines, creatures). */
  readonly runtime: LevelRuntime;
  readonly tuning: PhysicsTuning;
  private readonly vesselOptions: VesselOptions;
  private readonly sink: GameEventSink;
  private readonly modeSwitchLatch: TriggerLatch | null;
  private pendingMode: VesselMode | null = null;
  /** Level-owned systems (S7). */
  readonly systems: LevelSystems;

  private constructor(
    readonly spec: LevelSpec,
    readonly physics: PhysicsWorld,
  ) {
    this.built = buildLevel(physics, spec);
    this.sink = (e) => this.emit(e);
    this.tuning = resolveTuning(spec.physicsOverrides);
    this.vesselOptions = vesselOptionsFor(spec, this.tuning);
    this.env = new FlightEnvironment(physics, spec, flightLevelBodies(this.built), this.tuning, this.sink, () => this.completed);
    this.vessel = createVessel(
      spec.vesselMode,
      physics,
      { pos: { x: spec.spawn.x, y: spec.spawn.y }, angle: spec.spawn.angle ?? 0, fuel: spec.startFuel ?? 1 },
      this.sink,
      this.vesselOptions,
    );
    this.env.attach(this.vessel);
    this.runtime = new LevelRuntime({
      physics,
      spec,
      triggerContext: (p) => this.env.triggerContext(p),
      requestModeSwitch: (m) => this.requestModeSwitch(m),
      crashVessel: (cause) => this.vessel.crash(cause),
      beaconSites: this.env.beacons.sites,
    });
    this.modeSwitchLatch = spec.modeSwitch ? new TriggerLatch(spec.modeSwitch.trigger) : null;
    this.camera = new Camera({
      worldW: spec.worldSize.w,
      worldH: spec.worldSize.h,
      bias: spec.camera?.bias ?? 'horizontal',
      lookAheadMax: spec.camera?.lookAhead ?? 60,
    });
    this.vesselState = this.vessel.state();
    this.camera.snap(this.vesselState.pos);
    const self = this;
    this.systems = createLevelSystems({
      spec,
      physics,
      built: this.built,
      env: this.env,
      get vessel() {
        return self.vessel;
      },
      get state() {
        return self.vesselState;
      },
      get simTime() {
        return physics.simTime;
      },
      emit: this.sink,
    });
  }

  /** Subscribe to this session's GameEvents. */
  on(fn: GameEventSink): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /** Emit the levelStarted event (call once listeners are attached). */
  start(): void {
    this.emit({ type: 'levelStarted', levelId: this.spec.id, themeId: this.spec.themeId, mode: this.spec.vesselMode });
  }

  get state(): VesselState {
    return this.vesselState;
  }

  get outcome(): LevelOutcome | null {
    return this._outcome;
  }

  get simTime(): number {
    return this.physics.simTime;
  }

  /** Orbs collected so far. */
  get orbs(): number {
    return this.env.pickups.orbsCollected;
  }

  /** Switch the vessel to `mode` at the start of the next step (debug key, scripted switches). */
  requestModeSwitch(mode: VesselMode): void {
    this.pendingMode = mode;
  }

  /** Advance one fixed step with this tick's input. No-op once the level has an outcome. */
  step(frame: InputFrame): void {
    if (this._outcome) {
      this.camera.step(null);
      return;
    }
    this.checkModeSwitch();
    this.env.beforeStep();
    this.runtime.beforeStep(this.vesselState);
    for (const sys of this.systems.list) sys.beforeStep?.(frame);
    this.vessel.applyInput(frame, FIXED_DT);
    this.physics.step(FIXED_DT);
    this.vessel.state(); // contacts: crash / damage / soft-land
    this.env.afterStep();
    this.runtime.afterStep(this.vessel.state());
    for (const sys of this.systems.list) sys.afterStep?.();
    this.vesselState = this.vessel.state();
    const s = this.vesselState;
    this.camera.step(s.pos, s.vel);

    if (!s.crashed && this.outOfBounds(s.pos)) {
      this.vessel.crash('outOfBounds');
      this.vesselState = this.vessel.state();
    }
    if (this.vesselState.crashed) return;
    this.checkObjectives(s);
  }

  destroy(): void {
    this.listeners.length = 0;
    this.runtime.destroy();
    for (const sys of this.systems.list) sys.destroy?.();
    this.physics.destroy();
  }

  /** Replace the vessel with another mode, keeping pose, velocity, fuel and hull. */
  switchMode(to: VesselMode): void {
    const from = this.vessel.mode;
    if (to === from) return;
    const snap = this.vessel.snapshot();
    const oldH = this.vessel.geometry.h;
    this.env.detach();
    this.vessel.destroy();
    const lift = Math.max(0, (this.newGeometryHeight(to) - oldH) / 2);
    this.vessel = createVessel(to, this.physics, { ...snap, pos: { x: snap.pos.x, y: snap.pos.y - lift } }, this.sink, this.vesselOptions);
    this.env.attach(this.vessel);
    this.vesselState = this.vessel.state();
    this.emit({ type: 'vesselModeChanged', from, to });
  }

  // ------------------------------------------------------------ internals

  private emit(e: GameEvent): void {
    for (const fn of [...this.listeners]) fn(e);
    if (e.type === 'crash' && !this._outcome) {
      this._outcome = { kind: 'failed', cause: e.cause };
      this.emit({ type: 'levelFailed', levelId: this.spec.id, cause: e.cause });
    }
  }

  private checkModeSwitch(): void {
    if (this.modeSwitchLatch && !this.modeSwitchLatch.hasFired) {
      if (this.modeSwitchLatch.update(this.env.triggerContext(this.vesselState.pos))) this.pendingMode = this.spec.modeSwitch!.to;
    }
    if (this.pendingMode) {
      const to = this.pendingMode;
      this.pendingMode = null;
      this.switchMode(to);
    }
  }

  private newGeometryHeight(mode: VesselMode): number {
    const t = this.tuning;
    switch (mode) {
      case 'csm':
        return t.csm.height;
      case 'lander':
        return t.lander.height + 2 * t.lander.legDrop;
      case 'harpoon':
        return t.harpoon.height;
      case 'harpoonThrust':
        return t.harpoonThrust.height;
    }
  }

  private outOfBounds(p: Vec2): boolean {
    const m = OUT_OF_BOUNDS_MARGIN;
    return p.x < -m || p.y < -m || p.x > this.spec.worldSize.w + m || p.y > this.spec.worldSize.h + m;
  }

  private checkObjectives(s: VesselState): void {
    for (const o of this.spec.objectives) {
      if (this.completed.has(o.id)) continue;
      let done = false;
      switch (o.kind) {
        case 'reachExit': {
          const exit = this.spec.entities.find((e): e is ExitDockEntity => e.kind === 'exitDock' && e.id === o.exitId);
          done = !!exit && exitGate(exit, s) === 'ok';
          break;
        }
        case 'plantBeacons':
          done = o.siteIds.filter((id) => this.env.beacons.isPlanted(id)).length >= o.count;
          break;
        case 'collectOrbs':
          done = this.env.pickups.orbsCollected >= o.count;
          break;
        case 'surviveBoss':
          done = this.systems.list.some((sys) => sys.objectiveDone?.(o) === true);
          break;
      }
      if (!done) continue;
      this.completed.add(o.id);
      this.emit({ type: 'objectiveComplete', objectiveId: o.id });
    }
    const supported = this.spec.objectives.filter((o) => SUPPORTED_OBJECTIVES.has(o.kind));
    if (supported.length > 0 && supported.length === this.spec.objectives.length && supported.every((o) => this.completed.has(o.id))) {
      const timeSec = this.physics.simTime;
      const orbs = this.env.pickups.orbsCollected;
      const score = Math.round(1000 + s.fuel * 500 + s.hull * 500 + this.env.pickups.points);
      this._outcome = { kind: 'complete', timeSec, orbs, score };
      this.emit({ type: 'levelComplete', levelId: this.spec.id, timeSec, orbs, score });
    }
  }
}

const SUPPORTED_OBJECTIVES: ReadonlySet<string> = new Set(['reachExit', 'plantBeacons', 'collectOrbs', 'surviveBoss']);


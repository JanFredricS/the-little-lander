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
 *
 * Round 12 checkpoints (LevelSpec.checkpoints): captured when the level's
 * modeSwitch lands (checkpointReached); respawnState() is what a crash leaves
 * behind, and LevelSession.create(spec, respawn) starts a fresh session from
 * it. What a respawn keeps:
 *  - the checkpoint's vessel mode, pose (CheckpointSpec.respawn, else where the
 *    vessel was; velocity zero), fuel and hull - restored, not the crash's;
 *  - EVERY beacon planted before the crash (also after the checkpoint: the
 *    player keeps the work done; minimap / HUD are seeded from the same list);
 *  - pickups taken before the checkpoint stay taken; those taken after it are
 *    back (no fuel softlock: the fuel is the checkpoint's, so is the fuel line);
 *  - objectives complete at the checkpoint, plus plantBeacons ones the kept
 *    beacons satisfy (completed silently: no repeated chime / banner);
 *  - the modeSwitch is done (no second switch / cutscene) and a seizeCsm
 *    creature's sequence is over;
 *  - the clock: elapsed time carries on (every life counts toward the result time).
 * Fuel / hull are captured with floors (CHECKPOINT_MIN_FUEL / _HULL): a seizure on
 * an empty tank or a wrecked hull would otherwise respawn into a crash loop.
 * The checkpointReached event waits for the next step() after the switch: the App
 * steps nothing during the mid-level cutscene and the controls card, so its chime /
 * banner land when play resumes. A resting respawn settles silently (the first
 * touchdown's impact / softLand events are dropped).
 * Everything else (doors, islands, wind schedules, debris ...) starts fresh.
 */

import { FIXED_DT } from '../contracts';
import type {
  CheckpointSpec,
  GameEvent,
  GameEventSink,
  InputFrame,
  LevelOutcome,
  LevelSpec,
  ExitDockEntity,
  Vec2,
  VesselMode,
  VesselSpawn,
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

/**
 * Round 12 checkpoint floors (fraction). Fuel: floatingIsles' lander (burnSeconds 85)
 * drains 1/85 per second with both engines lit, so 0.35 is ~30 s of full burn; the
 * respawn's hop to beacon 1 and on to fuel1 (x 7700, ~720 px) needs a fraction of that
 * (test/checkpoint.test.ts flies it from the floor). Hull: 0.5 survives any single
 * damaging hit (lander hitDamage tops out at 0.4 just below the crash speed).
 */
export const CHECKPOINT_MIN_FUEL = 0.35;
export const CHECKPOINT_MIN_HULL = 0.5;
/** Seconds a resting respawn may take to settle before its contact events count again. */
const RESPAWN_SETTLE_SEC = 1;

/** How far outside the world rect (px) the vessel may go before it is lost. */
const OUT_OF_BOUNDS_MARGIN = 64;

/** Round 12: a captured checkpoint (LevelSpec.checkpoints). */
export interface CheckpointState {
  id: string;
  mode: VesselMode;
  /** Respawn pose + the fuel / hull at capture (velocity zero). */
  spawn: VesselSpawn;
  /** The respawn is a resting spot (CheckpointSpec.respawn): play resumes without the controls card. */
  resting: boolean;
  /** Pickups taken before the checkpoint (they stay taken; later ones are back after a respawn). */
  pickups: string[];
  /** Objectives complete at capture. */
  completed: string[];
}

/** Round 12: what a crash after a checkpoint leaves for the retry. */
export interface RespawnState {
  checkpoint: CheckpointState;
  /** Beacons planted at the crash (all kept). */
  planted: string[];
  /** Level seconds flown up to the crash (every life): the run's clock carries on. */
  elapsed: number;
}

/** Round 12: LevelSession.resumeInfo() - a checkpoint respawn as the UI needs it. */
export interface ResumeInfo {
  mode: VesselMode;
  pose: { x: number; y: number; angle: number };
  fuel: number;
  hull: number;
  /** Beacon site ids planted (kept). */
  planted: string[];
  completed: string[];
  orbs: number;
  score: number;
  /** Level seconds of the earlier lives. */
  time: number;
  /** Resumes on a resting spot: no controls card (the player starts when ready). */
  resting: boolean;
}

export class LevelSession {
  readonly camera: Camera;
  private vesselState: VesselState;
  private _outcome: LevelOutcome | null = null;
  private readonly completed = new Set<string>();
  private readonly listeners: GameEventSink[] = [];

  /** `respawn` (round 12): resume from a checkpoint (a crashed session's respawnState()) instead of the level start. */
  static async create(spec: LevelSpec, respawn: RespawnState | null = null): Promise<LevelSession> {
    // felt gravity (GRAVITY_TUNING.scale); GravityField keeps it current from the first step on
    const physics = await PhysicsWorld.create({ gravity: feltGravity(spec.gravity, resolveTuning(spec.physicsOverrides).gravity.scale), hitSpeedThreshold: 0.5 });
    return new LevelSession(spec, physics, respawn);
  }

  /** Round 12: a resting respawn settling (its first impact / softLand are dropped). */
  private settling = false;
  /** Round 12: checkpointReached waiting for the next step (after the cutscene / controls card). */
  private pendingCheckpointEvent: string | null = null;
  /** Round 12: the latest checkpoint reached (or resumed from), null = none yet. */
  checkpoint: CheckpointState | null = null;
  /** Level seconds flown before this session (a checkpoint respawn), added to simTime for the result. */
  private readonly timeOffset: number;

  /** The active vessel (replaced on a mode switch). */
  vessel: FlightVessel;
  readonly built: BuiltLevel;
  readonly env: FlightEnvironment;
  /** Level-owned entities the flight environment leaves unhandled (doors, islands, vines, creatures). */
  readonly runtime: LevelRuntime;
  readonly tuning: PhysicsTuning;
  private readonly vesselOptions: VesselOptions;
  private readonly sink: GameEventSink;
  private modeSwitchLatch: TriggerLatch | null;
  private pendingMode: VesselMode | null = null;
  /** Level-owned systems (S7). */
  readonly systems: LevelSystems;

  private constructor(
    readonly spec: LevelSpec,
    readonly physics: PhysicsWorld,
    /** Round 12: the checkpoint respawn this session started from (null = the level start). */
    readonly respawnedFrom: RespawnState | null = null,
  ) {
    this.built = buildLevel(physics, spec);
    this.sink = (e) => {
      // a resting respawn's first touchdown is silent (no thud / dust on every retry)
      if (this.settling && (e.type === 'impact' || e.type === 'softLand')) {
        if (e.type === 'softLand') this.settling = false;
        return;
      }
      this.emit(e);
    };
    this.tuning = resolveTuning(spec.physicsOverrides);
    this.vesselOptions = vesselOptionsFor(spec, this.tuning);
    this.env = new FlightEnvironment(physics, spec, flightLevelBodies(this.built), this.tuning, this.sink, () => this.completed);
    const cp = respawnedFrom?.checkpoint ?? null;
    this.vessel = createVessel(
      cp ? cp.mode : spec.vesselMode,
      physics,
      cp ? { ...cp.spawn, pos: { ...cp.spawn.pos }, vel: { x: 0, y: 0 } } : { pos: { x: spec.spawn.x, y: spec.spawn.y }, angle: spec.spawn.angle ?? 0, fuel: spec.startFuel ?? 1 },
      this.sink,
      this.vesselOptions,
    );
    this.timeOffset = respawnedFrom ? respawnedFrom.elapsed : 0;
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
    if (respawnedFrom) this.restore(respawnedFrom);
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

  /** Emit the levelStarted event (call once listeners are attached). The mode is the vessel's (a checkpoint respawn's, too). */
  start(): void {
    this.emit({ type: 'levelStarted', levelId: this.spec.id, themeId: this.spec.themeId, mode: this.vessel.mode });
  }

  /** Level seconds flown in this run: earlier lives (checkpoint respawns) + this session. */
  get elapsed(): number {
    return this.timeOffset + this.physics.simTime;
  }

  /** Objective ids complete so far. */
  get completedObjectives(): readonly string[] {
    return [...this.completed];
  }

  /** Round 12: what a retry after this session resumes from, or null (no checkpoint reached: a full restart). */
  respawnState(): RespawnState | null {
    if (!this.checkpoint) return null;
    return { checkpoint: this.checkpoint, planted: this.env.beacons.plantedIds(), elapsed: this.elapsed };
  }

  /**
   * Round 12: for a session started from a checkpoint respawn, what the UI seeds its HUD /
   * minimap / controls card from (restored silently, so no events tell it). null otherwise.
   */
  resumeInfo(): ResumeInfo | null {
    const r = this.respawnedFrom;
    if (!r) return null;
    const v = this.vesselState;
    return {
      mode: v.mode,
      pose: { x: v.pos.x, y: v.pos.y, angle: v.angle },
      fuel: v.fuel,
      hull: v.hull,
      planted: this.env.beacons.plantedIds(),
      completed: [...this.completed],
      orbs: this.env.pickups.orbsCollected,
      score: this.env.pickups.points,
      time: r.elapsed,
      resting: r.checkpoint.resting,
    };
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
    if (this.pendingCheckpointEvent !== null) {
      const id = this.pendingCheckpointEvent;
      this.pendingCheckpointEvent = null;
      this.emit({ type: 'checkpointReached', checkpointId: id });
    }
    if (this.settling && this.physics.simTime >= RESPAWN_SETTLE_SEC) this.settling = false;
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
    if (to === this.spec.modeSwitch?.to) for (const c of this.spec.checkpoints ?? []) if (c.at === 'modeSwitch') this.capture(c);
  }

  // ------------------------------------------------------------ internals

  /** Round 12: record checkpoint `c` from the current vessel / level state. */
  private capture(c: CheckpointSpec): void {
    if (this.checkpoint?.id === c.id) return;
    const snap = this.vessel.snapshot();
    const r = c.respawn;
    this.checkpoint = {
      id: c.id,
      mode: this.vessel.mode,
      spawn: { pos: r ? { x: r.x, y: r.y } : { ...snap.pos }, angle: r ? (r.angle ?? 0) : (snap.angle ?? 0), vel: { x: 0, y: 0 }, fuel: Math.max(CHECKPOINT_MIN_FUEL, snap.fuel ?? 1), hull: Math.max(CHECKPOINT_MIN_HULL, snap.hull ?? 1) },
      resting: !!r,
      pickups: this.env.pickups.collectedIds(),
      completed: [...this.completed],
    };
    this.pendingCheckpointEvent = c.id; // emitted on the next step: see the header
  }

  /** Round 12: seed a fresh session with a checkpoint respawn (silently: no events). See the header. */
  private restore(r: RespawnState): void {
    const cp = r.checkpoint;
    this.checkpoint = cp;
    this.settling = cp.resting;
    this.env.pickups.restoreCollected(cp.pickups);
    this.env.beacons.restorePlanted(r.planted);
    for (const id of cp.completed) this.completed.add(id);
    for (const o of this.spec.objectives) {
      if (o.kind === 'plantBeacons' && o.siteIds.filter((id) => this.env.beacons.isPlanted(id)).length >= o.count) this.completed.add(o.id);
    }
    // the switch the checkpoint was captured at has happened (no second switch / cutscene)
    if (cp.mode !== this.spec.vesselMode) this.modeSwitchLatch = null;
    if (cp.mode !== 'csm') this.runtime.creatures.retireSeizers();
  }

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
      const timeSec = this.elapsed;
      const orbs = this.env.pickups.orbsCollected;
      const score = Math.round(1000 + s.fuel * 500 + s.hull * 500 + this.env.pickups.points);
      this._outcome = { kind: 'complete', timeSec, orbs, score };
      this.emit({ type: 'levelComplete', levelId: this.spec.id, timeSec, orbs, score });
    }
  }
}

const SUPPORTED_OBJECTIVES: ReadonlySet<string> = new Set(['reachExit', 'plantBeacons', 'collectOrbs', 'surviveBoss']);


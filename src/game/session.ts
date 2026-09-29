/**
 * One play-through of a level: physics world + vessel + camera + objective
 * bookkeeping, advanced one fixed step at a time. Rendering reads it (see
 * src/render/levelView.ts); it never touches the DOM, so it runs in tests.
 *
 * S0 scope: world gravity (+ ramp), terrain/props, the placeholder vessel,
 * reachExit objectives, out-of-bounds crash. Later slices plug in the real
 * controllers, zones, entities and objectives.
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
  VesselState,
} from '../contracts';
import { PhysicsWorld } from '../physics/engine';
import { buildLevel, type BuiltLevel } from '../levels/build';
import { Camera } from '../shell/camera';
import { PlaceholderVessel } from './placeholderVessel';

/** How far outside the world rect (px) the vessel may go before it is lost. */
const OUT_OF_BOUNDS_MARGIN = 64;

export class LevelSession {
  readonly camera: Camera;
  private vesselState: VesselState;
  private _outcome: LevelOutcome | null = null;
  private readonly completed = new Set<string>();
  private readonly listeners: GameEventSink[] = [];

  static async create(spec: LevelSpec): Promise<LevelSession> {
    const physics = await PhysicsWorld.create({ gravity: spec.gravity, hitSpeedThreshold: 0.5 });
    return new LevelSession(spec, physics);
  }

  readonly vessel: PlaceholderVessel;
  readonly built: BuiltLevel;

  private constructor(
    readonly spec: LevelSpec,
    readonly physics: PhysicsWorld,
  ) {
    this.built = buildLevel(physics, spec);
    const sink: GameEventSink = (e) => this.emit(e);
    this.vessel = new PlaceholderVessel(
      physics,
      { pos: { x: spec.spawn.x, y: spec.spawn.y }, angle: spec.spawn.angle ?? 0, fuel: spec.startFuel ?? 1 },
      sink,
      spec.vesselMode,
    );
    this.camera = new Camera({
      worldW: spec.worldSize.w,
      worldH: spec.worldSize.h,
      bias: spec.camera?.bias ?? 'horizontal',
      lookAheadMax: spec.camera?.lookAhead ?? 60,
    });
    this.vesselState = this.vessel.state();
    this.camera.snap(this.vesselState.pos);
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

  /** Advance one fixed step with this tick's input. No-op once the level has an outcome. */
  step(frame: InputFrame): void {
    if (this._outcome) {
      this.camera.step(null);
      return;
    }
    this.applyGravityRamp();
    this.vessel.applyInput(frame, FIXED_DT);
    this.physics.step(FIXED_DT);
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
    this.physics.destroy();
  }

  // ------------------------------------------------------------ internals

  private emit(e: GameEvent): void {
    for (const fn of [...this.listeners]) fn(e);
    if (e.type === 'crash' && !this._outcome) {
      this._outcome = { kind: 'failed', cause: e.cause };
      this.emit({ type: 'levelFailed', levelId: this.spec.id, cause: e.cause });
    }
  }

  private applyGravityRamp(): void {
    const r = this.spec.gravityRamp;
    if (!r) return;
    const p = r.axis === 'x' ? this.vesselState.pos.x : this.vesselState.pos.y;
    const t = Math.min(1, Math.max(0, (p - r.from) / (r.to - r.from)));
    const g = { x: r.gravityFrom.x + (r.gravityTo.x - r.gravityFrom.x) * t, y: r.gravityFrom.y + (r.gravityTo.y - r.gravityFrom.y) * t };
    const cur = this.physics.getGravity();
    if (Math.abs(cur.x - g.x) + Math.abs(cur.y - g.y) > 1e-3) {
      this.physics.setGravity(g);
      // (gravityChanged events are the physics slice's job; S0 only drives the ramp)
    }
  }

  private outOfBounds(p: Vec2): boolean {
    const m = OUT_OF_BOUNDS_MARGIN;
    return p.x < -m || p.y < -m || p.x > this.spec.worldSize.w + m || p.y > this.spec.worldSize.h + m;
  }

  private checkObjectives(s: VesselState): void {
    for (const o of this.spec.objectives) {
      if (this.completed.has(o.id) || o.kind !== 'reachExit') continue;
      const exit = this.spec.entities.find((e): e is ExitDockEntity => e.kind === 'exitDock' && e.id === o.exitId);
      if (!exit || !inExit(exit, s)) continue;
      this.completed.add(o.id);
      this.emit({ type: 'objectiveComplete', objectiveId: o.id });
    }
    const supported = this.spec.objectives.filter((o) => o.kind === 'reachExit');
    if (supported.length > 0 && supported.length === this.spec.objectives.length && supported.every((o) => this.completed.has(o.id))) {
      const timeSec = this.physics.simTime;
      const score = Math.round(1000 + s.fuel * 500 + s.hull * 500);
      this._outcome = { kind: 'complete', timeSec, orbs: 0, score };
      this.emit({ type: 'levelComplete', levelId: this.spec.id, timeSec, orbs: 0, score });
    }
  }
}

/** Exit rect: centred on (x, y) horizontally, extending h px ABOVE the landing surface. */
function inExit(exit: ExitDockEntity, s: VesselState): boolean {
  const inRect = s.pos.x >= exit.x - exit.w / 2 && s.pos.x <= exit.x + exit.w / 2 && s.pos.y <= exit.y && s.pos.y >= exit.y - exit.h;
  if (!inRect) return false;
  if (exit.requireLanding && !s.landed) return false;
  if (exit.maxSpeed !== undefined && Math.hypot(s.vel.x, s.vel.y) > exit.maxSpeed) return false;
  if (exit.maxAngle !== undefined && Math.abs(s.angle) > exit.maxAngle) return false;
  return true;
}

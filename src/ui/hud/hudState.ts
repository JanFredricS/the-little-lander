/**
 * HUD model: a pure reducer over GameEvents plus a per-tick VesselState poll.
 * No Pixi / DOM here, so it is unit-tested directly from event streams.
 *
 *   let s = initHud(spec);
 *   s = hudReduce(s, event);          // every GameEvent
 *   s = hudTick(s, vesselState, dt);  // every fixed step (dt = FIXED_DT)
 *
 * Timers (wind/radiation telegraphs, hit flashes) run on SIMULATION time
 * (they only advance in hudTick), so pausing freezes them.
 */

import type { ExitDockEntity, GameEvent, LevelId, LevelSpec, ObjectiveSpec, Vec2, VesselMode, VesselState } from '../../contracts';
import { exitGate, exitHintText } from '../../game/exitGate';

/** Fuel fraction below which the fuel bar flashes. */
export const FUEL_LOW = 0.25;
/** Hull fraction below which the hull bar turns red. */
export const HULL_LOW = 0.3;
/** Seconds a wind 'warning' with no follow-up stays on screen. */
export const WIND_WARNING_TTL = 4;
/** Seconds a wind 'start' with no 'end' stays on screen. */
export const WIND_ACTIVE_TTL = 10;
/** Seconds a radiation telegraph stays (at 0.0s) after its countdown ends when no hit is reported. */
export const RADIATION_GRACE = 0.5;
/** Seconds the "radiation hit" flash stays on screen. */
export const RADIATION_HIT_FLASH = 1.5;
/** Seconds the objective-complete banner stays on screen. */
export const BANNER_TTL = 2.5;
/**
 * Seconds the vessel must stay inside the exit rect, held back by a gate, before
 * the hint shows: a normal landing on a requireLanding pad passes through 'land'
 * for its last moments and must not flash a centre-screen warning.
 */
export const EXIT_HINT_GRACE = 0.6;

export interface HudObjective {
  id: string;
  kind: ObjectiveSpec['kind'];
  label: string;
  progress: number;
  total: number;
  done: boolean;
}

export interface HudWind {
  zoneId: string;
  phase: 'warning' | 'start';
  /** m/s², world (y-down). */
  accel: Vec2;
  /** Seconds left before this indicator self-clears (safety net). */
  ttl: number;
}

export interface HudRadiation {
  emitterId: string;
  /** Seconds until the pulse (counts down in hudTick). */
  inSec: number;
  /** Seconds past the end of the countdown (grace for the blast to land). */
  overdue?: number;
}

export interface HudState {
  levelId: LevelId | null;
  mode: VesselMode;
  fuel: number;
  hull: number;
  attachedGoo: number;
  crashed: boolean;
  landed: boolean;
  orbs: number;
  score: number;
  /** Total collectOrbs target, or 0 when the level has no orb objective. */
  orbTarget: number;
  beacons: { planted: number; total: number } | null;
  objectives: HudObjective[];
  wind: HudWind | null;
  radiation: HudRadiation | null;
  /** Seconds left on the "radiation hit" flash (0 = none). */
  radiationHit: number;
  radiationFuelLost: number;
  /** Boss hp 0..1 when a boss fight is active. */
  bossHp: number | null;
  /** Short-lived banner text (objective complete etc.). */
  banner: { text: string; ttl: number } | null;
  /** Simulation seconds since level start. */
  time: number;
  /** The reachExit objective's exit dock (null = none): the minimap marks it, the gate hint reads it. */
  exit: ExitDockEntity | null;
  /** The reachExit objective's id (its exit stops hinting once it is done). */
  exitObjectiveId: string | null;
  /**
   * Round 8 (no silent exit failure): the vessel is inside the exit rect but a gate
   * (landing / speed / angle) still holds it back - why, as HUD text. null otherwise.
   * Shown only after EXIT_HINT_GRACE s inside the rect failing a gate; once shown it
   * stays (a bounce that briefly reads 'ok' does not blink it) until the vessel leaves
   * the rect, crashes or the exit objective completes.
   */
  exitHint: string | null;
  /** Sim seconds spent inside the exit rect held back by a gate (reset when it leaves). */
  exitHeld: number;
}

export function objectiveLabel(o: ObjectiveSpec): string {
  switch (o.kind) {
    case 'reachExit':
      return 'REACH THE EXIT';
    case 'plantBeacons':
      return 'BEACONS';
    case 'collectOrbs':
      return 'ORBS';
    case 'surviveBoss':
      return 'DEFEAT THE KEEPER';
  }
}

function objectiveTotal(o: ObjectiveSpec): number {
  return o.kind === 'plantBeacons' || o.kind === 'collectOrbs' ? o.count : 1;
}

export function initHud(spec?: Pick<LevelSpec, 'id' | 'vesselMode' | 'objectives' | 'startFuel'> & Partial<Pick<LevelSpec, 'entities'>>): HudState {
  const objectives: HudObjective[] = (spec?.objectives ?? []).map((o) => ({
    id: o.id,
    kind: o.kind,
    label: objectiveLabel(o),
    progress: 0,
    total: objectiveTotal(o),
    done: false,
  }));
  const beaconObj = spec?.objectives.find((o) => o.kind === 'plantBeacons');
  const orbObj = spec?.objectives.find((o) => o.kind === 'collectOrbs');
  const exitObj = spec?.objectives.find((o) => o.kind === 'reachExit');
  const exit = exitObj && exitObj.kind === 'reachExit' ? (spec?.entities?.find((e): e is ExitDockEntity => e.kind === 'exitDock' && e.id === exitObj.exitId) ?? null) : null;
  return {
    levelId: spec?.id ?? null,
    mode: spec?.vesselMode ?? 'lander',
    fuel: spec?.startFuel ?? 1,
    hull: 1,
    attachedGoo: 0,
    crashed: false,
    landed: false,
    orbs: 0,
    score: 0,
    orbTarget: orbObj && orbObj.kind === 'collectOrbs' ? orbObj.count : 0,
    beacons: beaconObj && beaconObj.kind === 'plantBeacons' ? { planted: 0, total: beaconObj.count } : null,
    objectives,
    wind: null,
    radiation: null,
    radiationHit: 0,
    radiationFuelLost: 0,
    bossHp: null,
    banner: null,
    time: 0,
    exit,
    exitObjectiveId: exit && exitObj ? exitObj.id : null,
    exitHint: null,
    exitHeld: 0,
  };
}

/** Round 12: what a checkpoint respawn carries over (LevelSession.respawnState, seeded silently: no events replay). */
export interface HudResume {
  mode: VesselMode;
  fuel: number;
  hull: number;
  /** Beacon site ids planted (kept across the respawn). */
  planted: readonly string[];
  /** Objective ids already complete. */
  completed: readonly string[];
  /** Orbs / points of the pickups kept taken. */
  orbs: number;
  score: number;
  /** Elapsed level seconds of the earlier lives. */
  time: number;
}

/** Round 12: initHud(spec) seeded with a checkpoint respawn, plus the CHECKPOINT banner. */
export function initHudResume(spec: Parameters<typeof initHud>[0] & {}, r: HudResume): HudState {
  const s = initHud(spec);
  const done = new Set(r.completed);
  const planted = r.planted.length;
  return {
    ...s,
    mode: r.mode,
    fuel: clamp01(r.fuel),
    hull: clamp01(r.hull),
    orbs: r.orbs,
    score: r.score,
    time: r.time,
    beacons: s.beacons ? { ...s.beacons, planted } : null,
    objectives: s.objectives.map((o) => {
      const progress = o.kind === 'plantBeacons' ? Math.min(o.total, planted) : o.kind === 'collectOrbs' ? Math.min(o.total, r.orbs) : o.progress;
      return done.has(o.id) ? { ...o, done: true, progress: o.total } : { ...o, progress };
    }),
    banner: { text: CHECKPOINT_BANNER, ttl: BANNER_TTL },
  };
}

/** Round 12: the banner at a checkpoint capture and on a respawn there. */
export const CHECKPOINT_BANNER = 'CHECKPOINT';

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

function mapObjectives(s: HudState, kind: HudObjective['kind'], f: (o: HudObjective) => HudObjective): HudObjective[] {
  return s.objectives.map((o) => (o.kind === kind ? f(o) : o));
}

/** Apply one GameEvent. Returns a new state (or the same object if nothing changed). */
export function hudReduce(s: HudState, e: GameEvent): HudState {
  switch (e.type) {
    case 'levelStarted':
      return { ...s, levelId: e.levelId, mode: e.mode };
    case 'fuelChanged':
      return { ...s, fuel: clamp01(e.fuel) };
    case 'hullChanged':
      return { ...s, hull: clamp01(e.hull) };
    case 'gooAttached':
    case 'gooBurned':
      return { ...s, attachedGoo: Math.max(0, e.attached) };
    case 'vesselModeChanged':
      return { ...s, mode: e.to };
    case 'crash':
      return { ...s, crashed: true, wind: null, radiation: null };
    case 'softLand':
      return { ...s, landed: true };
    case 'orbCollected': {
      const orbs = s.orbs + 1;
      return {
        ...s,
        orbs,
        score: s.score + e.points,
        objectives: mapObjectives(s, 'collectOrbs', (o) => ({ ...o, progress: Math.min(o.total, orbs) })),
      };
    }
    case 'beaconPlanted':
      return {
        ...s,
        beacons: { planted: e.planted, total: e.total },
        objectives: mapObjectives(s, 'plantBeacons', (o) => ({ ...o, progress: e.planted, total: e.total })),
        banner: { text: `BEACON ${e.planted}/${e.total} PLANTED`, ttl: BANNER_TTL },
      };
    case 'objectiveComplete': {
      const target = s.objectives.find((o) => o.id === e.objectiveId);
      if (!target) return s;
      return {
        ...s,
        objectives: s.objectives.map((o) => (o.id === e.objectiveId ? { ...o, done: true, progress: o.total } : o)),
        banner: { text: 'OBJECTIVE COMPLETE', ttl: BANNER_TTL },
      };
    }
    case 'windGust':
      if (e.phase === 'end') return s.wind && s.wind.zoneId === e.zoneId ? { ...s, wind: null } : s;
      return { ...s, wind: { zoneId: e.zoneId, phase: e.phase, accel: { ...e.accel }, ttl: e.phase === 'warning' ? WIND_WARNING_TTL : WIND_ACTIVE_TTL } };
    case 'radiationCharging':
      return { ...s, radiation: { emitterId: e.emitterId, inSec: Math.max(0, e.inSec) } };
    case 'radiationHit':
      return {
        ...s,
        radiation: s.radiation && s.radiation.emitterId === e.emitterId ? null : s.radiation,
        radiationHit: RADIATION_HIT_FLASH,
        radiationFuelLost: e.fuelLost,
      };
    case 'bossPhase':
      return { ...s, bossHp: clamp01(e.hp), banner: { text: `PHASE ${e.phase}`, ttl: BANNER_TTL } };
    case 'bossHit':
      return { ...s, bossHp: clamp01(e.hp) };
    case 'bossDefeated':
      return {
        ...s,
        bossHp: 0,
        objectives: mapObjectives(s, 'surviveBoss', (o) => ({ ...o, done: true, progress: o.total })),
      };
    case 'checkpointReached':
      return { ...s, banner: { text: CHECKPOINT_BANNER, ttl: BANNER_TTL } };
    case 'levelComplete':
      return { ...s, orbs: e.orbs, score: e.score };
    default:
      return s;
  }
}

/** Poll the vessel (authoritative for fuel/hull/goo/mode) and advance timers by dt sim-seconds. */
export function hudTick(s: HudState, v: VesselState | null, dt: number): HudState {
  const next: HudState = { ...s, time: s.time + dt };
  if (v) {
    next.fuel = clamp01(v.fuel);
    next.hull = clamp01(v.hull);
    next.attachedGoo = Math.max(0, v.attachedGoo);
    next.mode = v.mode;
    next.crashed = v.crashed;
    next.landed = v.landed;
    const g = s.exit && !v.crashed && !s.objectives.some((o) => o.id === s.exitObjectiveId && o.done) ? exitGate(s.exit, v) : 'out';
    if (g === 'out') {
      next.exitHeld = 0;
      next.exitHint = null;
    } else if (g === 'ok') {
      // completing this step (the objective clears it next tick) or a bounce: keep what is shown
    } else {
      next.exitHeld = s.exitHeld + dt;
      if (next.exitHeld >= EXIT_HINT_GRACE - 1e-9) next.exitHint = exitHintText(g);
    }
  }
  if (s.wind) {
    const ttl = s.wind.ttl - dt;
    next.wind = ttl > 0 ? { ...s.wind, ttl } : null;
  }
  if (s.radiation) {
    const overdue = (s.radiation.overdue ?? 0) + Math.max(0, dt - s.radiation.inSec);
    // No radiationHit (vessel was in cover / out of range): clear shortly after the pulse.
    next.radiation = overdue > RADIATION_GRACE ? null : { ...s.radiation, inSec: Math.max(0, s.radiation.inSec - dt), overdue };
  }
  if (s.radiationHit > 0) next.radiationHit = Math.max(0, s.radiationHit - dt);
  if (s.banner) {
    const ttl = s.banner.ttl - dt;
    next.banner = ttl > 0 ? { ...s.banner, ttl } : null;
  }
  return next;
}

/** Derived flags the view needs. `blink` = a 0/1 phase from any clock (visual only). */
export function fuelLow(s: HudState): boolean {
  return s.fuel < FUEL_LOW;
}

/** 8-way arrow direction for a wind acceleration (screen, y-down), or null for calm. */
export function windArrow(accel: Vec2): 'left' | 'right' | 'up' | 'down' | 'upLeft' | 'upRight' | 'downLeft' | 'downRight' | null {
  const len = Math.hypot(accel.x, accel.y);
  if (len < 1e-6) return null;
  const a = Math.atan2(accel.y, accel.x); // 0 = right, +pi/2 = down
  const oct = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  return (['right', 'downRight', 'down', 'downLeft', 'left', 'upLeft', 'up', 'upRight'] as const)[oct]!;
}

/** Objective tracker lines (right-aligned column in the HUD). */
export function objectiveLines(s: HudState): { text: string; done: boolean }[] {
  return s.objectives.map((o) => {
    if (o.kind === 'plantBeacons' || o.kind === 'collectOrbs') return { text: `${o.label} ${o.progress}/${o.total}`, done: o.done };
    return { text: o.label, done: o.done };
  });
}

export const MODE_LABEL: Record<VesselMode, string> = {
  csm: 'CSM',
  lander: 'LANDER',
  harpoon: 'HARPOON',
  harpoonThrust: 'HARPOON+THR',
};

/**
 * FROZEN (S0). Gameplay events. Emitted synchronously during a fixed step
 * (by vessel controllers, level objective logic, the boss, the cutscene
 * player) into a GameEventSink; consumed by HUD, audio, FX, progress/saves.
 *
 * Positions are WORLD PX. Events are plain JSON-serialisable objects.
 */

import type { LevelId, Vec2 } from './common';
import type { CutsceneId } from './cutscene';
import type { VesselMode } from './physics';
import type { ThemeId } from './art';

export type CrashCause =
  | 'impact' // hit something too hard
  | 'hullDestroyed' // hull reached 0 from accumulated damage
  | 'outOfBounds' // left the world rect (fell / floated away)
  | 'crushed' // blast door, collapsing rock
  | 'boss';

export type FuelChangeReason = 'burn' | 'pickup' | 'orb' | 'radiation' | 'refill';
export type HullChangeReason = 'impact' | 'debris' | 'goo' | 'boss' | 'repair';

export type GameEvent =
  | { type: 'levelStarted'; levelId: LevelId; themeId: ThemeId; mode: VesselMode }
  | { type: 'crash'; cause: CrashCause; pos: Vec2; speed: number }
  /** Touched down upright and slow. siteId = beacon site / exit dock entity id when landed on one. */
  | { type: 'softLand'; pos: Vec2; siteId?: string }
  | { type: 'beaconPlanted'; siteId: string; planted: number; total: number }
  | { type: 'orbCollected'; entityId: string; points: number; fuelRefill: number }
  | { type: 'fuelChanged'; fuel: number; delta: number; reason: FuelChangeReason }
  | { type: 'hullChanged'; hull: number; delta: number; reason: HullChangeReason }
  /** Radiation telegraph: a pulse fires in `inSec` seconds. */
  | { type: 'radiationCharging'; emitterId: string; inSec: number }
  | { type: 'radiationHit'; emitterId: string; fuelLost: number }
  /** Wind telegraph / start / end. accel in m/s². */
  | { type: 'windGust'; zoneId: string; phase: 'warning' | 'start' | 'end'; accel: Vec2 }
  /** Effective gravity on the vessel changed noticeably (ramp progress, zone entry/exit). progress = ramp 0..1 if a ramp exists. */
  | { type: 'gravityChanged'; gravity: Vec2; rampProgress?: number }
  /** Engine flags changed (thruster loop SFX / flames). */
  | { type: 'enginesChanged'; main: boolean; left: boolean; right: boolean }
  /** Any vessel collision above a small speed (SFX/FX); damage is reported separately via hullChanged. */
  | { type: 'impact'; pos: Vec2; speed: number; with: string }
  | { type: 'gooAttached'; gooId: number; attached: number }
  | { type: 'gooBurned'; gooId: number; attached: number }
  | { type: 'harpoonFired'; gun: number; dir: Vec2 }
  | { type: 'harpoonMissed'; gun: number }
  | { type: 'ropeAttached'; gun: number; anchor: Vec2; brittle: boolean }
  | { type: 'ropeBroken'; gun: number; reason: 'brittle' | 'overload' }
  | { type: 'ropeReleased'; gun: number }
  | { type: 'vesselModeChanged'; from: VesselMode; to: VesselMode }
  | { type: 'objectiveComplete'; objectiveId: string }
  | { type: 'levelComplete'; levelId: LevelId; timeSec: number; orbs: number; score: number }
  | { type: 'levelFailed'; levelId: LevelId; cause: CrashCause }
  /** Boss entered phase 1..3. hp 0..1. */
  | { type: 'bossPhase'; phase: number; hp: number }
  | { type: 'bossHit'; damage: number; hp: number; source: 'rock' | 'exhaust' }
  | { type: 'bossDefeated' }
  | { type: 'cutsceneDone'; cutsceneId: CutsceneId; skipped: boolean };

export type GameEventType = GameEvent['type'];

/** Narrow a GameEvent by its type. */
export type GameEventOf<T extends GameEventType> = Extract<GameEvent, { type: T }>;

export type GameEventSink = (event: GameEvent) => void;

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

export type CrashCause =
  | 'impact' // hit something too hard
  | 'hullDestroyed' // hull reached 0 from accumulated damage
  | 'outOfBounds' // left the world rect (fell / floated away)
  | 'crushed' // blast door, collapsing rock
  | 'boss';

export type FuelChangeReason = 'burn' | 'pickup' | 'orb' | 'radiation' | 'refill';
export type HullChangeReason = 'impact' | 'debris' | 'goo' | 'boss' | 'repair';

export type GameEvent =
  | { type: 'crash'; cause: CrashCause; pos: Vec2; speed: number }
  /** Touched down upright and slow. siteId = beacon site / exit dock entity id when landed on one. */
  | { type: 'softLand'; pos: Vec2; siteId?: string }
  | { type: 'beaconPlanted'; siteId: string; planted: number; total: number }
  | { type: 'orbCollected'; entityId: string; points: number; fuelRefill: number }
  | { type: 'fuelChanged'; fuel: number; delta: number; reason: FuelChangeReason }
  | { type: 'hullChanged'; hull: number; delta: number; reason: HullChangeReason }
  | { type: 'radiationHit'; emitterId: string; fuelLost: number }
  | { type: 'gooAttached'; gooId: number; attached: number }
  | { type: 'gooBurned'; gooId: number; attached: number }
  | { type: 'ropeAttached'; gun: number; anchor: Vec2; brittle: boolean }
  | { type: 'ropeBroken'; gun: number; reason: 'brittle' | 'overload' }
  | { type: 'ropeReleased'; gun: number }
  | { type: 'vesselModeChanged'; from: VesselMode; to: VesselMode }
  | { type: 'objectiveComplete'; objectiveId: string }
  | { type: 'levelComplete'; levelId: LevelId; timeSec: number; orbs: number; score: number }
  | { type: 'levelFailed'; levelId: LevelId; cause: CrashCause }
  | { type: 'bossPhase'; phase: number; hp: number }
  | { type: 'cutsceneDone'; cutsceneId: CutsceneId; skipped: boolean };

export type GameEventType = GameEvent['type'];

/** Narrow a GameEvent by its type. */
export type GameEventOf<T extends GameEventType> = Extract<GameEvent, { type: T }>;

export type GameEventSink = (event: GameEvent) => void;

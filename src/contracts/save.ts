/**
 * FROZEN (S0). Persistent progress (localStorage key 'the-little-lander/save').
 * Readers must accept older/partial data: validate, then fill defaults.
 */

import type { LevelId } from './common';
import type { CutsceneId } from './cutscene';

export const SAVE_VERSION = 1;
export const SAVE_STORAGE_KEY = 'the-little-lander/save';

export interface LevelBest {
  /** Fastest completion (simulation seconds). */
  timeSec: number;
  /** Most orbs collected in one completion. */
  orbs: number;
  score: number;
}

export interface Settings {
  /** 0..1. */
  musicVolume: number;
  sfxVolume: number;
  /** Reduce screen shake / flashes. */
  reducedMotion: boolean;
  /** Force on-screen touch controls on/off; 'auto' = show on coarse pointers. */
  touchControls: 'auto' | 'on' | 'off';
  /** Debug overlay (fps, physics shapes). */
  debugOverlay: boolean;
}

export interface SaveState {
  version: typeof SAVE_VERSION;
  /** Levels the player may start (story order; 'hangarRun' always). */
  unlocked: LevelId[];
  /** Per-level bests (completed levels only). */
  best: Partial<Record<LevelId, LevelBest>>;
  /** Cutscenes already seen (skippable on replay). */
  seenCutscenes: CutsceneId[];
  settings: Settings;
}

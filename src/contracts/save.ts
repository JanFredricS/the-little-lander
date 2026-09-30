/**
 * FROZEN (S0; S9 amendment: Settings.swapEngineButtons; feel-pass amendments: Settings.showFps, Settings.lowRes; direct-steering amendment: Settings.steering). Persistent progress (localStorage key 'the-little-lander/save').
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
  /**
   * S9 amendment. The LEFT engine button fires
   * the RIGHT engine and vice versa (tilt toward the button you press); the
   * top-thruster buttons follow the same swap. Applies to the on-screen
   * touch buttons AND (feel pass) the keyboard lander keys.
   * Default true; older saves without the field read as true.
   */
  swapEngineButtons: boolean;
  /** Small FPS / frame-time readout in the top-right corner (pause menu toggle). Default false. */
  showFps: boolean;
  /**
   * Low-res mode (pause menu): render the game at the virtual 640×360 and let
   * the browser upscale it (pixelated) instead of rendering every device
   * pixel - ~9× fewer pixels on a DPR-3 phone. null = the player never chose:
   * the App follows the device on every start (touch ON / desktop OFF, and ON
   * after a first real touch). Only a pause-menu toggle saves true/false.
   */
  lowRes: boolean | null;
  /**
   * Flight control scheme (pause menu STEERING). 'engines' = the classic
   * per-engine / rotate controls. 'direct' (prototype) = hold a finger on
   * the play area (or W A S D / arrows) and the vessel thrusts toward it;
   * see src/shell/directSteering.ts. Default 'engines'.
   */
  steering: SteeringScheme;
}

export type SteeringScheme = 'engines' | 'direct';

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

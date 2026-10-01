/**
 * FROZEN (S0; S9 amendment: Settings.swapEngineButtons; feel-pass amendments: Settings.showFps, Settings.lowRes; direct-steering amendment: Settings.steering; round 8: steering 'joystick', Settings.showMinimap). Persistent progress (localStorage key 'the-little-lander/save').
 * Readers must accept older/partial data: validate, then fill defaults.
 */

import type { LevelId } from './common';
import type { CutsceneId } from './cutscene';

/**
 * 2 (round 9): Settings.steering became nullable (null = never chosen -> JOYSTICK).
 * A version-1 save stored 'engines' for every player who never touched STEERING,
 * so on read a v1 'engines' migrates to null; a v1 'direct' / 'joystick' was a
 * deliberate choice and is kept.
 */
export const SAVE_VERSION = 2;
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
   * see src/shell/directSteering.ts. 'joystick' (round 8) = the same DIRECT
   * steering driven by a virtual stick bottom-left (touch, or a mouse drag);
   * its keyboard is the DIRECT one.
   * Round 9: null = the player never chose (like lowRes): resolved to
   * DEFAULT_STEERING ('joystick') at use; only the pause-menu cycle saves a
   * scheme. See SAVE_VERSION for the migration of older saves.
   */
  steering: SteeringScheme | null;
  /**
   * Round 8: the minimap (bottom-right: terrain around the vessel, the exit
   * marked). Pause-menu toggle. Default true; older saves read as true.
   */
  showMinimap: boolean;
}

export type SteeringScheme = 'engines' | 'direct' | 'joystick';

/** The pause menu's STEERING item cycles through these, in order. */
export const STEERING_SCHEMES: readonly SteeringScheme[] = ['engines', 'direct', 'joystick'];

/** Round 9: what a player who never picked a scheme flies with (outside ENGINES_DEFAULT_LEVELS). */
// Deliberately the default on desktop too (user's explicit request): there the keyboard flies the DIRECT rotate+thrust keys.
export const DEFAULT_STEERING: SteeringScheme = 'joystick';

/**
 * Round 9 (user: "for decent default control should be engines mode. Works best
 * there"): levels where a never-chosen setting flies the classic ENGINES scheme
 * (touch buttons too). An explicit choice still applies here.
 */
export const ENGINES_DEFAULT_LEVELS: readonly string[] = ['descent'];

/**
 * Settings.steering -> the scheme in use on `levelId` (null / undefined setting =
 * never chosen: ENGINES on ENGINES_DEFAULT_LEVELS, else DEFAULT_STEERING).
 */
export function resolveSteering(s: SteeringScheme | null | undefined, levelId?: string | null): SteeringScheme {
  if (s) return s;
  return levelId && ENGINES_DEFAULT_LEVELS.includes(levelId) ? 'engines' : DEFAULT_STEERING;
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

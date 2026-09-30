/**
 * FROZEN (S0). The top-level screen state machine (src/shell/state.ts
 * implements the pure transition function). UI (S4) and story (S3) slices
 * render screens for these states and dispatch ScreenActions.
 *
 *   boot -> title -> levelSelect -> [cutscene] -> playing <-> paused
 *                                                  |
 *                                               results -> [cutscene] -> levelSelect / next level
 */

import type { LevelId } from './common';
import type { CutsceneId } from './cutscene';
import type { CrashCause } from './events';

export type ScreenId = 'boot' | 'title' | 'levelSelect' | 'cutscene' | 'playing' | 'paused' | 'results';

/** Level outcome shown on the results screen. */
export type LevelOutcome =
  | { kind: 'complete'; timeSec: number; orbs: number; score: number }
  | { kind: 'failed'; cause: CrashCause };

export type ScreenState =
  | { id: 'boot' }
  | { id: 'title' }
  | { id: 'levelSelect' }
  /** `then` = the state to enter when the cutscene is done or skipped. */
  | { id: 'cutscene'; cutsceneId: CutsceneId; then: ScreenState }
  | { id: 'playing'; levelId: LevelId }
  | { id: 'paused'; levelId: LevelId }
  | { id: 'results'; levelId: LevelId; outcome: LevelOutcome };

export type ScreenAction =
  | { type: 'booted' }
  | { type: 'start' } // title -> levelSelect
  | { type: 'back' } // one level up (levelSelect -> title, results -> levelSelect)
  | { type: 'selectLevel'; levelId: LevelId; cutsceneBefore?: CutsceneId }
  | { type: 'cutsceneDone' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'retry' } // playing/paused/results -> playing (same level, fresh session)
  | { type: 'quit' } // paused -> levelSelect
  | { type: 'levelEnded'; outcome: LevelOutcome }
  | { type: 'continue'; next: LevelId | null; cutsceneAfter?: CutsceneId }; // results -> [cutscene] -> next level / levelSelect

/**
 * Story-mode sequencing: level order (contracts STORY_LEVELS), which
 * cutscene plays before/after each level, unlock rules, and the
 * ScreenActions that drive the S0 state machine through the story.
 *
 * Cutscene hooks come from LevelSpec.cutsceneBefore/After when the level
 * defines them, else from STORY_CUTSCENES below (so the arc plays in order
 * even while level content (S6/S7) is still being built). Mid-level
 * cutscenes (Map 3's csmSeized) ride on LevelSpec.modeSwitch.cutscene.
 *
 * Continue rule: finishing level L plays L.after, then next.before, then
 * starts the next level. ScreenAction.continue (frozen) carries one
 * cutscene, so the chain is played inside that single `cutscene` screen:
 * continuePlan() returns the action plus the full list, and the App plays
 * the extra scripts back to back before dispatching cutsceneDone.
 */

import { STORY_LEVELS } from '../contracts';
import type { CutsceneId, LevelId, LevelSpec, SaveState, ScreenAction } from '../contracts';

export interface LevelCutscenes {
  before?: CutsceneId;
  after?: CutsceneId;
}

/** Default story hooks per level (PLAN.md arc). */
export const STORY_CUTSCENES: Readonly<Partial<Record<LevelId, LevelCutscenes>>> = {
  hangarRun: { before: 'briefing', after: 'meetIo' },
  descent: { after: 'descentAwe' },
  floatingIsles: { after: 'emptyOutpost' }, // + csmSeized mid-level (modeSwitch)
  throat: { after: 'podTransfer' },
  vaults: { after: 'teamFound' },
  hollow: {},
  keeper: { before: 'keeperWakes', after: 'keeperFalls' },
  madDash: { after: 'finale' },
};

/** Mid-level cutscenes by level (used when a level's modeSwitch doesn't name one). */
export const MID_LEVEL_CUTSCENES: Readonly<Partial<Record<LevelId, CutsceneId>>> = {
  floatingIsles: 'csmSeized',
};

export type SpecLookup = (id: LevelId) => LevelSpec | undefined;

/**
 * The level after `id` in story order. The debug `testpad` leads into Map 1
 * so the story flow can be exercised before real levels exist.
 */
export function nextStoryLevel(id: LevelId): LevelId | null {
  if (id === 'testpad') return STORY_LEVELS[0] ?? null;
  const i = STORY_LEVELS.indexOf(id);
  return i >= 0 ? (STORY_LEVELS[i + 1] ?? null) : null;
}

export function levelCutscenes(id: LevelId, spec?: LevelSpec): LevelCutscenes {
  const d = STORY_CUTSCENES[id] ?? {};
  const out: LevelCutscenes = {};
  const before = spec?.cutsceneBefore ?? d.before;
  const after = spec?.cutsceneAfter ?? d.after;
  if (before) out.before = before;
  if (after) out.after = after;
  return out;
}

/** Debug levels are always playable; story levels need an unlock. */
export function isUnlocked(save: SaveState, id: LevelId): boolean {
  return !STORY_LEVELS.includes(id) || save.unlocked.includes(id);
}

/** Level-select pick -> selectLevel action (with its "before" cutscene). */
export function selectLevelAction(id: LevelId, getSpec: SpecLookup): ScreenAction {
  const { before } = levelCutscenes(id, getSpec(id));
  return before ? { type: 'selectLevel', levelId: id, cutsceneBefore: before } : { type: 'selectLevel', levelId: id };
}

export interface ContinuePlan {
  action: Extract<ScreenAction, { type: 'continue' }>;
  /** Every cutscene to play, in order (action.cutsceneAfter === cutscenes[0]). */
  cutscenes: CutsceneId[];
}

/**
 * After completing `finished`: the continue action + cutscene chain
 * (finished.after, then next.before). `next` is null (back to level select)
 * when there is no next level or it isn't built yet — the story cutscenes
 * still play.
 */
export function continuePlan(finished: LevelId, getSpec: SpecLookup): ContinuePlan {
  const nextId = nextStoryLevel(finished);
  const nextSpec = nextId ? getSpec(nextId) : undefined;
  const cutscenes: CutsceneId[] = [];
  const after = levelCutscenes(finished, getSpec(finished)).after;
  const before = nextId ? levelCutscenes(nextId, nextSpec).before : undefined;
  if (after) cutscenes.push(after);
  if (before && before !== after) cutscenes.push(before);
  const next = nextSpec ? nextId : null;
  const action: ContinuePlan['action'] = cutscenes[0] ? { type: 'continue', next, cutsceneAfter: cutscenes[0] } : { type: 'continue', next };
  return { action, cutscenes };
}

/**
 * "Continue" from the title: the furthest unlocked story level that exists.
 * null = nothing playable yet (go to level select).
 */
export function continueTarget(save: SaveState, getSpec: SpecLookup): LevelId | null {
  for (let i = STORY_LEVELS.length - 1; i >= 0; i--) {
    const id = STORY_LEVELS[i]!;
    if (save.unlocked.includes(id) && getSpec(id)) return id;
  }
  return null;
}

/** The cutscene to play when a level's mode switch fires (spec first, then default). */
export function modeSwitchCutscene(id: LevelId, spec?: LevelSpec): CutsceneId | undefined {
  if (spec?.modeSwitch) return spec.modeSwitch.cutscene ?? MID_LEVEL_CUTSCENES[id];
  return undefined;
}

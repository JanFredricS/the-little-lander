/**
 * Screen models (pure): for each ScreenState, the heading, info lines and
 * menu items, and what activating an item does (a ScreenAction for the state
 * machine, or a UI-local command). Views only draw these; tests drive them.
 */

import type { CrashCause, LevelId, LevelSpec, ScreenAction, ScreenState } from '../contracts';
import { formatTime, levelEntries, levelMenuItems, nextStoryLevel, STORY_TITLES, type SaveView } from './levelSelect';
import type { MenuItem } from './menu';
import type { TouchPref } from './touch/touchModel';

export interface ScreenContext {
  levels: Partial<Record<LevelId, LevelSpec>>;
  save: SaveView | null;
  showDebug: boolean;
  touchPref: TouchPref;
  /** Hull fraction at the end of the last level (results screen). */
  lastHull: number | null;
  /**
   * Story flow (S3, src/story/flow.ts). When set, it decides the title's
   * CONTINUE target and whether/where the results NEXT item goes; the App
   * turns the resulting actions into the full cutscene chain.
   */
  story?: StoryContext;
}

export interface StoryContext {
  /** Title CONTINUE target (furthest unlocked built story level), or null. */
  continueLevel: LevelId | null;
  /** After completing `id`: the next level (null = none/unbuilt) and whether story cutscenes play. */
  after(id: LevelId): { next: LevelId | null; cutscenes: boolean };
}

export type ScreenKind = 'title' | 'list' | 'panel' | 'loading';

export interface ScreenModel {
  kind: ScreenKind;
  heading: string;
  /** Info lines under the heading (results stats, crash cause). */
  info: string[];
  items: MenuItem[];
  /** Initially focused item index. */
  focus: number;
  footer: string;
  /** Dim the (frozen) game behind the panel instead of a starfield. */
  overGame: boolean;
}

/** UI-local commands (not state-machine actions). */
export type UiCommand = { ui: 'controls' } | { ui: 'toggleTouch' } | { ui: 'continueStory' } | { ui: 'none' };

export const CRASH_TEXT: Record<CrashCause, string> = {
  impact: 'HIT THE GROUND TOO HARD',
  hullDestroyed: 'HULL DESTROYED',
  outOfBounds: 'LOST IN THE VOID',
  crushed: 'CRUSHED',
  boss: 'THE KEEPER GOT YOU',
};

function levelTitle(ctx: ScreenContext, id: LevelId): string {
  return (ctx.levels[id]?.title ?? STORY_TITLES[id]).toUpperCase();
}

function touchLabel(p: TouchPref): string {
  return `TOUCH CONTROLS: ${p.toUpperCase()}`;
}

/** The level `continue` goes to after `id` (only if it is registered). */
export function continueTarget(ctx: ScreenContext, id: LevelId): LevelId | null {
  const n = nextStoryLevel(id);
  return n && ctx.levels[n] ? n : null;
}

export function screenModel(state: ScreenState, ctx: ScreenContext): ScreenModel {
  const base = { info: [] as string[], focus: 0, overGame: false };
  switch (state.id) {
    case 'boot':
      return { ...base, kind: 'loading', heading: 'LOADING…', items: [], footer: '' };
    case 'title': {
      const cont = ctx.story?.continueLevel ?? null;
      const items: MenuItem[] = cont
        ? [
            { id: 'continue', label: `CONTINUE: ${levelTitle(ctx, cont)}`, enabled: true },
            { id: 'start', label: 'LEVEL SELECT', enabled: true },
          ]
        : [{ id: 'start', label: 'START', enabled: true }];
      return {
        ...base,
        kind: 'title',
        heading: 'THE LITTLE LANDER',
        info: ['A TALE OF ASTER'],
        items,
        footer: 'ENTER / CLICK / TAP',
      };
    }
    case 'levelSelect': {
      const entries = levelEntries(ctx.save, ctx.levels, ctx.showDebug);
      const items = [...levelMenuItems(entries), { id: 'back', label: '← BACK', enabled: true }];
      const firstOpen = items.findIndex((i) => i.enabled && i.id !== 'back');
      return {
        ...base,
        kind: 'list',
        heading: 'SELECT LEVEL',
        items,
        focus: firstOpen < 0 ? items.length - 1 : firstOpen,
        footer: '↑↓ CHOOSE · ENTER PLAY · ESC BACK',
      };
    }
    case 'cutscene':
      return {
        ...base,
        kind: 'panel',
        heading: 'CUTSCENE',
        info: [`[${state.cutsceneId}]`],
        items: [{ id: 'continue', label: 'CONTINUE', enabled: true }],
        footer: 'ANY KEY / TAP',
      };
    case 'playing':
      return { ...base, kind: 'loading', heading: 'LOADING…', items: [], footer: '' };
    case 'paused':
      return {
        ...base,
        kind: 'panel',
        overGame: true,
        heading: 'PAUSED',
        info: [levelTitle(ctx, state.levelId)],
        items: [
          { id: 'resume', label: 'RESUME', enabled: true },
          { id: 'retry', label: 'RESTART', enabled: true },
          { id: 'controls', label: 'CONTROLS', enabled: true },
          { id: 'touch', label: touchLabel(ctx.touchPref), enabled: true },
          { id: 'quit', label: 'QUIT TO LEVELS', enabled: true },
        ],
        footer: 'ESC RESUME',
      };
    case 'results': {
      const o = state.outcome;
      const hull = ctx.lastHull !== null ? `${Math.round(ctx.lastHull * 100)}%` : '--';
      if (o.kind === 'complete') {
        const story = ctx.story?.after(state.levelId);
        const next = story ? story.next : continueTarget(ctx, state.levelId);
        const items: MenuItem[] = [];
        if (next) items.push({ id: 'next', label: `NEXT: ${levelTitle(ctx, next)}`, enabled: true });
        else if (story?.cutscenes) items.push({ id: 'next', label: 'CONTINUE', enabled: true });
        items.push({ id: 'retry', label: 'RETRY', enabled: true }, { id: 'levels', label: 'LEVELS', enabled: true });
        return {
          ...base,
          kind: 'panel',
          overGame: true,
          heading: 'LEVEL COMPLETE',
          info: [levelTitle(ctx, state.levelId), `TIME  ${formatTime(o.timeSec)}`, `ORBS  ${o.orbs}`, `HULL  ${hull}`, `SCORE ${o.score}`],
          items,
          footer: 'ENTER SELECT · ESC LEVELS',
        };
      }
      return {
        ...base,
        kind: 'panel',
        overGame: true,
        heading: 'GAME OVER',
        info: [CRASH_TEXT[o.cause], levelTitle(ctx, state.levelId), `HULL  ${hull}`],
        items: [
          { id: 'retry', label: 'RETRY', enabled: true },
          { id: 'levels', label: 'LEVELS', enabled: true },
        ],
        footer: 'ENTER RETRY · ESC LEVELS',
      };
    }
  }
}

/** What activating item `id` on `state` does. */
export function itemAction(state: ScreenState, id: string, ctx: ScreenContext): ScreenAction | UiCommand {
  switch (state.id) {
    case 'title':
      return id === 'continue' ? { ui: 'continueStory' } : { type: 'start' };
    case 'levelSelect': {
      if (id === 'back') return { type: 'back' };
      const spec = ctx.levels[id as LevelId];
      if (!spec) return { ui: 'none' };
      return spec.cutsceneBefore ? { type: 'selectLevel', levelId: spec.id, cutsceneBefore: spec.cutsceneBefore } : { type: 'selectLevel', levelId: spec.id };
    }
    case 'cutscene':
      return { type: 'cutsceneDone' };
    case 'paused':
      if (id === 'resume') return { type: 'resume' };
      if (id === 'retry') return { type: 'retry' };
      if (id === 'quit') return { type: 'quit' };
      if (id === 'controls') return { ui: 'controls' };
      if (id === 'touch') return { ui: 'toggleTouch' };
      return { ui: 'none' };
    case 'results': {
      if (id === 'retry') return { type: 'retry' };
      if (id === 'levels') return { type: 'back' };
      if (id === 'next') {
        const spec = ctx.levels[state.levelId];
        const next = continueTarget(ctx, state.levelId);
        const after = spec?.cutsceneAfter;
        return after ? { type: 'continue', next, cutsceneAfter: after } : { type: 'continue', next };
      }
      return { ui: 'none' };
    }
    default:
      return { ui: 'none' };
  }
}

/** Escape/back on each screen. */
export function backAction(state: ScreenState): ScreenAction | null {
  switch (state.id) {
    case 'levelSelect':
      return { type: 'back' };
    case 'paused':
      return { type: 'resume' };
    case 'results':
      return { type: 'back' };
    case 'cutscene':
      return { type: 'cutsceneDone' };
    default:
      return null;
  }
}

export function isUiCommand(a: ScreenAction | UiCommand): a is UiCommand {
  return 'ui' in a;
}

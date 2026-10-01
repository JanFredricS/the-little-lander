/**
 * Screen models (pure): for each ScreenState, the heading, info lines and
 * menu items, and what activating an item does (a ScreenAction for the state
 * machine, or a UI-local command). Views only draw these; tests drive them.
 */

import { resolveSteering, type CrashCause, type LevelId, type LevelSpec, type ScreenAction, type ScreenState, type SteeringScheme, type StickSide, type VesselMode } from '../contracts';
import { formatTime, levelEntries, levelMenuItems, nextStoryLevel, STORY_TITLES, type SaveView } from './levelSelect';
import type { MenuItem } from './menu';
import type { TouchPref } from './touch/touchModel';

export interface ScreenContext {
  levels: Partial<Record<LevelId, LevelSpec>>;
  save: SaveView | null;
  showDebug: boolean;
  touchPref: TouchPref;
  /** S9: touch engine buttons swapped (Settings.swapEngineButtons; default true). */
  swapEngines?: boolean;
  /** FPS counter shown (Settings.showFps; default false). */
  showFps?: boolean;
  /** Low-res render mode (Settings.lowRes). */
  lowRes?: boolean;
  /** Settings.steering: an explicit scheme, or null / unset = AUTO (resolved per level: resolveSteering). */
  steering?: SteeringScheme | null;
  /** The vessel mode being flown (AUTO steering resolves per phase, e.g. floatingIsles' CSM). */
  vesselMode?: VesselMode | null;
  /** Minimap shown (Settings.showMinimap; default true). */
  showMinimap?: boolean;
  /** Round 11: thumb-control side (Settings.stickSide; default 'left'). */
  stickSide?: StickSide;
  /**
   * Round 12 (LevelSpec.checkpoints). GAME OVER: a retry resumes at a checkpoint (RETRY
   * FROM CHECKPOINT; RESTART LEVEL starts over). Paused: the run has a checkpoint, so the
   * RESTART item reads RESTART LEVEL (it drops the checkpoint and the kept beacons).
   */
  checkpoint?: boolean;
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
export type UiCommand = { ui: 'controls' } | { ui: 'toggleTouch' } | { ui: 'toggleSwap' } | { ui: 'toggleFps' } | { ui: 'toggleLowRes' } | { ui: 'toggleSteering' } | { ui: 'toggleMinimap' } | { ui: 'toggleStickSide' } | { ui: 'continueStory' } | { ui: 'none' };

export const CRASH_TEXT: Record<CrashCause, string> = {
  impact: 'HIT THE GROUND TOO HARD',
  hullDestroyed: 'HULL DESTROYED',
  outOfBounds: 'LOST IN THE VOID',
  crushed: 'CRUSHED',
  boss: 'THE KEEPER GOT YOU',
};

/** Round 12: the GAME OVER line after a checkpoint (what a RETRY keeps). */
export const CHECKPOINT_INFO = 'CHECKPOINT: BEACONS KEPT';

function levelTitle(ctx: ScreenContext, id: LevelId): string {
  return (ctx.levels[id]?.title ?? STORY_TITLES[id]).toUpperCase();
}

function touchLabel(p: TouchPref): string {
  return `TOUCH CONTROLS: ${p.toUpperCase()}`;
}

export function fpsLabel(on: boolean): string {
  return `FPS COUNTER: ${on ? 'ON' : 'OFF'}`;
}

export function lowResLabel(on: boolean): string {
  return `LOW-RES MODE: ${on ? 'ON' : 'OFF'}`;
}

function schemeName(s: SteeringScheme): string {
  return s === 'direct' ? 'DIRECT' : s === 'joystick' ? 'JOYSTICK' : 'ENGINES';
}

/**
 * The STEERING item for `setting` on level `levelId`: an explicit scheme by name, or
 * AUTO (null = never chosen) with the scheme it resolves to there (and in `mode`, per phase), e.g. "AUTO (ENGINES)" on Descent.
 */
export function steeringLabel(setting: SteeringScheme | null, levelId?: string | null, mode?: VesselMode | null): string {
  return `STEERING: ${setting ? schemeName(setting) : `AUTO (${schemeName(resolveSteering(null, levelId, mode))})`}`;
}

/** The STEERING item's next setting: ENGINES -> DIRECT -> JOYSTICK -> AUTO (null: per-level default) -> ENGINES. */
export function nextSteering(s: SteeringScheme | null): SteeringScheme | null {
  return s === 'engines' ? 'direct' : s === 'direct' ? 'joystick' : s === 'joystick' ? null : 'engines';
}

export function minimapLabel(on: boolean): string {
  return `MINIMAP: ${on ? 'ON' : 'OFF'}`;
}

/** Round 11 LAYOUT item: where the stick sits (the minimap takes the other bottom corner). */
export function stickSideLabel(side: StickSide): string {
  return `LAYOUT: STICK ${side === 'right' ? 'RIGHT' : 'LEFT'}`;
}

export function swapLabel(swap: boolean): string {
  return `SWAP ENGINE BUTTONS: ${swap ? 'ON' : 'OFF'}`;
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
        // landing copy (S8): the pitch, readable before the first click
        info: ['A TALE OF ASTER', '', 'PILOT A TINY LANDER THROUGH A SHATTERED WORLD.', 'PLANT BEACONS. FIND THE LOST TEAM. GET HOME.'],
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
          { id: 'retry', label: ctx.checkpoint ? 'RESTART LEVEL' : 'RESTART', enabled: true },
          { id: 'controls', label: 'CONTROLS', enabled: true },
          { id: 'touch', label: touchLabel(ctx.touchPref), enabled: true },
          { id: 'steering', label: steeringLabel(ctx.steering ?? null, state.levelId, ctx.vesselMode), enabled: true },
          { id: 'minimap', label: minimapLabel(ctx.showMinimap ?? true), enabled: true },
          { id: 'layout', label: stickSideLabel(ctx.stickSide ?? 'left'), enabled: true },
          { id: 'swap', label: swapLabel(ctx.swapEngines ?? true), enabled: true },
          { id: 'fps', label: fpsLabel(ctx.showFps ?? false), enabled: true },
          { id: 'lowres', label: lowResLabel(ctx.lowRes ?? false), enabled: true },
          { id: 'quit', label: 'QUIT TO LEVELS', enabled: true },
        ],
        footer: '↑↓←→ CHOOSE · ESC RESUME · BKSP RESTART',
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
          footer: 'ENTER SELECT · BKSP RETRY · ESC LEVELS',
        };
      }
      if (ctx.checkpoint) {
        return {
          ...base,
          kind: 'panel',
          overGame: true,
          heading: 'GAME OVER',
          info: [CRASH_TEXT[o.cause], levelTitle(ctx, state.levelId), CHECKPOINT_INFO],
          items: [
            { id: 'retry', label: 'RETRY FROM CHECKPOINT', enabled: true },
            { id: 'restart', label: 'RESTART LEVEL', enabled: true },
            { id: 'levels', label: 'LEVELS', enabled: true },
          ],
          footer: 'ENTER / BKSP CHECKPOINT · ESC LEVELS',
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
        footer: 'ENTER / BKSP RETRY · ESC LEVELS',
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
      // RESTART is always the whole level (round 12: never a checkpoint respawn)
      if (id === 'retry') return { type: 'retry', fromStart: true };
      if (id === 'quit') return { type: 'quit' };
      if (id === 'controls') return { ui: 'controls' };
      if (id === 'touch') return { ui: 'toggleTouch' };
      if (id === 'swap') return { ui: 'toggleSwap' };
      if (id === 'steering') return { ui: 'toggleSteering' };
      if (id === 'minimap') return { ui: 'toggleMinimap' };
      if (id === 'layout') return { ui: 'toggleStickSide' };
      if (id === 'fps') return { ui: 'toggleFps' };
      if (id === 'lowres') return { ui: 'toggleLowRes' };
      return { ui: 'none' };
    case 'results': {
      // after a checkpoint (round 12) plain RETRY resumes there; RESTART LEVEL starts over
      if (id === 'retry') return { type: 'retry' };
      if (id === 'restart') return { type: 'retry', fromStart: true };
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

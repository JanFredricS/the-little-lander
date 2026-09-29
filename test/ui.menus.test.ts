import { describe, expect, it } from 'vitest';
import type { LevelId, LevelSpec, ScreenAction, ScreenState } from '../src/contracts';
import { STORY_LEVELS } from '../src/contracts';
import { testpad } from '../src/levels/testpad';
import { transition } from '../src/shell/state';
import { entryDetail, formatTime, levelEntries, nextStoryLevel, readSaveView } from '../src/ui/levelSelect';
import { createMenu, keyToCommand, layoutRows, menuCommand, rowAt, scrollBy, scrollToFocus, type MenuItem } from '../src/ui/menu';
import { backAction, isUiCommand, itemAction, screenModel, type ScreenContext } from '../src/ui/screens';

const items = (n: number, disabled: number[] = []): MenuItem[] =>
  Array.from({ length: n }, (_, i) => ({ id: `i${i}`, label: `ITEM ${i}`, enabled: !disabled.includes(i) }));

const fakeLevel = (id: LevelId, extra: Partial<LevelSpec> = {}): LevelSpec => ({ ...testpad, id, title: id, debug: false, ...extra });

function ctx(p: Partial<ScreenContext> = {}): ScreenContext {
  return { levels: { testpad }, save: null, showDebug: false, touchPref: 'auto', lastHull: null, ...p };
}

describe('menu navigation', () => {
  it('maps keys to commands', () => {
    expect(keyToCommand('ArrowUp')).toBe('prev');
    expect(keyToCommand('KeyS')).toBe('next');
    expect(keyToCommand('Enter')).toBe('activate');
    expect(keyToCommand('Space')).toBe('activate');
    expect(keyToCommand('Escape')).toBe('back');
    expect(keyToCommand('Digit3')).toEqual({ jump: 2 });
    expect(keyToCommand('KeyZ')).toBeNull();
  });

  it('wraps focus and activates enabled items only', () => {
    let m = createMenu(items(3, [1]));
    m = menuCommand(m, 'prev').state;
    expect(m.focus).toBe(2);
    m = menuCommand(m, 'next').state;
    expect(m.focus).toBe(0);
    expect(menuCommand(m, 'activate').activate).toBe('i0');
    m = menuCommand(m, 'next').state;
    const r = menuCommand(m, 'activate');
    expect(r.activate).toBeUndefined();
    expect(r.rejected).toBe('i1');
    expect(menuCommand(m, { jump: 2 })).toMatchObject({ activate: 'i2', state: { focus: 2 } });
    expect(menuCommand(m, { jump: 9 }).activate).toBeUndefined();
    expect(menuCommand(m, 'back').back).toBe(true);
  });

  it('scrolls to keep focus visible', () => {
    let m = { ...createMenu(items(10)), focus: 7 };
    m = scrollToFocus(m, 4);
    expect(m.scroll).toBe(4);
    m = scrollToFocus({ ...m, focus: 1 }, 4);
    expect(m.scroll).toBe(1);
    expect(scrollBy(m, 100, 4).scroll).toBe(6);
    expect(scrollBy(m, -100, 4).scroll).toBe(0);
  });

  it('row layout reaches 48 CSS px when it fits, scrolls otherwise', () => {
    // phone: 1 CSS px per virtual px -> 48 virtual rows
    const phone = layoutRows(9, { top: 40, bottom: 334, cssPerVirtual: 1, minRow: 20, maxRow: 48, gap: 4 });
    expect(phone.rowH).toBe(48);
    expect(phone.touchSized).toBe(true);
    expect(phone.visible).toBe(5);
    // desktop 2x: 24 virtual rows are 48 CSS px; all 9 fit
    const desk = layoutRows(9, { top: 40, bottom: 334, cssPerVirtual: 2, minRow: 20, maxRow: 48, gap: 4 });
    expect(desk.rowH).toBe(24);
    expect(desk.visible).toBe(9);
    expect(desk.touchSized).toBe(true);
    // hit test includes half gaps
    expect(rowAt(desk, 4, desk.rowY(3) + 1, 9)).toBe(3);
    expect(rowAt(desk, 4, 10, 9)).toBe(-1);
  });
});

describe('level select lock / unlock display', () => {
  it('lists all story levels in order; hangarRun always unlocked; unbuilt shows SOON', () => {
    const e = levelEntries(null, { testpad });
    expect(e.map((x) => x.id)).toEqual([...STORY_LEVELS]);
    expect(e[0]).toMatchObject({ id: 'hangarRun', lock: 'unbuilt', number: 1 });
    expect(e[1]).toMatchObject({ id: 'descent', lock: 'locked' });
    expect(entryDetail(e[0]!)).toBe('SOON');
    expect(entryDetail(e[1]!)).toBe('LOCKED');
  });

  it('filters debug levels unless showDebug', () => {
    expect(levelEntries(null, { testpad }).some((x) => x.id === 'testpad')).toBe(false);
    const withDebug = levelEntries(null, { testpad }, true);
    expect(withDebug.at(-1)).toMatchObject({ id: 'testpad', lock: 'open', debug: true, number: null });
    expect(entryDetail(withDebug.at(-1)!)).toBe('DEBUG');
  });

  it('uses SaveState unlocks and bests', () => {
    const levels = { hangarRun: fakeLevel('hangarRun'), descent: fakeLevel('descent'), throat: fakeLevel('throat') };
    const save = { unlocked: ['hangarRun', 'descent'] as LevelId[], best: { hangarRun: { timeSec: 83.4, orbs: 2, score: 1500 } } };
    const e = levelEntries(save, levels);
    expect(e[0]).toMatchObject({ lock: 'open', best: { timeSec: 83.4 } });
    expect(entryDetail(e[0]!)).toBe('1:23.4  ★2');
    expect(e[1]).toMatchObject({ lock: 'open' });
    expect(entryDetail(e[1]!)).toBe('NEW');
    expect(e[3]).toMatchObject({ id: 'throat', lock: 'locked' });
  });

  it('reads the save tolerantly', () => {
    const store = (v: string | null) => ({ getItem: () => v });
    expect(readSaveView(store(null))).toBeNull();
    expect(readSaveView(store('{nope'))).toBeNull();
    expect(readSaveView(store(JSON.stringify({ unlocked: ['descent', 3], best: { descent: { timeSec: 1, orbs: 0, score: 5 }, bad: {} } })))).toEqual({
      unlocked: ['descent'],
      best: { descent: { timeSec: 1, orbs: 0, score: 5 } },
    });
  });

  it('formats times and next levels', () => {
    expect(formatTime(5)).toBe('0:05.0');
    expect(formatTime(125.25)).toBe('2:05.3');
    expect(nextStoryLevel('hangarRun')).toBe('descent');
    expect(nextStoryLevel('madDash')).toBeNull();
    expect(nextStoryLevel('testpad')).toBeNull();
  });
});

describe('screen models drive the state machine', () => {
  /** Activate item `id` on `state` and apply the action via the real transition fn. */
  function press(state: ScreenState, id: string, c: ScreenContext): ScreenState {
    const a = itemAction(state, id, c);
    if (isUiCommand(a)) throw new Error(`ui command ${a.ui}`);
    return transition(state, a as ScreenAction);
  }

  it('full loop: title -> level select -> debug level -> pause -> results -> back', () => {
    const c = ctx({ showDebug: true });
    let s: ScreenState = { id: 'title' };
    expect(screenModel(s, c).items.map((i) => i.id)).toEqual(['start']);
    s = press(s, 'start', c);
    expect(s.id).toBe('levelSelect');
    const ls = screenModel(s, c);
    // focus lands on the first playable entry (the debug level here)
    expect(ls.items[ls.focus]!.id).toBe('testpad');
    s = press(s, 'testpad', c);
    expect(s).toEqual({ id: 'playing', levelId: 'testpad' });
    s = transition(s, { type: 'pause' });
    expect(screenModel(s, c).items.map((i) => i.id)).toEqual(['resume', 'retry', 'controls', 'touch', 'quit']);
    expect(itemAction(s, 'controls', c)).toEqual({ ui: 'controls' });
    expect(itemAction(s, 'touch', c)).toEqual({ ui: 'toggleTouch' });
    expect(press(s, 'resume', c)).toEqual({ id: 'playing', levelId: 'testpad' });
    s = transition(press(s, 'resume', c), { type: 'levelEnded', outcome: { kind: 'complete', timeSec: 12.3, orbs: 1, score: 1400 } });
    const res = screenModel(s, { ...c, lastHull: 0.75 });
    expect(res.heading).toBe('LEVEL COMPLETE');
    expect(res.info).toContain('HULL  75%');
    expect(res.info).toContain('TIME  0:12.3');
    expect(res.items.map((i) => i.id)).toEqual(['retry', 'levels']); // no next for a debug level
    expect(press(s, 'retry', c)).toEqual({ id: 'playing', levelId: 'testpad' });
    s = press(s, 'levels', c);
    expect(s).toEqual({ id: 'levelSelect' });
    s = press(s, 'back', c);
    expect(s).toEqual({ id: 'title' });
  });

  it('game over shows the crash cause with retry', () => {
    const s: ScreenState = { id: 'results', levelId: 'testpad', outcome: { kind: 'failed', cause: 'hullDestroyed' } };
    const m = screenModel(s, ctx());
    expect(m.heading).toBe('GAME OVER');
    expect(m.info[0]).toBe('HULL DESTROYED');
    expect(m.items.map((i) => i.id)).toEqual(['retry', 'levels']);
  });

  it('results NEXT continues to the next registered story level with cutsceneAfter', () => {
    const levels = { hangarRun: fakeLevel('hangarRun', { cutsceneAfter: 'meetIo' as never }), descent: fakeLevel('descent') };
    const c = ctx({ levels });
    const s: ScreenState = { id: 'results', levelId: 'hangarRun', outcome: { kind: 'complete', timeSec: 1, orbs: 0, score: 1 } };
    expect(screenModel(s, c).items[0]!.id).toBe('next');
    expect(itemAction(s, 'next', c)).toEqual({ type: 'continue', next: 'descent', cutsceneAfter: 'meetIo' });
  });

  it('level select passes cutsceneBefore and never selects locked/unbuilt levels', () => {
    const levels = { hangarRun: fakeLevel('hangarRun', { cutsceneBefore: 'briefing' as never }) };
    const c = ctx({ levels });
    const s: ScreenState = { id: 'levelSelect' };
    expect(itemAction(s, 'hangarRun', c)).toEqual({ type: 'selectLevel', levelId: 'hangarRun', cutsceneBefore: 'briefing' });
    const m = screenModel(s, c);
    const descent = m.items.find((i) => i.id === 'descent')!;
    expect(descent.enabled).toBe(false);
    const r = menuCommand({ ...createMenu(m.items), focus: m.items.indexOf(descent) }, 'activate');
    expect(r.rejected).toBe('descent');
    // nothing playable -> focus falls on BACK
    const empty = screenModel(s, ctx());
    expect(empty.items[empty.focus]!.id).toBe('back');
  });

  it('escape/back per screen', () => {
    expect(backAction({ id: 'levelSelect' })).toEqual({ type: 'back' });
    expect(backAction({ id: 'paused', levelId: 'testpad' })).toEqual({ type: 'resume' });
    expect(backAction({ id: 'title' })).toBeNull();
  });

  it('pause menu reflects the touch-controls preference', () => {
    const m = screenModel({ id: 'paused', levelId: 'testpad' }, ctx({ touchPref: 'on' }));
    expect(m.items.find((i) => i.id === 'touch')!.label).toBe('TOUCH CONTROLS: ON');
  });
});

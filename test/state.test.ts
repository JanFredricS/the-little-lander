import { describe, expect, it } from 'vitest';
import type { ScreenState } from '../src/contracts';
import { INITIAL_STATE, isResume, transition } from '../src/shell/state';

describe('screen state machine', () => {
  it('boot -> title -> levelSelect -> playing', () => {
    let s = transition(INITIAL_STATE, { type: 'booted' });
    expect(s).toEqual({ id: 'title' });
    s = transition(s, { type: 'start' });
    expect(s).toEqual({ id: 'levelSelect' });
    s = transition(s, { type: 'selectLevel', levelId: 'testpad' });
    expect(s).toEqual({ id: 'playing', levelId: 'testpad' });
  });

  it('plays cutsceneBefore first, then the level', () => {
    const s = transition({ id: 'levelSelect' }, { type: 'selectLevel', levelId: 'hangarRun', cutsceneBefore: 'briefing' });
    expect(s).toEqual({ id: 'cutscene', cutsceneId: 'briefing', then: { id: 'playing', levelId: 'hangarRun' } });
    expect(transition(s, { type: 'cutsceneDone' })).toEqual({ id: 'playing', levelId: 'hangarRun' });
  });

  it('pause / resume / retry / quit', () => {
    const playing: ScreenState = { id: 'playing', levelId: 'testpad' };
    const paused = transition(playing, { type: 'pause' });
    expect(paused).toEqual({ id: 'paused', levelId: 'testpad' });
    expect(isResume(playing, { type: 'pause' }, paused)).toBe(true);
    const resumed = transition(paused, { type: 'resume' });
    expect(resumed).toEqual(playing);
    expect(isResume(paused, { type: 'resume' }, resumed)).toBe(true);
    const retried = transition(paused, { type: 'retry' });
    expect(isResume(paused, { type: 'retry' }, retried)).toBe(false);
    expect(transition(paused, { type: 'quit' })).toEqual({ id: 'levelSelect' });
  });

  it('restart while playing: retry -> a fresh playing state (never a resume)', () => {
    const playing: ScreenState = { id: 'playing', levelId: 'testpad' };
    const restarted = transition(playing, { type: 'retry' });
    expect(restarted).toEqual(playing);
    expect(restarted).not.toBe(playing); // App.dispatch ignores same-object transitions
    expect(isResume(playing, { type: 'retry' }, restarted)).toBe(false);
  });

  it('results: retry, back, continue (with optional cutscene)', () => {
    const results: ScreenState = { id: 'results', levelId: 'hangarRun', outcome: { kind: 'complete', timeSec: 60, orbs: 0, score: 1 } };
    expect(transition(results, { type: 'retry' })).toEqual({ id: 'playing', levelId: 'hangarRun' });
    expect(transition(results, { type: 'back' })).toEqual({ id: 'levelSelect' });
    expect(transition(results, { type: 'continue', next: 'descent', cutsceneAfter: 'meetIo' })).toEqual({
      id: 'cutscene',
      cutsceneId: 'meetIo',
      then: { id: 'playing', levelId: 'descent' },
    });
    expect(transition(results, { type: 'continue', next: null })).toEqual({ id: 'levelSelect' });
  });

  it('level end goes to results', () => {
    const s = transition({ id: 'playing', levelId: 'testpad' }, { type: 'levelEnded', outcome: { kind: 'failed', cause: 'impact' } });
    expect(s).toEqual({ id: 'results', levelId: 'testpad', outcome: { kind: 'failed', cause: 'impact' } });
  });

  it('ignores invalid actions (same object)', () => {
    const title: ScreenState = { id: 'title' };
    expect(transition(title, { type: 'pause' })).toBe(title);
    expect(transition(INITIAL_STATE, { type: 'start' })).toBe(INITIAL_STATE);
  });
});

import { describe, expect, it } from 'vitest';
import { STORY_LEVELS } from '../src/contracts';
import type { LevelId, LevelSpec, ScreenState } from '../src/contracts';
import { continuePlan, continueTarget, isUnlocked, levelCutscenes, modeSwitchCutscene, nextStoryLevel, selectLevelAction } from '../src/story/flow';
import { defaultSave, recordResult } from '../src/story/save';
import { transition } from '../src/shell/state';

/** Minimal fake specs: only the fields flow.ts reads. */
const fake = (id: LevelId, extra: Partial<LevelSpec> = {}) => ({ id, ...extra }) as LevelSpec;
const allBuilt = (id: LevelId) => fake(id);
const noneBuilt = () => undefined;

const done = { kind: 'complete', timeSec: 42, orbs: 3, score: 900 } as const;

describe('story sequencing', () => {
  it('orders levels by STORY_LEVELS; testpad leads into Map 1', () => {
    expect(nextStoryLevel('hangarRun')).toBe('descent');
    expect(nextStoryLevel('keeper')).toBe('madDash');
    expect(nextStoryLevel('madDash')).toBe('springIsles'); // round 15: the post-final map
    expect(nextStoryLevel('springIsles')).toBeNull();
    expect(nextStoryLevel('testpad')).toBe('hangarRun');
    expect(nextStoryLevel('physlab')).toBeNull();
  });

  it('level specs override the default hooks', () => {
    expect(levelCutscenes('hangarRun')).toEqual({ before: 'briefing', after: 'meetIo' });
    expect(levelCutscenes('hangarRun', fake('hangarRun', { cutsceneAfter: 'finale' }))).toEqual({ before: 'briefing', after: 'finale' });
    expect(levelCutscenes('testpad')).toEqual({});
  });

  it('select plays the "before" cutscene, then the level', () => {
    const a = selectLevelAction('hangarRun', allBuilt);
    expect(a).toEqual({ type: 'selectLevel', levelId: 'hangarRun', cutsceneBefore: 'briefing' });
    const s = transition({ id: 'levelSelect' }, a);
    expect(s).toEqual({ id: 'cutscene', cutsceneId: 'briefing', then: { id: 'playing', levelId: 'hangarRun' } });
    expect(selectLevelAction('descent', allBuilt)).toEqual({ type: 'selectLevel', levelId: 'descent' });
  });

  it('continue plays "after" (or the next level\'s "before") then starts the next level', () => {
    expect(continuePlan('hangarRun', allBuilt).action).toEqual({ type: 'continue', next: 'descent', cutsceneAfter: 'meetIo' });
    expect(continuePlan('hollow', allBuilt).action).toEqual({ type: 'continue', next: 'keeper', cutsceneAfter: 'keeperWakes' });
    expect(continuePlan('madDash', allBuilt).action).toEqual({ type: 'continue', next: 'springIsles', cutsceneAfter: 'finale' });
    expect(continuePlan('springIsles', allBuilt).action).toEqual({ type: 'continue', next: null });
    // Unbuilt next level: story cutscene still plays, then level select.
    expect(continuePlan('testpad', noneBuilt).action).toEqual({ type: 'continue', next: null, cutsceneAfter: 'briefing' });
  });

  it('chains the finished level\'s "after" and the next level\'s "before"', () => {
    const specs = (id: LevelId) =>
      id === 'descent' ? fake(id, { cutsceneAfter: 'descentAwe' }) : id === 'floatingIsles' ? fake(id, { cutsceneBefore: 'csmSeized' }) : fake(id);
    const plan = continuePlan('descent', specs);
    expect(plan.cutscenes).toEqual(['descentAwe', 'csmSeized']);
    expect(plan.action).toEqual({ type: 'continue', next: 'floatingIsles', cutsceneAfter: 'descentAwe' });
    // Default table: Map 1 has both hooks; testpad -> Map 1 plays its "before".
    expect(continuePlan('testpad', allBuilt).cutscenes).toEqual(['briefing']);
    expect(continuePlan('hollow', allBuilt).cutscenes).toEqual(['keeperWakes']);
    expect(continuePlan('keeper', (id) => (id === 'madDash' ? fake(id, { cutsceneBefore: 'keeperFalls' }) : fake(id))).cutscenes).toEqual(['keeperFalls']);
    expect(continuePlan('physlab', allBuilt)).toEqual({ action: { type: 'continue', next: null }, cutscenes: [] });
  });

  it('walks the whole arc through the state machine, in order', () => {
    const seen: string[] = [];
    let chain: string[] = [];
    let save = defaultSave();
    let s: ScreenState = transition({ id: 'levelSelect' }, selectLevelAction('hangarRun', allBuilt));
    for (let guard = 0; guard < 100 && s.id !== 'levelSelect'; guard++) {
      if (s.id === 'cutscene') {
        seen.push(s.cutsceneId, ...chain);
        chain = [];
        s = transition(s, { type: 'cutsceneDone' });
      } else if (s.id === 'playing') {
        seen.push(s.levelId);
        expect(isUnlocked(save, s.levelId)).toBe(true);
        s = transition(s, { type: 'levelEnded', outcome: done });
      } else if (s.id === 'results') {
        save = recordResult(save, s.levelId, s.outcome);
        const plan = continuePlan(s.levelId, allBuilt);
        chain = plan.cutscenes.slice(1); // the App plays these inside the same cutscene screen
        s = transition(s, plan.action);
      } else throw new Error(`unexpected ${s.id}`);
    }
    expect(seen).toEqual([
      'briefing', 'hangarRun', 'meetIo', 'descent', 'descentAwe', 'floatingIsles', 'emptyOutpost', 'throat', 'podTransfer',
      'vaults', 'teamFound', 'hollow', 'keeperWakes', 'keeper', 'keeperFalls', 'madDash', 'finale', 'springIsles',
    ]);
    expect(save.unlocked).toEqual([...STORY_LEVELS]);
  });

  it('game over -> retry the same level, nothing unlocked', () => {
    let save = defaultSave();
    const failed = { kind: 'failed', cause: 'hullDestroyed' } as const;
    let s: ScreenState = transition({ id: 'playing', levelId: 'hangarRun' }, { type: 'levelEnded', outcome: failed });
    save = recordResult(save, 'hangarRun', failed);
    expect(save.unlocked).toEqual(['hangarRun']);
    s = transition(s, { type: 'retry' });
    expect(s).toEqual({ id: 'playing', levelId: 'hangarRun' });
  });

  it('unlock rules: story levels need an unlock, debug levels never do', () => {
    let save = defaultSave();
    expect(isUnlocked(save, 'hangarRun')).toBe(true);
    expect(isUnlocked(save, 'descent')).toBe(false);
    expect(isUnlocked(save, 'testpad')).toBe(true);
    save = recordResult(save, 'hangarRun', done);
    expect(isUnlocked(save, 'descent')).toBe(true);
    expect(isUnlocked(save, 'floatingIsles')).toBe(false);
  });

  it('continue-from-title picks the furthest unlocked, built level', () => {
    let save = defaultSave();
    expect(continueTarget(save, allBuilt)).toBe('hangarRun');
    expect(continueTarget(save, noneBuilt)).toBeNull();
    save = recordResult(recordResult(save, 'hangarRun', done), 'descent', done);
    expect(continueTarget(save, allBuilt)).toBe('floatingIsles');
    expect(continueTarget(save, (id) => (id === 'floatingIsles' ? undefined : fake(id)))).toBe('descent');
  });

  it('mode-switch cutscene: spec first, default for Map 3', () => {
    const sw = { to: 'lander', trigger: { kind: 'start' } } as const;
    expect(modeSwitchCutscene('floatingIsles', fake('floatingIsles', { modeSwitch: sw }))).toBe('csmSeized');
    expect(modeSwitchCutscene('floatingIsles', fake('floatingIsles', { modeSwitch: { ...sw, cutscene: 'finale' } }))).toBe('finale');
    expect(modeSwitchCutscene('floatingIsles', fake('floatingIsles'))).toBeUndefined();
  });
});

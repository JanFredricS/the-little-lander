/**
 * S8 headless-session story coverage (NOT the App: see
 * test/app.story.test.ts for the App-level flow). The pure screen state
 * machine + story flow
 * (title -> briefing -> map 1 ... map 8 -> finale/credits -> level select),
 * where every `playing` screen runs the REAL LevelSession for that map,
 * flown by its reference autopilot (maps 1-4: src/levels/dev routes; maps
 * 5-8: the S7 pilots) with real InputFrames. Mirrors what the App does:
 * results NEXT plays continuePlan()'s cutscene chain, a vesselModeChanged
 * event plays the mid-level cutscene (map 3). Any console.error / warn
 * during the run fails the test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORY_LEVELS } from '../src/contracts';
import type { CutsceneId, GameEvent, LevelId, ScreenState } from '../src/contracts';
import { STILL_IDS } from '../src/art/stills';
import { LevelSession } from '../src/game/session';
import { getLevel } from '../src/levels/registry';
import { INITIAL_STATE, transition } from '../src/shell/state';
import { continuePlan, isUnlocked, modeSwitchCutscene, selectLevelAction } from '../src/story/flow';
import { defaultSave, recordResult } from '../src/story/save';
import { getCutscene } from '../src/story/scripts';
import { MIN_COMPLETION_FUEL, pilotFor } from './support/storyPilots';

interface MapRun {
  id: LevelId;
  events: GameEvent[];
  fuel: number;
  hull: number;
  timeSec: number;
}

async function playMap(id: LevelId, seen: string[]): Promise<MapRun> {
  const spec = getLevel(id)!;
  const s = await LevelSession.create(spec);
  const events: GameEvent[] = [];
  const mid = modeSwitchCutscene(id, spec);
  s.on((e) => {
    events.push(e);
    if (e.type === 'vesselModeChanged' && mid) seen.push(`${mid} (mid-level)`);
  });
  s.start();
  const pilot = pilotFor(id);
  for (let i = 0; i < 60 * 600 && !s.outcome; i++) s.step(pilot(s, i));
  const r = { id, events, fuel: s.state.fuel, hull: s.state.hull, timeSec: s.simTime };
  const outcome = s.outcome;
  s.destroy();
  expect(outcome?.kind, `${id}: ${JSON.stringify(outcome)}`).toBe('complete');
  return r;
}

describe('headless story playthrough (all 8 maps, real sessions, no App)', () => {
  const errors: unknown[][] = [];
  beforeEach(() => {
    errors.length = 0;
    vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a));
    vi.spyOn(console, 'warn').mockImplementation((...a) => void errors.push(a));
  });
  afterEach(() => vi.restoreAllMocks());

  it('title -> briefing -> maps 1-8 -> finale + credits -> level select, no console errors', { timeout: 600_000 }, async () => {
    const seen: string[] = [];
    const runs: MapRun[] = [];
    let chain: CutsceneId[] = [];
    let save = defaultSave();
    let s: ScreenState = transition(INITIAL_STATE, { type: 'booted' });
    expect(s.id).toBe('title');
    s = transition(s, { type: 'start' });
    s = transition(s, selectLevelAction('hangarRun', getLevel));
    const played: CutsceneId[] = [];
    for (let guard = 0; guard < 100 && s.id !== 'levelSelect'; guard++) {
      if (s.id === 'cutscene') {
        for (const c of [s.cutsceneId, ...chain]) {
          played.push(c);
          seen.push(c);
        }
        chain = [];
        s = transition(s, { type: 'cutsceneDone' });
      } else if (s.id === 'playing') {
        expect(isUnlocked(save, s.levelId), s.levelId).toBe(true);
        seen.push(s.levelId);
        const run = await playMap(s.levelId, seen);
        runs.push(run);
        const done = run.events.find((e): e is Extract<GameEvent, { type: 'levelComplete' }> => e.type === 'levelComplete')!;
        s = transition(s, { type: 'levelEnded', outcome: { kind: 'complete', timeSec: done.timeSec, orbs: done.orbs, score: done.score } });
      } else if (s.id === 'results') {
        expect(s.outcome.kind).toBe('complete');
        save = recordResult(save, s.levelId, s.outcome);
        const plan = continuePlan(s.levelId, getLevel);
        chain = plan.cutscenes.slice(1); // the App plays these inside the same cutscene screen
        s = transition(s, plan.action);
      } else throw new Error(`unexpected screen ${s.id}`);
    }

    expect(seen).toEqual([
      'briefing', 'hangarRun', 'meetIo', 'descent', 'descentAwe',
      'floatingIsles', 'csmSeized (mid-level)', 'emptyOutpost',
      'throat', 'podTransfer', 'vaults', 'teamFound', 'hollow', 'keeperWakes',
      'keeper', 'keeperFalls', 'madDash', 'finale', 'springIsles',
    ]);
    expect(s).toEqual({ id: 'levelSelect' });
    expect(save.unlocked).toEqual([...STORY_LEVELS]);
    expect(STORY_LEVELS.every((id) => save.best[id] !== undefined)).toBe(true);

    // map 3: exactly one CSM -> lander switch; map 7: the boss dies; map 8 ends the story
    const ev = (id: LevelId, t: GameEvent['type']) => runs.find((r) => r.id === id)!.events.filter((e) => e.type === t);
    expect(ev('floatingIsles', 'vesselModeChanged')).toEqual([{ type: 'vesselModeChanged', from: 'csm', to: 'lander' }]);
    expect(ev('keeper', 'bossDefeated')).toHaveLength(1);
    // difficulty: every map keeps its fuel margin (S8 curve; see MIN_COMPLETION_FUEL)
    for (const r of runs) expect(r.fuel, `${r.id} completion fuel`).toBeGreaterThanOrEqual(MIN_COMPLETION_FUEL[r.id]!);
    // round 15: the finale (credits) now continues into Map 9, Spring Isles; it is the last map (no cutscene after)
    expect(continuePlan('madDash', getLevel)).toEqual({ action: { type: 'continue', next: 'springIsles', cutsceneAfter: 'finale' }, cutscenes: ['finale'] });
    expect(continuePlan('springIsles', getLevel)).toEqual({ action: { type: 'continue', next: null }, cutscenes: [] });

    // every cutscene that played has a script whose stills exist; the finale carries the credits
    for (const c of played) for (const shot of getCutscene(c).shots) expect(STILL_IDS).toContain(shot.still);
    expect(getCutscene('finale').shots.some((sh) => sh.textLines.includes('THE END'))).toBe(true);

    expect(errors, JSON.stringify(errors.slice(0, 3))).toEqual([]);
  });
});

/** Round 10 (G): the mission stated on the level-start card, derived generically from the objectives. */

import { describe, expect, it } from 'vitest';
import type { ObjectiveSpec } from '../src/contracts';
import { LEVELS } from '../src/levels/registry';
import { MISSION_LINE_CHARS, missionLines, missionPhrase, missionTips } from '../src/ui/controlsHelp';

describe('mission line', () => {
  it('one phrase per objective kind', () => {
    expect(missionPhrase({ kind: 'plantBeacons', id: 'b', count: 3, siteIds: ['a', 'b', 'c'] })).toBe('PLANT 3 BEACONS');
    expect(missionPhrase({ kind: 'plantBeacons', id: 'b', count: 1, siteIds: ['a'] })).toBe('PLANT 1 BEACON');
    expect(missionPhrase({ kind: 'collectOrbs', id: 'o', count: 4 })).toBe('COLLECT 4 ORBS');
    expect(missionPhrase({ kind: 'collectOrbs', id: 'o', count: 1 })).toBe('COLLECT 1 ORB');
    expect(missionPhrase({ kind: 'reachExit', id: 'e', exitId: 'x' })).toBe('REACH THE EXIT');
    expect(missionPhrase({ kind: 'surviveBoss', id: 'k', bossEntityId: 'b' })).toBe('DEFEAT THE KEEPER');
  });

  it('"MISSION: ..." joins the objectives in order; long ones wrap between phrases', () => {
    expect(missionLines([{ kind: 'plantBeacons', id: 'b', count: 3, siteIds: ['a', 'b', 'c'] }])).toEqual(['MISSION: PLANT 3 BEACONS']);
    expect(missionLines([])).toEqual([]);
    const all: ObjectiveSpec[] = [
      { kind: 'collectOrbs', id: 'o', count: 12 },
      { kind: 'plantBeacons', id: 'b', count: 3, siteIds: [] },
      { kind: 'surviveBoss', id: 'k', bossEntityId: 'b' },
      { kind: 'reachExit', id: 'e', exitId: 'x' },
    ];
    const lines = missionLines(all);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(MISSION_LINE_CHARS);
    expect(lines.join(' ').replace(/\s+\+/g, ' +')).toBe('MISSION: COLLECT 12 ORBS + PLANT 3 BEACONS + DEFEAT THE KEEPER + REACH THE EXIT'.replace(/\s+\+/g, ' +'));
  });

  it('every phrase fits a line (counts up to 999), and the guard cuts anything longer', () => {
    for (const count of [1, 9, 99, 999]) {
      for (const o of [
        { kind: 'plantBeacons', id: 'b', count, siteIds: [] },
        { kind: 'collectOrbs', id: 'o', count },
      ] as ObjectiveSpec[])
        expect(missionLines([o])[0]!.length).toBeLessThanOrEqual(MISSION_LINE_CHARS);
    }
  });

  it('every shipped level has a mission line that fits the card', () => {
    for (const [id, spec] of Object.entries(LEVELS)) {
      const lines = missionLines(spec!.objectives);
      expect(lines.length, id).toBeGreaterThan(0);
      expect(lines[0], id).toMatch(/^MISSION: /);
      for (const l of lines) expect(l.length, id).toBeLessThanOrEqual(MISSION_LINE_CHARS);
    }
  });

  it('round 21: the Keeper card says HOW to hurt it (harpoon a cracked roof rock, reel in); other levels add nothing', () => {
    const keeper = LEVELS.keeper!;
    const tips = missionTips(keeper.objectives);
    expect(tips.join(' ')).toBe('HARPOON THE CRACKED ROCKS IN THE ROOF, REEL IN HARD TO DROP THEM ON THE KEEPER');
    for (const l of tips) expect(l.length).toBeLessThanOrEqual(MISSION_LINE_CHARS);
    // the start card's mission block (GameUi.levelStarted): the mission line, then the tips
    expect([...missionLines(keeper.objectives), ...tips]).toEqual([
      'MISSION: DEFEAT THE KEEPER',
      'HARPOON THE CRACKED ROCKS IN THE ROOF,',
      'REEL IN HARD TO DROP THEM ON THE KEEPER',
    ]);
    // each objective kind's tips once, however many objectives of that kind
    expect(missionTips([...keeper.objectives, ...keeper.objectives])).toEqual(tips);
    for (const [id, spec] of Object.entries(LEVELS)) if (!spec!.objectives.some((o) => o.kind === 'surviveBoss')) expect(missionTips(spec!.objectives), id).toEqual([]);
  });
});

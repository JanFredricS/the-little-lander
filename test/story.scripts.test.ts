import { describe, expect, it } from 'vitest';
import type { CutsceneId, StillId } from '../src/contracts';
import { hasGlyph, textWidth, wrapText } from '../src/story/font';
import { shotCharCount, TEXT_BOX_COLS, TEXT_BOX_ROWS, TYPE_CPS } from '../src/story/playback';
import { CUTSCENE_IDS, CUTSCENES, getCutscene, isCutsceneId } from '../src/story/scripts';
import { STORY_CUTSCENES, MID_LEVEL_CUTSCENES } from '../src/story/flow';

const ALL_IDS: CutsceneId[] = ['briefing', 'meetIo', 'descentAwe', 'csmSeized', 'emptyOutpost', 'podTransfer', 'teamFound', 'keeperWakes', 'keeperFalls', 'finale'];
const ALL_STILLS: StillId[] = [
  'asterFromOrbit', 'halcyonBriefingDeck', 'commanderPortrait', 'wrenPortrait', 'ioPortrait', 'hangarLaunch',
  'landerCockpit', 'csmCockpitRough', 'floatingIslandsVista', 'dragonBirdAttack', 'emptyOutpost', 'caveMouthPodTransfer',
  'researchTeamFound', 'hollowSunKeeper', 'keeperDefeated', 'collapseEscape', 'reunionAboveClouds', 'beaconRoadDawn',
];

describe('cutscene scripts', () => {
  it('has one script per CutsceneId, keyed by its own id', () => {
    expect([...CUTSCENE_IDS].sort()).toEqual([...ALL_IDS].sort());
    for (const id of ALL_IDS) {
      expect(getCutscene(id).id).toBe(id);
      expect(getCutscene(id).shots.length).toBeGreaterThan(2);
      expect(isCutsceneId(id)).toBe(true);
    }
    expect(isCutsceneId('nope')).toBe(false);
    expect(isCutsceneId('toString')).toBe(false);
  });

  it('uses every still at least once', () => {
    const used = new Set(Object.values(CUTSCENES).flatMap((s) => s.shots.map((sh) => sh.still)));
    for (const still of ALL_STILLS) expect(used, still).toContain(still);
  });

  it('every line fits the 2-row text box and the pixel font', () => {
    for (const script of Object.values(CUTSCENES)) {
      for (const [i, shot] of script.shots.entries()) {
        const where = `${script.id}#${i}`;
        expect(shot.textLines.length, where).toBeLessThanOrEqual(TEXT_BOX_ROWS);
        for (const line of shot.textLines) {
          expect(line.length, `${where}: ${line}`).toBeLessThanOrEqual(TEXT_BOX_COLS);
          expect(line, where).toBe(line.trim());
          for (const ch of line) expect(hasGlyph(ch), `${where}: '${ch}' in ${line}`).toBe(true);
        }
        if (shot.textLines.length) expect(shot.speaker, where).toBeDefined();
      }
    }
  });

  it('duration shots leave time to read', () => {
    for (const script of Object.values(CUTSCENES)) {
      for (const [i, shot] of script.shots.entries()) {
        if (shot.advance.kind !== 'duration') continue;
        expect(shot.advance.seconds, `${script.id}#${i}`).toBeGreaterThanOrEqual(shotCharCount(shot) / TYPE_CPS + 1);
      }
    }
  });

  it('the cast speaks: Wren, Io and the Commander all have lines', () => {
    const speakers = new Set(Object.values(CUTSCENES).flatMap((s) => s.shots.map((sh) => sh.speaker)));
    for (const who of ['wren', 'io', 'commander', 'team', 'keeper', 'narrator'] as const) expect(speakers).toContain(who);
  });

  it('every cutscene is reachable from the story flow', () => {
    const hooked = new Set<CutsceneId>();
    for (const c of Object.values(STORY_CUTSCENES)) {
      if (c?.before) hooked.add(c.before);
      if (c?.after) hooked.add(c.after);
    }
    for (const c of Object.values(MID_LEVEL_CUTSCENES)) if (c) hooked.add(c);
    expect([...hooked].sort()).toEqual([...ALL_IDS].sort());
  });
});

describe('pixel font', () => {
  it('wraps on word boundaries and hard-splits long words', () => {
    expect(wrapText('one two three', 7)).toEqual(['one two', 'three']);
    expect(wrapText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrapText('  ', 10)).toEqual([]);
  });

  it('measures text', () => {
    expect(textWidth('')).toBe(0);
    expect(textWidth('ab')).toBe(11);
  });
});

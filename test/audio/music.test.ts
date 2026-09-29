import { describe, expect, it } from 'vitest';
import { THEME_IDS } from '../../src/contracts';
import { composeBar, MOOD_IDS, MOODS, moodBpm, Sequencer } from '../../src/audio/music';
import { FakeDriver, FakeGroup } from './fakeDriver';

describe('music sequencer', () => {
  it('has a mood for every ThemeId plus title and cutscene', () => {
    for (const t of THEME_IDS) expect(MOOD_IDS).toContain(t);
    expect(MOOD_IDS).toContain('title');
    expect(MOOD_IDS).toContain('cutscene');
    expect(Object.keys(MOODS).sort()).toEqual([...MOOD_IDS].sort());
  });

  it('composeBar is deterministic per seed and varies across seeds', () => {
    for (const m of MOOD_IDS) {
      const a = Array.from({ length: 8 }, (_, bar) => composeBar(m, 42, bar));
      const b = Array.from({ length: 8 }, (_, bar) => composeBar(m, 42, bar));
      const c = Array.from({ length: 8 }, (_, bar) => composeBar(m, 43, bar));
      expect(a, m).toEqual(b);
      expect(a, m).not.toEqual(c);
      for (const bar of a) {
        expect(bar.length, m).toBeGreaterThan(0);
        for (const n of bar) {
          expect(n.step).toBeGreaterThanOrEqual(0);
          expect(n.step).toBeLessThan(16);
          expect(n.len).toBeGreaterThan(0);
          expect(n.vel).toBeGreaterThan(0);
        }
      }
    }
  });

  it('melody repeats in 8-bar form (A A\' B B\')', () => {
    const lead = (bar: number) => composeBar('title', 7, bar).filter((n) => n.voice === 'lead').map((n) => [n.step, n.midi]);
    expect(lead(0)).toEqual(lead(8));
    expect(lead(1)).toEqual(lead(9));
  });

  it('Sequencer renders identical note streams for the same seed', () => {
    const run = (seed: number) => {
      const d = new FakeDriver();
      d.state = 'running';
      const s = new Sequencer(d, 'hangar', seed, 0);
      for (let t = 0; t < 10; t += 0.025) s.schedule(t + 0.15);
      return d.voices().map((c) => [c.kind, c.spec.start.toFixed(4), c.kind === 'tone' ? c.spec.freq.toFixed(2) : '', c.spec.gain.toFixed(4)]);
    };
    const a = run(9);
    expect(a.length).toBeGreaterThan(50);
    expect(run(9)).toEqual(a);
    expect(run(10)).not.toEqual(a);
  });

  it('asteroid tension accelerates tempo and density', () => {
    expect(moodBpm('asteroid', 1)).toBeGreaterThan(moodBpm('asteroid', 0) * 1.4);
    expect(moodBpm('hangar', 1)).toBe(moodBpm('hangar', 0));
    const count = (t: number) => Array.from({ length: 8 }, (_, b) => composeBar('asteroid', 1, b, t).length).reduce((x, y) => x + y);
    expect(count(1)).toBeGreaterThan(count(0));
  });

  it('crossfade: fading sequencer scales gain down to silence and reports it', () => {
    const d = new FakeDriver();
    d.state = 'running';
    const s = new Sequencer(d, 'boss', 1, 0);
    s.fadeTo(0, 0, 1);
    expect(s.levelAt(0)).toBe(1);
    expect(s.levelAt(0.5)).toBeCloseTo(0.5);
    expect(s.levelAt(1)).toBe(0);
    s.schedule(3);
    const late = d.voices().filter((c) => c.spec.start > 1.01);
    expect(late).toEqual([]);
    expect(s.isSilentAfter(1.1)).toBe(true);
  });

  it('crossfade reaches voices that were already sounding before the mood change', () => {
    const d = new FakeDriver();
    d.state = 'running';
    const s = new Sequencer(d, 'cutscene', 1, 0);
    s.schedule(0.1); // bar 0 step 0: the underscore pad (whole bar, ~3.4 s) is scheduled now
    const pad = d.voices().find((c) => c.kind === 'tone' && c.spec.dur > 3);
    expect(pad).toBeDefined();
    const g = pad!.spec.group as FakeGroup;
    expect(g).toBe(s.group);
    expect(g.gainAt(0.5)).toBe(1);
    s.fadeTo(0, 0.5, 1.2); // mood change after the pad started
    const padEnd = pad!.spec.start + pad!.spec.dur;
    expect(padEnd).toBeGreaterThan(1.7);
    expect(g.gainAt(1.1)).toBeCloseTo(0.5);
    expect(g.gainAt(1.7)).toBe(0);
    expect(g.gainAt(padEnd)).toBe(0);
    s.dispose();
    expect(g.disposed).toBe(true);
  });

  it('skips missed steps after a stalled timer instead of bunching them', () => {
    const d = new FakeDriver();
    d.state = 'running';
    const s = new Sequencer(d, 'collapse', 1, 0);
    s.schedule(0.1, 0);
    d.clear();
    s.schedule(5.15, 5);
    for (const c of d.voices()) expect(c.spec.start).toBeGreaterThanOrEqual(5);
  });
});

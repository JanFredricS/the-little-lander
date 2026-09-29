import { describe, expect, it, vi } from 'vitest';
import type { CutsceneScript } from '../src/contracts';
import { CutscenePlayback, SKIP_HOLD_SEC, TYPE_CPS } from '../src/story/playback';

const script: CutsceneScript = {
  id: 'briefing',
  shots: [
    { still: 'asterFromOrbit', speaker: 'narrator', textLines: ['Twenty chars of text'], advance: { kind: 'duration', seconds: 2 } },
    { still: 'commanderPortrait', speaker: 'commander', textLines: ['Line one.', 'Line two.'], advance: { kind: 'key' } },
    { still: 'wrenPortrait', textLines: [], advance: { kind: 'key' } },
  ],
};

/** Step in small increments like a frame loop. */
function run(pb: CutscenePlayback, seconds: number, skipHeld = false, dt = 1 / 60): void {
  for (let t = 0; t < seconds - 1e-9; t += dt) pb.update(Math.min(dt, seconds - t), skipHeld);
}

describe('cutscene playback', () => {
  it('types text out at TYPE_CPS', () => {
    const pb = new CutscenePlayback(script);
    expect(pb.visibleChars).toBe(0);
    run(pb, 10 / TYPE_CPS + 0.001);
    expect(pb.visibleChars).toBe(10);
    expect(pb.visibleRows()).toEqual(['Twenty cha']);
    expect(pb.typingDone).toBe(false);
  });

  it('duration shots auto-advance after `seconds`', () => {
    const pb = new CutscenePlayback(script);
    run(pb, 1.9);
    expect(pb.shotIndex).toBe(0);
    run(pb, 0.2);
    expect(pb.shotIndex).toBe(1);
  });

  it('duration shots never advance before the text has typed out', () => {
    const s: CutsceneScript = { id: 'finale', shots: [{ still: 'beaconRoadDawn', speaker: 'narrator', textLines: ['x'.repeat(80)], advance: { kind: 'duration', seconds: 0.5 } }, script.shots[1]!] };
    const pb = new CutscenePlayback(s);
    run(pb, 1);
    expect(pb.shotIndex).toBe(0);
    run(pb, 1.1);
    expect(pb.shotIndex).toBe(1);
  });

  it('a press on a duration shot reveals, then skips ahead', () => {
    const pb = new CutscenePlayback(script);
    pb.press();
    expect(pb.typingDone).toBe(true);
    expect(pb.shotIndex).toBe(0);
    pb.press();
    expect(pb.shotIndex).toBe(1);
  });

  it('key shots wait for a press after typing, across multiple lines', () => {
    const pb = new CutscenePlayback(script);
    pb.press();
    pb.press(); // -> shot 1
    expect(pb.totalChars).toBe(18);
    run(pb, 12 / TYPE_CPS + 0.001);
    expect(pb.visibleRows()).toEqual(['Line one.', 'Lin']);
    expect(pb.waitingForKey).toBe(false);
    run(pb, 30);
    expect(pb.shotIndex).toBe(1); // never auto-advances
    expect(pb.waitingForKey).toBe(true);
    pb.press();
    expect(pb.shotIndex).toBe(2);
  });

  it('first press mid-typing only reveals the text', () => {
    const pb = new CutscenePlayback(script);
    pb.press();
    pb.press();
    run(pb, 0.05);
    pb.press();
    expect(pb.shotIndex).toBe(1);
    expect(pb.visibleRows()).toEqual(['Line one.', 'Line two.']);
  });

  it('picture-only shots wait for a press, and the last press ends the script', () => {
    const onDone = vi.fn();
    const pb = new CutscenePlayback(script, onDone);
    pb.press();
    pb.press();
    pb.press();
    pb.press(); // -> shot 2 (no text)
    expect(pb.shotIndex).toBe(2);
    expect(pb.waitingForKey).toBe(true);
    expect(pb.done).toBe(false);
    pb.press();
    expect(pb.done).toBe(true);
    expect(pb.skipped).toBe(false);
    expect(onDone).toHaveBeenCalledExactlyOnceWith(false);
    pb.press();
    pb.update(1, true);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('holding skip for SKIP_HOLD_SEC skips the whole script', () => {
    const onDone = vi.fn();
    const pb = new CutscenePlayback(script, onDone);
    run(pb, SKIP_HOLD_SEC * 0.5, true);
    expect(pb.skipProgress).toBeGreaterThan(0.4);
    expect(pb.done).toBe(false);
    pb.update(1 / 60, false); // released: resets
    expect(pb.skipProgress).toBe(0);
    run(pb, SKIP_HOLD_SEC + 0.05, true);
    expect(pb.done).toBe(true);
    expect(pb.skipped).toBe(true);
    expect(onDone).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('skip() ends immediately; bad dt is ignored', () => {
    const pb = new CutscenePlayback(script);
    pb.update(Number.NaN);
    pb.update(-5);
    expect(pb.visibleChars).toBe(0);
    pb.skip();
    expect(pb.done && pb.skipped).toBe(true);
  });

  it('an empty script is done at once', () => {
    const onDone = vi.fn();
    const pb = new CutscenePlayback({ id: 'finale', shots: [] }, onDone);
    expect(pb.done).toBe(true);
    expect(onDone).toHaveBeenCalledWith(false);
  });

  it('plays every real script to the end with presses alone', async () => {
    const { CUTSCENES } = await import('../src/story/scripts');
    for (const s of Object.values(CUTSCENES)) {
      const pb = new CutscenePlayback(s);
      let n = 0;
      while (!pb.done && n++ < 1000) pb.press();
      expect(pb.done, s.id).toBe(true);
      expect(n).toBeLessThanOrEqual(s.shots.length * 2);
    }
  });
});

describe('still scaling', () => {
  it('integer scale when >= 2x fits, fractional fill below', async () => {
    const { stillScale } = await import('../src/story/cutscenePlayer');
    const land = stillScale(812, 375, 2); // phone landscape: 3x
    expect(land.fractional).toBe(false);
    expect(land.deviceScale).toBe(3);
    expect(land.cssWidth).toBe(639);
    const port = stillScale(375, 812, 2); // phone portrait: fill the width
    expect(port.fractional).toBe(true);
    expect(port.cssWidth).toBeCloseTo(375);
    expect(port.offsetX).toBeCloseTo(0);
    expect(port.offsetY).toBeGreaterThan(0);
  });
});

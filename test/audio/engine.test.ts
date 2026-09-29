import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../src/contracts';
import { AudioEngine, GESTURE_EVENTS } from '../../src/audio/engine';
import { DEFAULT_SETTINGS, loadSettings, SETTINGS_KEY } from '../../src/audio/settings';
import { FakeDriver, MemStorage } from './fakeDriver';
import { SAMPLE_EVENTS } from './samples';

function mk(storage: MemStorage | null = new MemStorage()) {
  const d = new FakeDriver();
  const e = new AudioEngine(d, { storage, autoTick: false });
  return { d, e, storage };
}

describe('volume persistence', () => {
  it('defaults when storage is empty, null or corrupt', () => {
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(new MemStorage())).toEqual(DEFAULT_SETTINGS);
    const bad = new MemStorage();
    bad.setItem(SETTINGS_KEY, '{not json');
    expect(loadSettings(bad)).toEqual(DEFAULT_SETTINGS);
    bad.setItem(SETTINGS_KEY, JSON.stringify({ master: 'loud', music: 7, muted: 'yes' }));
    expect(loadSettings(bad)).toEqual({ ...DEFAULT_SETTINGS, music: 1 });
  });

  it('round-trips volume and mute through storage', () => {
    const { e, storage } = mk();
    e.setVolume('music', 0.25);
    e.setVolume('sfx', 0.4);
    e.setVolume('master', 2); // clamped
    e.setMuted(true);
    const again = new AudioEngine(new FakeDriver(), { storage, autoTick: false });
    expect(again.settings).toEqual({ master: 1, music: 0.25, sfx: 0.4, muted: true });
  });

  it('survives a throwing storage', () => {
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
    };
    const e = new AudioEngine(new FakeDriver(), { storage: throwing, autoTick: false });
    expect(e.settings).toEqual(DEFAULT_SETTINGS);
    expect(() => e.setVolume('music', 0.1)).not.toThrow();
    expect(e.settings.music).toBe(0.1);
  });

  it('drives bus gains: mute zeroes master, pause ducks music', async () => {
    const { d, e } = mk();
    await e.unlock();
    e.setVolume('master', 0.5);
    expect(d.gains.master).toBe(0.5);
    e.toggleMute();
    expect(d.gains.master).toBe(0);
    e.toggleMute();
    e.onScreen({ id: 'paused', levelId: 'testpad' });
    expect(d.gains.music).toBeCloseTo(DEFAULT_SETTINGS.music * 0.35);
    e.onScreen({ id: 'playing', levelId: 'testpad' });
    expect(d.gains.music).toBeCloseTo(DEFAULT_SETTINGS.music);
  });
});

describe('engine lifecycle + wiring', () => {
  it('is silent until unlocked by a gesture; retries after a denied resume', async () => {
    const { d, e } = mk();
    expect(e.play('uiMove')).toBe(false);
    const target = new EventTarget();
    d.denyResume = true;
    e.bindGestures(target);
    target.dispatchEvent(new Event('pointerdown'));
    await Promise.resolve();
    expect(e.running).toBe(false);
    d.denyResume = false;
    target.dispatchEvent(new Event('touchend'));
    await new Promise((r) => setTimeout(r, 0));
    expect(e.running).toBe(true);
    expect(e.play('uiMove')).toBe(true);
    expect(GESTURE_EVENTS).toEqual(expect.arrayContaining(['pointerdown', 'touchstart', 'keydown']));
    e.dispose();
  });

  it('suspends while hidden and resumes when visible', async () => {
    const { d, e } = mk();
    await e.unlock();
    e.setHidden(true);
    await Promise.resolve();
    expect(d.state).toBe('suspended');
    e.setHidden(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(d.state).toBe('running');
  });

  it('relights thrusters that were lit when the page was hidden', async () => {
    const { d, e } = mk();
    await e.unlock();
    e.handle({ type: 'levelStarted', levelId: 'hangarRun', themeId: 'hangar', mode: 'lander' });
    e.handle({ type: 'enginesChanged', main: false, left: true, right: true });
    expect(d.liveLoops.size).toBe(2);
    e.setHidden(true);
    await Promise.resolve();
    expect(d.liveLoops.size).toBe(0);
    e.setHidden(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(d.state).toBe('running');
    expect(d.liveLoops.size).toBe(2);
    expect(e.thrusters.active.sort()).toEqual(['left', 'right']);
  });

  it('overlapping hide -> show before suspend resolves ends running', async () => {
    const { d, e } = mk();
    await e.unlock();
    e.handle({ type: 'enginesChanged', main: true, left: false, right: false });
    d.holdSuspend = true;
    const hide = e.setHidden(true);
    const show = e.setHidden(false); // tab back before the suspend landed
    await Promise.resolve();
    d.releaseSuspend(); // the slow suspend lands now
    await hide;
    await show;
    expect(d.state).toBe('running');
    expect(e.running).toBe(true);
    expect(d.liveLoops.size).toBe(1);
    // and the reverse: show -> hide quickly ends suspended
    d.holdSuspend = false;
    const h2 = e.setHidden(true);
    await e.setHidden(false);
    await e.setHidden(true);
    await h2;
    expect(d.state).toBe('suspended');
  });

  it('never unlocks on show without a prior gesture', async () => {
    const { d, e } = mk();
    await e.setHidden(true);
    await e.setHidden(false);
    expect(d.state).toBe('uninit');
  });

  it('handles every sample event without throwing', async () => {
    const { d, e } = mk();
    await e.unlock();
    for (const ev of Object.values(SAMPLE_EVENTS) as GameEvent[]) {
      d.time += 1;
      expect(() => e.handle(ev)).not.toThrow();
    }
    e.tick();
  });

  it('levelStarted sets theme mood and mode; gravity ramp feeds tension', async () => {
    const { d, e } = mk();
    await e.unlock();
    e.handle(SAMPLE_EVENTS.levelStarted);
    expect(e.currentMood).toBe('asteroid');
    expect(e.thrusters.currentMode).toBe('csm');
    e.handle({ type: 'gravityChanged', gravity: { x: 0, y: 12 }, rampProgress: 0.7 });
    e.tick();
    expect(e.currentTension).toBeCloseTo(0.7);
    expect(e.sequencers.at(-1)!.tension).toBeCloseTo(0.7);
    d.time = 2;
    e.tick();
    expect(d.voices().some((c) => c.spec.bus === 'music')).toBe(true);
  });

  it('crossfades moods: old sequencer fades out and is dropped', async () => {
    const { d, e } = mk();
    await e.unlock();
    e.setMood('hangar');
    for (d.time = 0; d.time < 2; d.time += 0.025) e.tick(); // hangar fully faded in
    d.time = 2;
    e.setMood('caves');
    expect(e.sequencers.map((s) => s.mood)).toEqual(['hangar', 'caves']);
    const hangarGroup = d.groups[0]!;
    // crossfade is 1.2 s from t=2: the old group must stay alive and audible mid-fade
    for (; d.time < 3.0; d.time += 0.025) e.tick();
    expect(hangarGroup.gainAt(3.0)).toBeGreaterThan(0.1);
    expect(hangarGroup.gainAt(3.19)).toBeGreaterThan(0);
    expect(hangarGroup.disposed).toBe(false);
    for (; d.time < 3.6; d.time += 0.025) e.tick(); // fade ended at 3.2, tail margin 0.5 not over yet
    expect(hangarGroup.gainAt(3.2)).toBe(0);
    expect(hangarGroup.disposed).toBe(false);
    expect(e.sequencers.map((s) => s.mood)).toEqual(['hangar', 'caves']);
    for (; d.time < 5; d.time += 0.025) e.tick();
    expect(e.sequencers.map((s) => s.mood)).toEqual(['caves']);
    expect(hangarGroup.gainAt(d.time)).toBe(0);
    expect(hangarGroup.disposed).toBe(true);
    e.onScreen({ id: 'cutscene', cutsceneId: 'briefing', then: { id: 'title' } });
    expect(e.currentMood).toBe('cutscene');
    e.onScreen({ id: 'title' });
    expect(e.currentMood).toBe('title');
  });

  it('thruster loops follow enginesChanged per engine and stop on crash / pause', async () => {
    const { d, e } = mk();
    await e.unlock();
    e.handle({ type: 'levelStarted', levelId: 'hangarRun', themeId: 'hangar', mode: 'lander' });
    e.handle({ type: 'enginesChanged', main: false, left: true, right: true });
    expect(d.liveLoops.size).toBe(2);
    e.handle({ type: 'enginesChanged', main: false, left: true, right: false });
    expect(d.liveLoops.size).toBe(1);
    e.onScreen({ id: 'paused', levelId: 'hangarRun' });
    expect(d.liveLoops.size).toBe(0);
    e.handle({ type: 'enginesChanged', main: true, left: false, right: false });
    expect(d.liveLoops.size).toBe(1);
    e.handle(SAMPLE_EVENTS.crash);
    expect(d.liveLoops.size).toBe(0);
  });

  it('thruster timbre differs per mode', async () => {
    const { d, e } = mk();
    await e.unlock();
    const specFor = (mode: 'csm' | 'lander' | 'harpoonThrust') => {
      d.clear();
      e.thrusters.stopAll();
      e.thrusters.setMode(mode);
      e.handle({ type: 'enginesChanged', main: true, left: false, right: false });
      const c = d.calls.find((x) => x.kind === 'loop');
      return c && c.kind === 'loop' ? c.spec : null;
    };
    const a = specFor('csm');
    const b = specFor('lander');
    const c = specFor('harpoonThrust');
    expect(a!.wave).not.toBe(b!.wave);
    expect(b!.wave).not.toBe(c!.wave);
    expect(a!.wobble).toBeDefined();
  });

  it('throttles event storms of the same SFX', async () => {
    const { d, e } = mk();
    await e.unlock();
    d.time = 1;
    expect(e.play('bump')).toBe(true);
    expect(e.play('bump')).toBe(false);
    d.time = 1.2;
    expect(e.play('bump')).toBe(true);
    e.setMuted(true);
    expect(e.play('crash')).toBe(false);
  });
});

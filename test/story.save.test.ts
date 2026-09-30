import { describe, expect, it } from 'vitest';
import { SAVE_STORAGE_KEY, SAVE_VERSION } from '../src/contracts';
import { CORRUPT_SUFFIX, DEFAULT_SETTINGS, defaultSave, loadSave, markCutsceneSeen, parseSave, recordResult, SaveStore, writeSave, type StorageLike } from '../src/story/save';

class MemStorage implements StorageLike {
  readonly map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const throwing: StorageLike = {
  getItem() {
    throw new Error('SecurityError');
  },
  setItem() {
    throw new Error('QuotaExceededError');
  },
  removeItem() {
    throw new Error('nope');
  },
};

const done = (timeSec: number, orbs: number, score: number) => ({ kind: 'complete', timeSec, orbs, score }) as const;

describe('save state', () => {
  it('S9: swapEngineButtons defaults ON, old saves without it read ON, and it persists', () => {
    expect(DEFAULT_SETTINGS.swapEngineButtons).toBe(true);
    const old = parseSave({ version: SAVE_VERSION, unlocked: ['hangarRun'], best: {}, seenCutscenes: [], settings: { musicVolume: 0.5, sfxVolume: 0.5, reducedMotion: false, touchControls: 'auto', debugOverlay: false } });
    expect(old!.settings.swapEngineButtons).toBe(true);
    expect(parseSave({ settings: { swapEngineButtons: "yes" } })!.settings.swapEngineButtons).toBe(true);
    const mem = new Map<string, string>();
    const storage: StorageLike = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
    const a = new SaveStore(storage);
    a.setSettings({ swapEngineButtons: false });
    expect(new SaveStore(storage).state.settings.swapEngineButtons).toBe(false);
    a.setSettings({ swapEngineButtons: true });
    expect(new SaveStore(storage).state.settings.swapEngineButtons).toBe(true);
  });

  it('showFps defaults OFF, old saves without it read OFF, and it persists', () => {
    expect(DEFAULT_SETTINGS.showFps).toBe(false);
    expect(parseSave({ settings: { swapEngineButtons: false } })!.settings.showFps).toBe(false);
    expect(parseSave({ settings: { showFps: 1 } })!.settings.showFps).toBe(false);
    const storage = new MemStorage();
    new SaveStore(storage).setSettings({ showFps: true });
    expect(new SaveStore(storage).state.settings.showFps).toBe(true);
  });

  it('defaults: Map 1 unlocked, nothing seen, default settings', () => {
    const s = defaultSave();
    expect(s).toEqual({ version: SAVE_VERSION, unlocked: ['hangarRun'], best: {}, seenCutscenes: [], settings: DEFAULT_SETTINGS });
    expect(s.settings).not.toBe(DEFAULT_SETTINGS);
  });

  it('round-trips through storage', () => {
    const mem = new MemStorage();
    let s = recordResult(defaultSave(), 'hangarRun', done(61.5, 2, 1200));
    s = markCutsceneSeen(markCutsceneSeen(s, 'briefing'), 'briefing');
    s = { ...s, settings: { ...s.settings, musicVolume: 0.25, touchControls: 'on' } };
    expect(writeSave(mem, s)).toBe(true);
    expect(mem.map.has(SAVE_STORAGE_KEY)).toBe(true);
    const r = loadSave(mem);
    expect(r.status).toBe('ok');
    expect(r.save).toEqual(s);
    expect(r.save.seenCutscenes).toEqual(['briefing']);
  });

  it('bests keep the best of each field; failures change nothing', () => {
    let s = recordResult(defaultSave(), 'descent', done(90, 1, 500));
    s = recordResult(s, 'descent', done(80, 0, 400));
    expect(s.best.descent).toEqual({ timeSec: 80, orbs: 1, score: 500 });
    const same = recordResult(s, 'descent', { kind: 'failed', cause: 'impact' });
    expect(same).toBe(s);
  });

  it('recovers from corrupted JSON and keeps the bad text aside', () => {
    const mem = new MemStorage();
    mem.setItem(SAVE_STORAGE_KEY, '{"unlocked": [oops');
    const r = loadSave(mem);
    expect(r.status).toBe('corrupt');
    expect(r.save).toEqual(defaultSave());
    expect(mem.getItem(SAVE_STORAGE_KEY + CORRUPT_SUFFIX)).toBe('{"unlocked": [oops');
    for (const bad of ['null', '42', '"str"', '[1,2]']) {
      mem.setItem(SAVE_STORAGE_KEY, bad);
      expect(loadSave(mem).status, bad).toBe('corrupt');
    }
  });

  it('repairs partial / hand-edited saves', () => {
    const s = parseSave({
      unlocked: ['descent', 'bogus', 7, 'descent'],
      best: { hangarRun: { timeSec: 30, orbs: -3, score: 'x' }, throat: { orbs: 2 }, nope: { timeSec: 1 } },
      seenCutscenes: ['briefing', 'notACutscene'],
      settings: { musicVolume: 3, sfxVolume: 'loud', touchControls: 'sometimes', reducedMotion: true },
    })!;
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.unlocked).toEqual(['hangarRun', 'descent']); // Map 1 always; hangarRun best implies descent
    expect(s.best).toEqual({ hangarRun: { timeSec: 30, orbs: 0, score: 0 } });
    expect(s.seenCutscenes).toEqual(['briefing']);
    expect(s.settings).toEqual({ ...DEFAULT_SETTINGS, musicVolume: 1, reducedMotion: true });
    expect(parseSave({})).toEqual(defaultSave());
  });

  it('survives storage that throws (private mode / quota)', () => {
    expect(loadSave(throwing).status).toBe('unavailable');
    expect(loadSave(null).status).toBe('unavailable');
    expect(writeSave(throwing, defaultSave())).toBe(false);
    const store = new SaveStore(throwing);
    store.recordResult('hangarRun', done(10, 0, 1));
    expect(store.state.unlocked).toContain('descent'); // kept in memory
  });

  it('SaveStore writes through, notifies and reloads', () => {
    const mem = new MemStorage();
    const a = new SaveStore(mem);
    expect(a.loadStatus).toBe('empty');
    const seen: string[][] = [];
    a.onChange((s) => seen.push(s.unlocked));
    a.recordResult('hangarRun', done(50, 1, 100));
    a.markCutsceneSeen('meetIo');
    a.markCutsceneSeen('meetIo'); // no-op, no extra notification
    a.setSettings({ sfxVolume: 0.1 });
    expect(seen).toHaveLength(3);
    const b = new SaveStore(mem);
    expect(b.loadStatus).toBe('ok');
    expect(b.state).toEqual(a.state);
    b.resetProgress();
    expect(b.state.unlocked).toEqual(['hangarRun']);
    expect(b.state.settings.sfxVolume).toBe(0.1);
  });
});

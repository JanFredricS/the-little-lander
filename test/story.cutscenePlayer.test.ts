import { describe, expect, it, vi } from 'vitest';
import type { ArtApi, CutsceneScript } from '../src/contracts';
import { playCutscene } from '../src/story/cutscenePlayer';
import { SKIP_HOLD_SEC } from '../src/story/playback';

/** Minimal event-target + element fakes: the player only touches a handful of DOM APIs. */
class FakeTarget {
  private listeners = new Map<string, Set<(e: unknown) => void>>();
  addEventListener(type: string, fn: (e: unknown) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  dispatch(type: string, e: unknown): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(e);
  }
}

const noopCtx = new Proxy({}, { get: (_t, k) => (k === 'imageSmoothingEnabled' ? false : () => undefined), set: () => true });

class FakeEl extends FakeTarget {
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  clientWidth = 1280;
  clientHeight = 720;
  width = 0;
  height = 0;
  constructor(readonly ownerDocument: unknown) {
    super();
  }
  appendChild(): void {}
  remove(): void {}
  getContext(): unknown {
    return noopCtx;
  }
}

class FakeWin extends FakeTarget {
  devicePixelRatio = 1;
  private cb: ((t: number) => void) | null = null;
  private now = 0;
  requestAnimationFrame(cb: (t: number) => void): number {
    this.cb = cb;
    return 1;
  }
  cancelAnimationFrame(): void {
    this.cb = null;
  }
  /** Run frames at 60 Hz for `seconds`. */
  step(seconds: number): void {
    for (let t = 0; t < seconds - 1e-9 && this.cb; t += 1 / 60) {
      const cb = this.cb;
      this.cb = null;
      this.now += 1000 / 60;
      cb(this.now);
    }
  }
  key(type: 'keydown' | 'keyup', code: string): void {
    this.dispatch(type, { type, code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {}, stopImmediatePropagation() {} });
  }
}

const script: CutsceneScript = {
  id: 'briefing',
  shots: [
    { still: 'commanderPortrait', speaker: 'commander', textLines: ['A fairly long line of dialogue to type.'], advance: { kind: 'key' } },
    { still: 'wrenPortrait', speaker: 'wren', textLines: ['Second shot.'], advance: { kind: 'key' } },
    { still: 'asterFromOrbit', textLines: [], advance: { kind: 'key' } },
  ],
};

function setup() {
  const win = new FakeWin();
  const doc = { createElement: () => new FakeEl(doc) };
  const host = new FakeEl(doc);
  const art = { getStill: () => ({}) } as unknown as ArtApi;
  const onDone = vi.fn();
  const handle = playCutscene(host as unknown as HTMLElement, script, { art, onDone, win: win as unknown as Window });
  win.step(0.05); // first frame(s): start typing
  return { win, handle, onDone };
}

describe('cutscene player Esc input', () => {
  it('a short Esc tap reveals, a second tap advances, and neither skips', () => {
    const { win, handle, onDone } = setup();
    const pb = handle.playback;
    expect(pb.typingDone).toBe(false);

    win.key('keydown', 'Escape');
    win.step(0.1);
    win.key('keyup', 'Escape');
    expect(pb.typingDone).toBe(true);
    expect(pb.shotIndex).toBe(0);
    expect(pb.done).toBe(false);

    win.key('keydown', 'Escape');
    win.step(0.1);
    win.key('keyup', 'Escape');
    expect(pb.shotIndex).toBe(1);
    expect(pb.done).toBe(false);
    expect(onDone).not.toHaveBeenCalled();
    handle.destroy();
  });

  it(`holding Esc for SKIP_HOLD_SEC (${SKIP_HOLD_SEC}s) skips the whole cutscene`, () => {
    const { win, handle, onDone } = setup();
    win.key('keydown', 'Escape');
    win.step(SKIP_HOLD_SEC + 0.1);
    expect(handle.playback.done).toBe(true);
    expect(handle.playback.skipped).toBe(true);
    expect(onDone).toHaveBeenCalledWith(true);
    win.key('keyup', 'Escape'); // late release after skip: harmless
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

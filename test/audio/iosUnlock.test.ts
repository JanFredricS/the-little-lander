/**
 * Round 9: "audio does not work on iPhone - never worked. Works on Mac."
 *
 * The REAL AudioEngine + WebAudioDriver against a WebKit-like fake
 * AudioContext: it starts 'suspended', and resume() only takes effect when
 * called while a user gesture is being dispatched (touchend / click - not
 * touchstart / pointerdown); otherwise the promise stays PENDING (WebKit
 * resolves it only once the context really runs). The old engine called
 * resume() from a promise chain after the gesture, so on iOS it never ran and
 * the serial queue stayed blocked behind that pending resume().
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUDIO_DIAG_MAX, AudioEngine, GESTURE_EVENTS } from '../../src/audio/engine';
import { isIOS, silentWavUri, WebAudioDriver } from '../../src/audio/webDriver';

let gesture = false;
const contexts: FakeCtx[] = [];

const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {}, exponentialRampToValueAtTime() {} });
const node = () => ({ connect() {}, disconnect() {}, start() {}, stop() {}, gain: param(), threshold: param(), ratio: param(), frequency: param(), Q: param(), detune: param(), pan: param(), buffer: null as unknown, loop: false, onended: null as unknown });

class FakeCtx extends EventTarget {
  state: 'suspended' | 'running' | 'interrupted' | 'closed' = 'suspended';
  readonly sampleRate = 8000;
  readonly currentTime = 0;
  readonly destination = node();
  resumeCalls = 0;
  gestureResumes = 0;
  silentStarts = 0;
  /** WebKit: a gesture's resume() lands a moment LATER (the state still reads 'suspended' meanwhile). */
  asyncGesture = false;
  /** Control-message order: a suspend() issued after a resume() wins. */
  private op = 0;
  private pending: (() => void)[] = [];
  constructor() {
    super();
    contexts.push(this);
  }
  private set(s: FakeCtx['state']) {
    if (s === this.state) return;
    this.state = s;
    this.dispatchEvent(new Event('statechange'));
  }
  resume(): Promise<void> {
    this.resumeCalls++;
    if (gesture) {
      this.gestureResumes++;
      if (!this.asyncGesture) {
        this.land();
        return Promise.resolve();
      }
      const id = ++this.op;
      return new Promise((res) =>
        setTimeout(() => {
          if (id === this.op) this.land();
          res();
        }, 0),
      );
    }
    if (this.state === 'running') return Promise.resolve();
    return new Promise((res) => this.pending.push(res)); // WebKit: pending until it really runs
  }
  private land() {
    this.set('running');
    this.pending.splice(0).forEach((f) => f());
  }
  suspend(): Promise<void> {
    this.op++;
    this.set('suspended');
    return Promise.resolve();
  }
  /** iOS: a phone call / Siri / another app took the audio session. */
  interrupt() {
    this.set('interrupted');
  }
  /** iOS: the interruption ended and the system resumed the context by itself (no gesture). */
  endInterruption() {
    this.land();
  }
  createDynamicsCompressor = node;
  createGain = node;
  createBiquadFilter = node;
  createStereoPanner = node;
  createOscillator = node;
  createDelay = node;
  createBufferSource = () => {
    const n = node();
    n.start = () => {
      if (gesture) this.silentStarts++;
    };
    return n;
  };
  createBuffer(_ch: number, len: number) {
    return { getChannelData: () => new Float32Array(len) };
  }
}

class FakeAudioEl {
  paused = true;
  plays = 0;
  loop = false;
  src = '';
  preload = '';
  attrs: Record<string, string> = {};
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  play(): Promise<void> {
    this.plays++;
    if (!gesture) return Promise.reject(new Error('NotAllowedError'));
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  released = false;
  removeAttribute(k: string) {
    if (k === 'src') this.src = '';
  }
  load() {
    this.released = this.src === '';
  }
}

const els: FakeAudioEl[] = [];
/** navigator.audioSession (Safari 16.4+). */
const session = { type: 'auto' };
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('iOS Web Audio unlock (WebKit-like fake context)', () => {
  beforeEach(() => {
    contexts.length = 0;
    els.length = 0;
    gesture = false;
    vi.stubGlobal('AudioContext', FakeCtx);
    session.type = 'auto';
    vi.stubGlobal('navigator', { userAgent: 'test', audioSession: session });
    vi.stubGlobal('document', {
      createElement: (t: string) => {
        expect(t).toBe('audio');
        const e = new FakeAudioEl();
        els.push(e);
        return e;
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const mk = (keepAlive: 'on' | 'off' = 'on', storage: Storage | null = null) => {
    const driver = new WebAudioDriver({ keepAlive });
    const engine = new AudioEngine(driver, { autoTick: false, storage });
    const win = new EventTarget();
    engine.bindGestures(win);
    /** A real tap: touchstart / pointerdown are NOT activations on iOS, the end of the touch is. */
    const tap = () => {
      win.dispatchEvent(new Event('touchstart'));
      win.dispatchEvent(new Event('pointerdown'));
      gesture = true;
      win.dispatchEvent(new Event('touchend'));
      gesture = false;
      win.dispatchEvent(new Event('pointerup'));
      win.dispatchEvent(new Event('click'));
    };
    return { driver, engine, win, tap };
  };

  it('a pre-activation event creates the context suspended; the first touchend unlocks it inside the gesture (no deadlock)', async () => {
    const { engine, win, tap } = mk();
    win.dispatchEvent(new Event('touchstart')); // not an iOS activation
    await flush();
    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.state).toBe('suspended');
    expect(engine.running).toBe(false);
    expect(engine.play('uiMove')).toBe(false);
    tap();
    // resume() + a silent buffer ran synchronously within the touchend dispatch
    expect(contexts[0]!.gestureResumes).toBe(1);
    expect(contexts[0]!.silentStarts).toBeGreaterThanOrEqual(1);
    expect(contexts[0]!.state).toBe('running');
    await flush(); // the engine's queued bookkeeping (it was blocked behind the pending pre-gesture resume)
    expect(engine.running).toBe(true);
    expect(engine.play('uiMove')).toBe(true);
    expect(contexts).toHaveLength(1); // one context for the page
    engine.dispose();
  });

  it('the silent-switch keep-alive <audio playsinline loop> starts from the same first gesture', async () => {
    const { tap } = mk('on');
    tap();
    await flush();
    expect(els).toHaveLength(1);
    const el = els[0]!;
    expect(el.paused).toBe(false);
    expect(el.loop).toBe(true);
    expect('playsinline' in el.attrs).toBe(true);
    expect(el.src).toMatch(/^data:audio\/wav;base64,/);
  });

  it('unlock is idempotent: once running, further gestures touch nothing', async () => {
    const { tap } = mk('on');
    tap();
    await flush();
    const ctx = contexts[0]!;
    const resumes = ctx.resumeCalls;
    const plays = els[0]!.plays;
    for (let i = 0; i < 10; i++) tap();
    await flush();
    expect(ctx.resumeCalls).toBe(resumes);
    expect(els[0]!.plays).toBe(plays);
    expect(contexts).toHaveLength(1);
    expect(els).toHaveLength(1);
  });

  it('an iOS interruption drops the engine; the next gesture re-unlocks it', async () => {
    const { engine, tap } = mk('on');
    tap();
    await flush();
    const ctx = contexts[0]!;
    ctx.interrupt();
    await flush();
    expect(engine.running).toBe(false);
    expect(engine.play('uiMove')).toBe(false);
    expect(engine.diag).toBe('AUDIO ctx:interrupted ka:on | run>susp');
    tap();
    await flush();
    expect(ctx.state).toBe('running');
    expect(engine.running).toBe(true);
    expect(engine.play('uiMove')).toBe(true);
    expect(engine.diag).toBe('AUDIO ctx:running ka:on | run>susp>run');
  });

  it('hidden -> visible: suspends + pauses the keep-alive; the show resume() stays pending until a gesture, which then unblocks everything', async () => {
    const { engine, tap } = mk('on');
    tap();
    await flush();
    const ctx = contexts[0]!;
    await engine.setHidden(true);
    expect(ctx.state).toBe('suspended');
    expect(els[0]!.paused).toBe(true);
    void engine.setHidden(false); // no gesture: WebKit keeps this resume pending
    await flush();
    expect(engine.running).toBe(false);
    tap();
    await flush();
    expect(ctx.state).toBe('running');
    expect(els[0]!.paused).toBe(false);
    expect(engine.running).toBe(true);
    expect(engine.play('uiMove')).toBe(true);
  });

  it('audit 1: an interruption that ends BY ITSELF relights held engines (no gesture, no re-press)', async () => {
    const { engine, tap } = mk('on');
    tap();
    await flush();
    engine.handle({ type: 'levelStarted', levelId: 'hangarRun', themeId: 'hangar', mode: 'lander' } as never);
    engine.handle({ type: 'enginesChanged', main: true, left: false, right: false } as never);
    expect(engine.thrusters.voiceCount).toBe(1);
    const ctx = contexts[0]!;
    ctx.interrupt();
    await flush();
    expect(engine.thrusters.voiceCount).toBe(0);
    ctx.endInterruption(); // the system restores the session: no gesture follows
    await flush();
    expect(engine.running).toBe(true);
    expect(engine.thrusters.voiceCount).toBe(1);
    expect(engine.thrusters.active).toEqual(['main']);
  });

  it('audit 2: muted = the ambient session and no keep-alive (the player\'s own music keeps playing); unmute from a gesture claims playback again', async () => {
    const { engine, win, tap } = mk('on');
    engine.setMuted(true);
    tap();
    await flush();
    expect(engine.running).toBe(true);
    expect(session.type).toBe('ambient');
    expect(els).toHaveLength(0); // never created while muted
    // unmute from a click (the gesture: play() is allowed)
    win.addEventListener('click', () => engine.setMuted(false));
    gesture = true;
    win.dispatchEvent(new Event('click'));
    gesture = false;
    expect(session.type).toBe('playback');
    expect(els).toHaveLength(1);
    expect(els[0]!.paused).toBe(false);
    // mute again: the session and the keep-alive are given back at once
    engine.setMuted(true);
    expect(session.type).toBe('ambient');
    expect(els[0]!.paused).toBe(true);
    // gestures while muted do not restart it
    tap();
    await flush();
    expect(els[0]!.paused).toBe(true);
    expect(engine.diag).not.toMatch(/TAP/);
  });

  it('audit 2: a game muted from a previous visit starts in the ambient session', async () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } as unknown as Storage;
    mk('on', storage).engine.setMuted(true);
    session.type = 'auto';
    const { tap } = mk('on', storage);
    tap();
    await flush();
    expect(session.type).toBe('ambient');
    expect(els.filter((e) => !e.paused)).toHaveLength(0);
  });

  it('audit 3: hide, show, then click + hide in the same moment: the late-landing gesture resume() cannot leave a hidden page running', async () => {
    const { engine, tap } = mk('on');
    tap();
    await flush();
    const ctx = contexts[0]!;
    ctx.asyncGesture = true;
    void engine.setHidden(true);
    await flush();
    void engine.setHidden(false); // pending (no gesture)
    await flush();
    tap(); // resume() issued in the gesture, lands a moment later
    void engine.setHidden(true);
    await flush();
    await flush();
    expect(ctx.state).toBe('suspended');
    expect(els[0]!.paused).toBe(true);
  });

  it('audit 3: interrupted, then click + hide in the same moment: ends suspended', async () => {
    const { engine, tap } = mk('on');
    tap();
    await flush();
    const ctx = contexts[0]!;
    ctx.asyncGesture = true;
    ctx.interrupt();
    await flush();
    tap();
    void engine.setHidden(true);
    await flush();
    await flush();
    expect(ctx.state).toBe('suspended');
  });

  it('audit 7: the debug line stays short (worst case: odd session, keep-alive paused, locked, full log)', async () => {
    const { engine, tap } = mk('on');
    tap();
    await flush();
    const ctx = contexts[0]!;
    for (let i = 0; i < 6; i++) {
      ctx.interrupt();
      ctx.endInterruption();
    }
    ctx.interrupt();
    session.type = 'play-and-record';
    (engine as unknown as { unlocked: boolean }).unlocked = false;
    els[0]!.pause();
    const d = engine.diag;
    expect(d).toMatch(/^AUDIO ctx:interrupted ka:paused sess:play-and TAP \| [a-z]+>[a-z]+>[a-z]+$/);
    expect(d.length).toBeLessThanOrEqual(AUDIO_DIAG_MAX);
  });

  it('audit 8: dispose releases the keep-alive element', async () => {
    const { engine, tap } = mk('on');
    tap();
    await flush();
    const el = els[0]!;
    expect(el.paused).toBe(false);
    engine.dispose();
    expect(el.paused).toBe(true);
    expect(el.src).toBe('');
    expect(el.released).toBe(true);
  });

  it('desktop (no keep-alive): same unlock, no <audio> element ever', async () => {
    const { engine, tap } = mk('off');
    tap();
    await flush();
    expect(engine.running).toBe(true);
    expect(els).toHaveLength(0);
  });

  it('the gesture list includes the iOS activation events (the END of a touch)', () => {
    expect(GESTURE_EVENTS).toEqual(expect.arrayContaining(['touchend', 'pointerup', 'click', 'keydown']));
  });

  it('isIOS: iPhone / iPad (incl. iPadOS desktop UA) yes; Mac / Android no', () => {
    expect(isIOS({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5 })).toBe(true);
    expect(isIOS({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    expect(isIOS({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
    expect(isIOS({ userAgent: 'Mozilla/5.0 (Linux; Android 14)', platform: 'Linux armv8l', maxTouchPoints: 5 })).toBe(false);
  });

  it('silentWavUri: a valid PCM WAV of silence', () => {
    const b = Uint8Array.from(atob(silentWavUri().split(',')[1]!), (c) => c.charCodeAt(0));
    const tag = (o: number) => String.fromCharCode(...b.slice(o, o + 4));
    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    const dv = new DataView(b.buffer);
    expect(dv.getUint32(4, true)).toBe(b.length - 8);
    expect(dv.getUint32(40, true)).toBe(b.length - 44);
    expect(b.slice(44).every((x) => x === 128)).toBe(true);
  });
});

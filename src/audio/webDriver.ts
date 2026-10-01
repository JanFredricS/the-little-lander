/**
 * WebAudio implementation of AudioDriver. Graph:
 *
 *   voices -> [music bus | sfx bus] -> master -> compressor -> destination
 *
 * Every voice is built from short-lived nodes that stop themselves; nothing
 * here decides WHAT to play.
 *
 * iOS Safari (round 9: "audio never worked on iPhone, works on Mac"):
 *  - gestureUnlock() runs synchronously inside the gesture handler: it creates
 *    the context, calls resume() and starts a 1-sample silent buffer in the
 *    gesture's own call stack (a resume() from a later microtask / promise
 *    chain is not a gesture on iOS and stays pending).
 *  - the hardware ring/silent switch mutes Web Audio (the "ambient" audio
 *    session). navigator.audioSession.type = 'playback' fixes it on Safari 17+;
 *    for older iOS a looping silent <audio playsinline> element is started from
 *    the same gesture, which switches the page to the media "playback" session
 *    so Web Audio ignores the switch. iOS only; paused while the page is hidden.
 *  - the context can drop to 'suspended' / 'interrupted' (calls, Siri, other
 *    apps, backgrounding): onStateChange tells the engine, and the next gesture
 *    unlocks it again (needsGesture).
 *  - while the game is MUTED (setPlayback(false)) it gives the playback session
 *    back: audioSession 'ambient', keep-alive paused, so the player's own music /
 *    podcasts keep playing and the game leaves Now Playing.
 * There is no decodeAudioData / OfflineAudioContext path: every sound is synthesised.
 */

import type { AudioDriver, BusId, GroupHandle, LoopHandle, LoopSpec, NoiseSpec, ToneSpec } from './driver';

/** GroupHandle backed by a GainNode (null node before the context exists). */
class WebGroup implements GroupHandle {
  constructor(
    readonly bus: BusId,
    readonly node: GainNode | null,
  ) {}
  fade(from: number, to: number, at: number, dur: number): void {
    const g = this.node?.gain;
    if (!g) return;
    g.cancelScheduledValues(at);
    g.setValueAtTime(from, at);
    g.linearRampToValueAtTime(to, at + Math.max(0.005, dur));
  }
  dispose(): void {
    this.node?.disconnect();
  }
}

type Ctor = typeof AudioContext;

/** iPhone / iPod / iPad (iPadOS reports a Mac with touch points). */
export function isIOS(nav: { userAgent?: string; platform?: string; maxTouchPoints?: number } | undefined = globalThis.navigator): boolean {
  if (!nav) return false;
  const ua = nav.userAgent ?? '';
  return /iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1);
}

/** A tiny silent 8-bit mono WAV (0.25 s at 8 kHz) as a data URI: the iOS keep-alive loop. */
export function silentWavUri(): string {
  const n = 2000;
  const b = new Uint8Array(44 + n);
  const dv = new DataView(b.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  str(0, 'RIFF');
  dv.setUint32(4, 36 + n, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, 8000, true);
  dv.setUint32(28, 8000, true);
  dv.setUint16(32, 1, true);
  dv.setUint16(34, 8, true);
  str(36, 'data');
  dv.setUint32(40, n, true);
  b.fill(128, 44); // 8-bit PCM silence
  let bin = '';
  for (const x of b) bin += String.fromCharCode(x);
  return `data:audio/wav;base64,${btoa(bin)}`;
}

export interface WebAudioDriverOptions {
  /** The iOS silent-switch keep-alive <audio> element: 'auto' (default) = iOS only. */
  keepAlive?: 'auto' | 'on' | 'off';
}

function audioContextCtor(): Ctor | null {
  const w = globalThis as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

const MIN_GAIN = 0.0001;

export class WebAudioDriver implements AudioDriver {
  private ctx: AudioContext | null = null;
  private keepAliveEl: HTMLAudioElement | null = null;
  private readonly wantKeepAlive: boolean;
  /** The page is hidden (suspend()ed): the keep-alive stays paused until resume(). */
  private parked = false;
  /** setPlayback(): claim the media playback session (false while muted). */
  private playback = true;
  private readonly stateFns = new Set<() => void>();

  constructor(opts: WebAudioDriverOptions = {}) {
    const k = opts.keepAlive ?? 'auto';
    this.wantKeepAlive = k === 'on' || (k === 'auto' && isIOS());
  }

  get needsGesture(): boolean {
    if (!this.ctx || this.ctx.state !== 'running') return true;
    return this.wantKeepAlive && this.playback && (!this.keepAliveEl || this.keepAliveEl.paused);
  }

  /** Short (the FPS corner): the session only when it is not the one asked for, clipped. */
  get diag(): string {
    const ka = !this.wantKeepAlive ? '' : !this.keepAliveEl ? ' ka:none' : this.keepAliveEl.paused ? ' ka:paused' : ' ka:on';
    const sess = (globalThis.navigator as { audioSession?: { type: string } } | undefined)?.audioSession?.type;
    const odd = sess && this.ctx && sess !== this.sessionType ? ` sess:${sess.slice(0, 8)}` : '';
    return `ctx:${this.ctx ? this.ctx.state : 'none'}${ka}${odd}`;
  }

  private get sessionType(): string {
    return this.playback ? 'playback' : 'ambient';
  }

  /** iOS Safari 16.4+: 'playback' plays through the silent switch; 'ambient' mixes with other apps' audio. */
  private applySession(): void {
    try {
      const sess = (globalThis.navigator as { audioSession?: { type: string } } | undefined)?.audioSession;
      if (sess && sess.type !== this.sessionType) sess.type = this.sessionType;
    } catch {
      /* older browsers: no audioSession */
    }
  }

  setPlayback(on: boolean): void {
    if (on === this.playback) return;
    this.playback = on;
    if (!this.ctx) return; // build() applies it
    this.applySession();
    if (on) this.playKeepAlive(); // from the unmute gesture
    else this.keepAliveEl?.pause();
  }

  dispose(): void {
    const el = this.keepAliveEl;
    this.keepAliveEl = null;
    this.stateFns.clear();
    if (!el) return;
    try {
      el.pause();
      el.removeAttribute('src');
      el.load();
    } catch {
      /* ignore */
    }
  }

  onStateChange(fn: () => void): () => void {
    this.stateFns.add(fn);
    return () => this.stateFns.delete(fn);
  }

  gestureUnlock(): void {
    if (!this.ctx) this.build();
    const ctx = this.ctx;
    if (ctx && ctx.state !== 'running') {
      // resume() + a started source INSIDE the gesture: what iOS needs to let the context run
      ctx.resume().catch(() => {});
      try {
        const src = ctx.createBufferSource();
        src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        src.connect(ctx.destination);
        src.start(0);
      } catch {
        /* best effort */
      }
    }
    this.parked = false;
    this.playKeepAlive();
  }

  private playKeepAlive(): void {
    if (!this.wantKeepAlive || !this.playback || this.parked || typeof document === 'undefined') return;
    let el = this.keepAliveEl;
    if (!el) {
      try {
        el = document.createElement('audio');
        el.setAttribute('playsinline', '');
        el.setAttribute('webkit-playsinline', '');
        el.setAttribute('x-webkit-airplay', 'deny');
        el.preload = 'auto';
        el.loop = true;
        el.src = silentWavUri();
        this.keepAliveEl = el;
      } catch {
        return;
      }
    }
    if (!el.paused) return;
    try {
      const p = el.play();
      if (p) p.catch(() => {}); // not in a gesture: the next one retries (needsGesture)
    } catch {
      /* ignore */
    }
  }
  private master!: GainNode;
  private buses!: Record<BusId, GainNode>;
  private noiseBuf!: AudioBuffer;
  private pendingGains: [BusId | 'master', number][] = [];

  get state(): AudioDriver['state'] {
    if (!this.ctx) return 'uninit';
    return this.ctx.state === 'running' ? 'running' : 'suspended';
  }

  now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  async resume(): Promise<void> {
    if (!this.ctx) this.build();
    // Always call resume(): a suspend() still in flight reports 'running', and
    // AudioContext queues resume after it, so skipping here would leave it suspended.
    this.parked = false;
    this.playKeepAlive(); // back from hidden: may be refused outside a gesture (the next gesture retries)
    if (this.ctx) await this.ctx.resume();
  }

  async suspend(): Promise<void> {
    this.parked = true;
    this.keepAliveEl?.pause(); // hidden page: give the media session back
    // always: a gesture's resume() may still be landing (state not yet 'running'); suspend() is ordered after it
    if (this.ctx) await this.ctx.suspend();
  }

  private build(): void {
    const C = audioContextCtor();
    if (!C) return;
    // iOS Safari 16.4+: without 'playback', WebAudio is muted by the ring/silent
    // hardware switch ('ambient' while the game is muted: see setPlayback).
    this.applySession();
    const ctx = new C({ latencyHint: 'interactive' });
    this.ctx = ctx;
    try {
      ctx.addEventListener('statechange', () => this.stateFns.forEach((f) => f()));
    } catch {
      /* old webkitAudioContext: no statechange (the gesture path still retries) */
    }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    const mk = () => {
      const g = ctx.createGain();
      g.connect(this.master);
      return g;
    };
    this.buses = { music: mk(), sfx: mk() };
    // 1 s of white noise, looped/offset for every noise voice.
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    let s = 0x9e3779b9;
    for (let i = 0; i < len; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      d[i] = ((s >>> 0) / 0xffffffff) * 2 - 1;
    }
    for (const [t, v] of this.pendingGains) this.setGain(t, v, 0);
    this.pendingGains = [];
  }

  setGain(target: BusId | 'master', value: number, ramp = 0.05): void {
    const ctx = this.ctx;
    if (!ctx) {
      this.pendingGains.push([target, value]);
      return;
    }
    const node = target === 'master' ? this.master : this.buses[target];
    const t = ctx.currentTime;
    node.gain.cancelScheduledValues(t);
    node.gain.setValueAtTime(node.gain.value, t);
    node.gain.linearRampToValueAtTime(value, t + Math.max(0.005, ramp));
  }

  /** Output chain: [filter] -> [panner] -> [echo] -> bus. Returns the chain input. */
  private chain(
    bus: BusId,
    start: number,
    end: number,
    filter?: ToneSpec['filter'],
    pan?: number,
    echo?: ToneSpec['echo'],
    group?: GroupHandle,
  ): AudioNode {
    const ctx = this.ctx!;
    let out: AudioNode = (group instanceof WebGroup && group.node) || this.buses[bus];
    if (echo) {
      const dry = ctx.createGain();
      const delay = ctx.createDelay(1);
      delay.delayTime.value = echo.delay;
      const fb = ctx.createGain();
      fb.gain.value = echo.feedback;
      const wet = ctx.createGain();
      wet.gain.value = echo.mix;
      dry.connect(out);
      dry.connect(delay);
      delay.connect(fb);
      fb.connect(delay);
      delay.connect(wet);
      wet.connect(out);
      // Break the feedback loop once the tail has died so nodes can be collected.
      const tail = Math.log(0.001) / Math.log(Math.max(0.01, echo.feedback)) * echo.delay;
      const stopAt = end + Math.min(4, tail);
      const ms = Math.max(0, (stopAt - ctx.currentTime) * 1000);
      setTimeout(() => {
        fb.disconnect();
        delay.disconnect();
        wet.disconnect();
        dry.disconnect();
      }, ms + 100);
      out = dry;
    }
    if (pan !== undefined && pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      p.connect(out);
      out = p;
    }
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type;
      f.Q.value = filter.q ?? 1;
      f.frequency.setValueAtTime(filter.freq, start);
      if (filter.freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(10, filter.freqEnd), end);
      f.connect(out);
      out = f;
    }
    return out;
  }

  private envelope(g: GainNode, start: number, dur: number, peak: number, attack: number, release: number): number {
    const p = Math.max(MIN_GAIN, peak);
    g.gain.setValueAtTime(MIN_GAIN, start);
    g.gain.linearRampToValueAtTime(p, start + attack);
    g.gain.setValueAtTime(p, start + Math.max(attack, dur - 0.001));
    const end = start + Math.max(attack, dur) + release;
    g.gain.exponentialRampToValueAtTime(MIN_GAIN, end);
    return end;
  }

  tone(t: ToneSpec): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const attack = t.attack ?? 0.004;
    const release = t.release ?? 0.02;
    const end = t.start + Math.max(attack, t.dur) + release;
    const osc = ctx.createOscillator();
    osc.type = t.wave;
    osc.frequency.setValueAtTime(t.freq, t.start);
    if (t.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, t.freqEnd), t.start + t.dur);
    const g = ctx.createGain();
    this.envelope(g, t.start, t.dur, t.gain, attack, release);
    osc.connect(g);
    g.connect(this.chain(t.bus, t.start, end, t.filter, t.pan, t.echo, t.group));
    const extra: OscillatorNode[] = [];
    if (t.fm) {
      const mod = ctx.createOscillator();
      mod.frequency.value = t.freq * t.fm.ratio;
      const mg = ctx.createGain();
      mg.gain.value = t.freq * t.fm.index;
      mod.connect(mg);
      mg.connect(osc.frequency);
      extra.push(mod);
    }
    if (t.vibrato) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = t.vibrato.rate;
      const lg = ctx.createGain();
      lg.gain.value = t.vibrato.cents;
      lfo.connect(lg);
      lg.connect(osc.detune);
      extra.push(lfo);
    }
    for (const o of [osc, ...extra]) {
      o.start(t.start);
      o.stop(end + 0.01);
    }
    osc.onended = () => g.disconnect();
  }

  noise(n: NoiseSpec): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const attack = n.attack ?? 0.002;
    const release = n.release ?? 0.03;
    const end = n.start + Math.max(attack, n.dur) + release;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const g = ctx.createGain();
    this.envelope(g, n.start, n.dur, n.gain, attack, release);
    src.connect(g);
    g.connect(this.chain(n.bus, n.start, end, n.filter, n.pan, undefined, n.group));
    src.start(n.start, Math.random() * 0.9);
    src.stop(end + 0.01);
    src.onended = () => g.disconnect();
  }

  group(bus: BusId): GroupHandle {
    const ctx = this.ctx;
    if (!ctx) return new WebGroup(bus, null);
    const g = ctx.createGain();
    g.gain.value = 1;
    g.connect(this.buses[bus]);
    return new WebGroup(bus, g);
  }

  loop(l: LoopSpec): LoopHandle {
    const ctx = this.ctx;
    if (!ctx) return { set() {}, stop() {} };
    const t0 = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(MIN_GAIN, t0);
    out.gain.linearRampToValueAtTime(Math.max(MIN_GAIN, l.gain), t0 + (l.attack ?? 0.05));
    let filter: BiquadFilterNode | null = null;
    let dest: AudioNode = this.buses[l.bus];
    if (l.pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = l.pan;
      p.connect(dest);
      dest = p;
    }
    if (l.filter) {
      filter = ctx.createBiquadFilter();
      filter.type = l.filter.type;
      filter.frequency.value = l.filter.freq;
      filter.Q.value = l.filter.q ?? 1;
      filter.connect(dest);
      dest = filter;
    }
    out.connect(dest);
    const sources: AudioScheduledSourceNode[] = [];
    let osc: OscillatorNode | null = null;
    if (l.wave && l.freq) {
      osc = ctx.createOscillator();
      osc.type = l.wave;
      osc.frequency.value = l.freq;
      osc.connect(out);
      sources.push(osc);
      if (l.wobble) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = l.wobble.rate;
        const lg = ctx.createGain();
        lg.gain.value = l.wobble.cents;
        lfo.connect(lg);
        lg.connect(osc.detune);
        sources.push(lfo);
      }
    }
    if (l.noise) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const ng = ctx.createGain();
      ng.gain.value = l.noise;
      src.connect(ng);
      ng.connect(out);
      sources.push(src);
    }
    for (const s of sources) s.start(t0);
    let stopped = false;
    return {
      set(p, ramp = 0.05) {
        if (stopped) return;
        const t = ctx.currentTime;
        const r = Math.max(0.005, ramp);
        if (p.freq !== undefined && osc) {
          osc.frequency.cancelScheduledValues(t);
          osc.frequency.setValueAtTime(osc.frequency.value, t);
          osc.frequency.linearRampToValueAtTime(p.freq, t + r);
        }
        if (p.gain !== undefined) {
          out.gain.cancelScheduledValues(t);
          out.gain.setValueAtTime(Math.max(MIN_GAIN, out.gain.value), t);
          out.gain.linearRampToValueAtTime(Math.max(MIN_GAIN, p.gain), t + r);
        }
        if (p.filterFreq !== undefined && filter) {
          filter.frequency.cancelScheduledValues(t);
          filter.frequency.setValueAtTime(filter.frequency.value, t);
          filter.frequency.linearRampToValueAtTime(p.filterFreq, t + r);
        }
      },
      stop(release = 0.08) {
        if (stopped) return;
        stopped = true;
        const t = ctx.currentTime;
        out.gain.cancelScheduledValues(t);
        out.gain.setValueAtTime(Math.max(MIN_GAIN, out.gain.value), t);
        out.gain.exponentialRampToValueAtTime(MIN_GAIN, t + Math.max(0.01, release));
        for (const s of sources) s.stop(t + release + 0.02);
        if (sources[0]) sources[0].onended = () => out.disconnect();
        else out.disconnect();
      },
    };
  }
}

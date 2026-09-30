/**
 * WebAudio implementation of AudioDriver. Graph:
 *
 *   voices -> [music bus | sfx bus] -> master -> compressor -> destination
 *
 * Every voice is built from short-lived nodes that stop themselves; nothing
 * here decides WHAT to play.
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

function audioContextCtor(): Ctor | null {
  const w = globalThis as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

const MIN_GAIN = 0.0001;

export class WebAudioDriver implements AudioDriver {
  private ctx: AudioContext | null = null;
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
    if (this.ctx) await this.ctx.resume();
  }

  async suspend(): Promise<void> {
    if (this.ctx && this.ctx.state === 'running') await this.ctx.suspend();
  }

  private build(): void {
    const C = audioContextCtor();
    if (!C) return;
    const ctx = new C({ latencyHint: 'interactive' });
    this.ctx = ctx;
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

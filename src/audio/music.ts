/**
 * Procedural music: a tiny step sequencer (16 steps / bar) with scale +
 * chord progression + seeded melody, square/triangle/noise voices, one
 * mood per ThemeId plus title and cutscene underscore.
 *
 * Composition is a PURE function of (mood, seed, bar, tension) so it is
 * deterministic and testable; `Sequencer` just renders those notes onto a
 * driver with a lookahead clock and a per-sequencer fade (crossfades).
 */

import type { ThemeId } from '../contracts';
import type { AudioDriver, ToneSpec, Wave } from './driver';
import { clamp01, hashSeed, hashString, mtof, rng } from './util';

export type MoodId = ThemeId | 'title' | 'cutscene';

export const MOOD_IDS: readonly MoodId[] = ['title', 'cutscene', 'hangar', 'asteroid', 'islands', 'caves', 'core', 'boss', 'collapse'];

export type VoiceId = 'lead' | 'arp' | 'bass' | 'pad' | 'kick' | 'snare' | 'hat';

export interface NoteEvent {
  /** 0..15 */
  step: number;
  /** Length in steps. */
  len: number;
  voice: VoiceId;
  /** MIDI note (0 for drums). */
  midi: number;
  /** 0..1 velocity. */
  vel: number;
}

interface VoiceDef {
  wave: Wave;
  gain: number;
}

export interface MoodDef {
  /** Human label for the audiolab. */
  label: string;
  bpm: number;
  /** BPM at tension 1 (accelerando). Defaults to bpm. */
  bpmTense?: number;
  /** MIDI note of the bass root. */
  root: number;
  scale: readonly number[];
  /** Chord root per bar, as scale degrees (0-based). */
  progression: readonly number[];
  lead?: VoiceDef & { octave: number; density: number; lens: readonly number[]; echo?: ToneSpec['echo']; vibrato?: ToneSpec['vibrato'] };
  arp?: VoiceDef & { octave: number; rate: number; density?: number; echo?: ToneSpec['echo'] };
  bass: VoiceDef & { pattern: readonly number[]; len: number; octaveJump?: boolean };
  pad?: VoiceDef & { octave: number };
  drums?: { kick: readonly number[]; snare: readonly number[]; hat: number; gain: number };
  /** 0..0.5 delay of odd 16ths as a fraction of a step. */
  swing?: number;
  /** Tension response (asteroid): extra density at tension 1. */
  tensionDensity?: number;
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];
const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const HARMONIC_MINOR = [0, 2, 3, 5, 7, 8, 11];
const PHRYGIAN_DOM = [0, 1, 4, 5, 7, 8, 10];

const E8 = [0, 2, 4, 6, 8, 10, 12, 14];
const E16 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const FOUR = [0, 4, 8, 12];

export const MOODS: Record<MoodId, MoodDef> = {
  title: {
    label: 'Title — hopeful',
    bpm: 92, root: 48, scale: MAJOR, progression: [0, 5, 3, 4],
    lead: { wave: 'square', gain: 0.07, octave: 24, density: 0.45, lens: [2, 2, 4, 1], echo: { delay: 0.33, feedback: 0.3, mix: 0.25 }, vibrato: { rate: 5, cents: 12 } },
    pad: { wave: 'triangle', gain: 0.05, octave: 12 },
    bass: { wave: 'triangle', gain: 0.16, pattern: [0, 6, 8, 14], len: 2 },
    drums: { kick: [0, 8], snare: [12], hat: 0.3, gain: 0.5 },
  },
  cutscene: {
    label: 'Cutscene underscore',
    bpm: 70, root: 45, scale: DORIAN, progression: [0, 3, 0, 6],
    lead: { wave: 'triangle', gain: 0.06, octave: 24, density: 0.15, lens: [4, 6, 8], echo: { delay: 0.43, feedback: 0.35, mix: 0.3 } },
    arp: { wave: 'triangle', gain: 0.04, octave: 24, rate: 2, density: 0.6 },
    pad: { wave: 'triangle', gain: 0.06, octave: 12 },
    bass: { wave: 'triangle', gain: 0.14, pattern: [0], len: 16 },
  },
  hangar: {
    label: 'Hangar — calm mechanical',
    bpm: 100, root: 50, scale: MIXOLYDIAN, progression: [0, 0, 6, 3],
    lead: { wave: 'square', gain: 0.05, octave: 24, density: 0.22, lens: [2, 4], echo: { delay: 0.3, feedback: 0.2, mix: 0.2 } },
    arp: { wave: 'square', gain: 0.035, octave: 12, rate: 1 },
    bass: { wave: 'triangle', gain: 0.16, pattern: E8, len: 1 },
    drums: { kick: FOUR, snare: [], hat: 0.5, gain: 0.35 },
  },
  asteroid: {
    label: 'Asteroid — tense accelerando',
    bpm: 104, bpmTense: 168, root: 40, scale: PHRYGIAN, progression: [0, 1, 0, 6],
    lead: { wave: 'square', gain: 0.06, octave: 24, density: 0.3, lens: [1, 2, 2, 3] },
    bass: { wave: 'square', gain: 0.1, pattern: E8, len: 1, octaveJump: true },
    pad: { wave: 'sawtooth', gain: 0.02, octave: 12 },
    drums: { kick: [0, 6, 8], snare: [4, 12], hat: 0.35, gain: 0.45 },
    tensionDensity: 0.45,
  },
  islands: {
    label: 'Islands — airy wonder',
    bpm: 84, root: 53, scale: LYDIAN, progression: [0, 1, 4, 3],
    lead: { wave: 'triangle', gain: 0.08, octave: 24, density: 0.3, lens: [2, 4, 6], echo: { delay: 0.36, feedback: 0.4, mix: 0.35 }, vibrato: { rate: 5, cents: 18 } },
    arp: { wave: 'triangle', gain: 0.04, octave: 24, rate: 2, echo: { delay: 0.36, feedback: 0.3, mix: 0.3 } },
    pad: { wave: 'triangle', gain: 0.06, octave: 12 },
    bass: { wave: 'triangle', gain: 0.13, pattern: [0, 10], len: 6 },
    drums: { kick: [0], snare: [], hat: 0.15, gain: 0.25 },
  },
  caves: {
    label: 'Caves — sparse echoing',
    bpm: 66, root: 45, scale: AEOLIAN, progression: [0, 0, 5, 4],
    lead: { wave: 'triangle', gain: 0.07, octave: 24, density: 0.16, lens: [3, 4, 6], echo: { delay: 0.52, feedback: 0.5, mix: 0.45 } },
    arp: { wave: 'sine', gain: 0.03, octave: 36, rate: 4, density: 0.25, echo: { delay: 0.7, feedback: 0.45, mix: 0.5 } },
    bass: { wave: 'triangle', gain: 0.15, pattern: [0], len: 14 },
    drums: { kick: [0], snare: [], hat: 0.05, gain: 0.2 },
  },
  core: {
    label: 'Core — luminous',
    bpm: 96, root: 43, scale: MAJOR, progression: [0, 4, 5, 3],
    lead: { wave: 'square', gain: 0.055, octave: 36, density: 0.35, lens: [2, 2, 4], echo: { delay: 0.31, feedback: 0.35, mix: 0.3 }, vibrato: { rate: 6, cents: 15 } },
    arp: { wave: 'sine', gain: 0.05, octave: 24, rate: 1, echo: { delay: 0.47, feedback: 0.3, mix: 0.3 } },
    pad: { wave: 'triangle', gain: 0.06, octave: 12 },
    bass: { wave: 'triangle', gain: 0.15, pattern: [0, 3, 8, 11], len: 2 },
    drums: { kick: [0, 8], snare: [4, 12], hat: 0.25, gain: 0.3 },
  },
  boss: {
    label: 'Boss — driving',
    bpm: 140, root: 36, scale: HARMONIC_MINOR, progression: [0, 5, 4, 4],
    lead: { wave: 'sawtooth', gain: 0.045, octave: 24, density: 0.5, lens: [1, 2, 2] },
    bass: { wave: 'square', gain: 0.1, pattern: E8, len: 1, octaveJump: true },
    pad: { wave: 'square', gain: 0.018, octave: 12 },
    drums: { kick: FOUR, snare: [4, 12], hat: 0.85, gain: 0.5 },
  },
  collapse: {
    label: 'Collapse — frantic',
    bpm: 176, root: 47, scale: PHRYGIAN_DOM, progression: [0, 1, 0, 5],
    lead: { wave: 'square', gain: 0.055, octave: 24, density: 0.65, lens: [1, 1, 2] },
    bass: { wave: 'square', gain: 0.09, pattern: E16, len: 1, octaveJump: true },
    drums: { kick: [0, 3, 8, 11], snare: [4, 12], hat: 0.9, gain: 0.5 },
  },
};

/** Scale degree (may be negative / > 7) -> semitones from root. */
function degree(scale: readonly number[], d: number): number {
  const n = scale.length;
  const oct = Math.floor(d / n);
  return scale[((d % n) + n) % n]! + 12 * oct;
}

/**
 * Compose one bar. Pure and deterministic: same (mood, seed, bar, tension)
 * -> same notes. The melody repeats in an A A' B B' 8-bar form so it reads
 * as a tune, not noise.
 */
export function composeBar(moodId: MoodId, seed: number, bar: number, tension = 0): NoteEvent[] {
  const m = MOODS[moodId];
  const ten = clamp01(tension) * (m.tensionDensity ?? 0);
  const moodSeed = hashString(moodId);
  const b8 = ((bar % 8) + 8) % 8;
  const chordDeg = m.progression[bar % m.progression.length]!;
  const chord = [chordDeg, chordDeg + 2, chordDeg + 4];
  const out: NoteEvent[] = [];

  // Bass
  m.bass.pattern.forEach((step, i) => {
    const jump = m.bass.octaveJump && i % 2 === 1 ? 12 : 0;
    out.push({ step, len: m.bass.len, voice: 'bass', midi: m.root + degree(m.scale, chordDeg) + jump, vel: i === 0 ? 1 : 0.8 });
  });

  // Pad: the chord, whole bar
  if (m.pad) {
    for (const d of chord) out.push({ step: 0, len: 16, voice: 'pad', midi: m.root + m.pad.octave + degree(m.scale, d), vel: 0.7 });
  }

  // Arp: chord tones cycling up
  if (m.arp) {
    const r = rng(hashSeed(seed, moodSeed, 0xa7, bar));
    let k = 0;
    for (let s = 0; s < 16; s += m.arp.rate) {
      if (m.arp.density !== undefined && r() > m.arp.density) continue;
      const d = chord[k % 3]!;
      out.push({ step: s, len: m.arp.rate, voice: 'arp', midi: m.root + m.arp.octave + degree(m.scale, d) + (k % 6 >= 3 ? 12 : 0), vel: s % 4 === 0 ? 1 : 0.7 });
      k++;
    }
  }

  // Lead: phrase-seeded (A A' B B'), chord tones on strong beats, stepwise elsewhere.
  if (m.lead) {
    const phrase = b8 < 4 ? b8 % 2 : 2 + (b8 % 2);
    const r = rng(hashSeed(seed, moodSeed, 0x1ead, phrase));
    const varR = rng(hashSeed(seed, moodSeed, 0x7a, bar)); // per-bar variation (endings, tension fills)
    const density = Math.min(0.95, m.lead.density + ten);
    let deg = chord[Math.floor(r() * 3)]!;
    let s = 0;
    while (s < 16) {
      const strong = s % 4 === 0;
      const p = density * (strong ? 1.4 : s % 2 === 0 ? 1 : 0.55);
      const len = m.lead.lens[Math.floor(r() * m.lead.lens.length)]!;
      if (r() < p) {
        if (strong) {
          // nearest chord tone
          const target = chord.reduce((best, c) => (Math.abs(c - deg) < Math.abs(best - deg) ? c : best), chord[0]!);
          deg = r() < 0.7 ? target : target + 7;
        } else {
          deg += r() < 0.5 ? 1 : -1;
          if (r() < 0.2) deg += r() < 0.5 ? 2 : -2;
        }
        deg = Math.max(-3, Math.min(11, deg));
        // bar 3 / 7 cadence variation
        const last = s + len >= 16 && (b8 === 3 || b8 === 7);
        const d = last ? chordDeg + (varR() < 0.5 ? 0 : 7) : deg;
        out.push({ step: s, len: Math.min(len, 16 - s), voice: 'lead', midi: m.root + m.lead.octave + degree(m.scale, d), vel: strong ? 1 : 0.75 });
      }
      s += len;
    }
  }

  // Drums
  if (m.drums) {
    const r = rng(hashSeed(seed, moodSeed, 0xd7, bar));
    for (const s of m.drums.kick) out.push({ step: s, len: 1, voice: 'kick', midi: 0, vel: 1 });
    if (ten > 0.25) for (const s of [10, 14]) out.push({ step: s, len: 1, voice: 'kick', midi: 0, vel: 0.7 });
    for (const s of m.drums.snare) out.push({ step: s, len: 1, voice: 'snare', midi: 0, vel: 1 });
    const hat = Math.min(1, m.drums.hat + ten);
    for (let s = 0; s < 16; s++) {
      const p = hat * (s % 2 === 0 ? 1.3 : 0.7);
      if (r() < p) out.push({ step: s, len: 1, voice: 'hat', midi: 0, vel: s % 4 === 2 ? 1 : 0.6 });
    }
  }

  return out.sort((a, b) => a.step - b.step);
}

export function moodBpm(moodId: MoodId, tension = 0): number {
  const m = MOODS[moodId];
  const t = clamp01(tension);
  return m.bpm + ((m.bpmTense ?? m.bpm) - m.bpm) * t;
}

/**
 * Renders a mood onto a driver. Call `schedule(until)` regularly (engine
 * timer, ~25 ms) with a lookahead horizon; notes are placed on the context
 * clock ahead of time so timer jitter does not affect rhythm.
 */
export class Sequencer {
  bar = 0;
  step = 0;
  private nextTime: number;
  private barNotes: NoteEvent[] = [];
  tension = 0;
  private fade = { from: 0, to: 1, t0: 0, dur: 0 };

  constructor(
    private readonly driver: AudioDriver,
    readonly mood: MoodId,
    readonly seed: number,
    startTime: number,
    fadeIn = 0,
  ) {
    this.nextTime = startTime;
    this.fade = { from: fadeIn > 0 ? 0 : 1, to: 1, t0: startTime, dur: fadeIn };
  }

  /** Fade level at context time t (0..1). */
  levelAt(t: number): number {
    const f = this.fade;
    if (f.dur <= 0 || t >= f.t0 + f.dur) return f.to;
    if (t <= f.t0) return f.from;
    return f.from + (f.to - f.from) * ((t - f.t0) / f.dur);
  }

  fadeTo(level: number, at: number, dur: number): void {
    this.fade = { from: this.levelAt(at), to: level, t0: at, dur };
  }

  /** True once fully faded out (safe to drop). */
  isSilentAfter(t: number): boolean {
    return this.fade.to === 0 && t >= this.fade.t0 + this.fade.dur;
  }

  /**
   * Render all steps starting before `until`. If `now` is given and the
   * clock ran ahead (throttled timer), skip the missed steps instead of
   * blurting them out at once.
   */
  schedule(until: number, now?: number): void {
    const m = MOODS[this.mood];
    if (now !== undefined && this.nextTime < now - 0.05) this.nextTime = now + 0.02;
    while (this.nextTime < until) {
      if (this.step === 0) this.barNotes = composeBar(this.mood, this.seed, this.bar, this.tension);
      const stepDur = 60 / moodBpm(this.mood, this.tension) / 4;
      const swing = this.step % 2 === 1 ? (m.swing ?? 0) * stepDur : 0;
      const t = this.nextTime + swing;
      const level = this.levelAt(t);
      if (level > 0.001) {
        for (const n of this.barNotes) if (n.step === this.step) this.render(n, t, stepDur, level);
      }
      this.nextTime += stepDur;
      this.step++;
      if (this.step >= 16) {
        this.step = 0;
        this.bar++;
      }
    }
  }

  private render(n: NoteEvent, t: number, stepDur: number, level: number): void {
    const d = this.driver;
    const m = MOODS[this.mood];
    const dur = n.len * stepDur;
    switch (n.voice) {
      case 'lead': {
        const v = m.lead!;
        d.tone({ bus: 'music', wave: v.wave, freq: mtof(n.midi), start: t, dur: dur * 0.85, gain: v.gain * n.vel * level, attack: 0.006, release: 0.05, echo: v.echo, vibrato: dur > 0.3 ? v.vibrato : undefined, filter: v.wave === 'sawtooth' ? { type: 'lowpass', freq: 2400 } : undefined });
        return;
      }
      case 'arp': {
        const v = m.arp!;
        d.tone({ bus: 'music', wave: v.wave, freq: mtof(n.midi), start: t, dur: dur * 0.6, gain: v.gain * n.vel * level, release: 0.04, echo: v.echo });
        return;
      }
      case 'bass':
        d.tone({ bus: 'music', wave: m.bass.wave, freq: mtof(n.midi), start: t, dur: dur * 0.9, gain: m.bass.gain * n.vel * level, release: 0.04, filter: m.bass.wave === 'square' ? { type: 'lowpass', freq: 900 } : undefined });
        return;
      case 'pad': {
        const v = m.pad!;
        d.tone({ bus: 'music', wave: v.wave, freq: mtof(n.midi), start: t, dur, gain: v.gain * n.vel * level, attack: Math.min(0.4, dur * 0.3), release: 0.3, filter: { type: 'lowpass', freq: 1500 } });
        return;
      }
      case 'kick':
        d.tone({ bus: 'music', wave: 'triangle', freq: 150, freqEnd: 42, start: t, dur: 0.1, gain: 0.45 * m.drums!.gain * n.vel * level, release: 0.04 });
        return;
      case 'snare':
        d.noise({ bus: 'music', start: t, dur: 0.07, gain: 0.25 * m.drums!.gain * n.vel * level, filter: { type: 'bandpass', freq: 1800, q: 0.8 } });
        return;
      case 'hat':
        d.noise({ bus: 'music', start: t, dur: 0.018, gain: 0.12 * m.drums!.gain * n.vel * level, filter: { type: 'highpass', freq: 7000 } });
        return;
    }
  }
}

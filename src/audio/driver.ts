/**
 * Thin synth driver: the ONLY layer that touches WebAudio. Everything above
 * it (SFX recipes, music sequencer, engine) speaks in these small, plain
 * "voice" descriptions, so tests can swap in a recording fake (Node/Vitest
 * has no AudioContext).
 */

export type BusId = 'music' | 'sfx';

export type Wave = 'square' | 'triangle' | 'sawtooth' | 'sine';

export type FilterType = 'lowpass' | 'highpass' | 'bandpass';

/** A one-shot oscillator note with a simple AD(S)R envelope. Times in seconds (context clock). */
export interface ToneSpec {
  bus: BusId;
  wave: Wave;
  /** Start frequency (Hz). */
  freq: number;
  /** Exponential glide target reached at the end of the note. */
  freqEnd?: number;
  start: number;
  dur: number;
  /** Peak gain 0..1 (before bus gain). */
  gain: number;
  attack?: number;
  /** Release tail after `dur` (default 0.02). */
  release?: number;
  /** FM: a sine modulator at freq*ratio with deviation freq*index. */
  fm?: { ratio: number; index: number };
  /** Vibrato: sine LFO rate (Hz) and depth (cents). */
  vibrato?: { rate: number; cents: number };
  filter?: { type: FilterType; freq: number; q?: number; freqEnd?: number };
  /** -1..1 stereo pan. */
  pan?: number;
  /** Feedback echo send (music "caves" / chimes). */
  echo?: { delay: number; feedback: number; mix: number };
}

/** A one-shot filtered white-noise burst. */
export interface NoiseSpec {
  bus: BusId;
  start: number;
  dur: number;
  gain: number;
  attack?: number;
  release?: number;
  filter?: { type: FilterType; freq: number; q?: number; freqEnd?: number };
  pan?: number;
}

/** A sustained voice (thruster, radiation whine) that is updated live and stopped later. */
export interface LoopSpec {
  bus: BusId;
  /** Oscillator layer (omit for noise-only). */
  wave?: Wave;
  freq?: number;
  /** Noise layer gain relative to `gain` (0 = none). */
  noise?: number;
  gain: number;
  /** Pitch wobble LFO. */
  wobble?: { rate: number; cents: number };
  filter?: { type: FilterType; freq: number; q?: number };
  pan?: number;
  /** Fade-in time (s). */
  attack?: number;
}

export interface LoopHandle {
  /** Glide the loop to new parameters over `ramp` seconds. */
  set(p: { freq?: number; gain?: number; filterFreq?: number }, ramp?: number): void;
  /** Fade out over `release` seconds and free the nodes. */
  stop(release?: number): void;
}

export interface AudioDriver {
  /** Current context time (s). */
  now(): number;
  /** 'running' once unlocked by a gesture; tones scheduled while not running are dropped by the engine. */
  readonly state: 'uninit' | 'running' | 'suspended';
  /** Create/resume the context (must be called from a user gesture the first time). */
  resume(): Promise<void>;
  suspend(): Promise<void>;
  /** Linear ramp of a bus or the master gain. */
  setGain(target: BusId | 'master', value: number, ramp?: number): void;
  tone(t: ToneSpec): void;
  noise(n: NoiseSpec): void;
  loop(l: LoopSpec): LoopHandle;
}

/**
 * Thruster loops: one sustained voice per engine, timbre per vessel mode,
 * keyed to `enginesChanged`. Each loop carries a pitch-wobble LFO and a short
 * ignition "pop"; on cut-off its gain fades out (the voice stays built until
 * pause / crash / level end, see Thrusters).
 */

import type { GameEventOf, VesselMode } from '../contracts';
import type { AudioDriver, LoopHandle, LoopSpec } from './driver';

export type EngineId = 'main' | 'left' | 'right';
export const ENGINE_IDS: readonly EngineId[] = ['main', 'left', 'right'];

export type EngineFlags = Omit<GameEventOf<'enginesChanged'>, 'type'>;

const PAN: Record<EngineId, number> = { main: 0, left: -0.45, right: 0.45 };

/** Timbre table: per mode, per engine. */
export function thrusterSpec(mode: VesselMode, engine: EngineId): LoopSpec {
  const pan = PAN[engine];
  switch (mode) {
    case 'csm':
      // big single bell: deep saw rumble + heavy low noise
      return { bus: 'sfx', wave: 'sawtooth', freq: 46, noise: 1.6, gain: 0.22, wobble: { rate: 5.5, cents: 28 }, filter: { type: 'lowpass', freq: 650, q: 0.9 }, pan, attack: 0.06 };
    case 'lander':
      // two small descent engines: brighter square buzz, detuned L/R
      return { bus: 'sfx', wave: 'square', freq: engine === 'right' ? 97 : 92, noise: 1.2, gain: 0.13, wobble: { rate: engine === 'right' ? 9.3 : 8.1, cents: 35 }, filter: { type: 'lowpass', freq: 1400, q: 1.4 }, pan, attack: 0.03 };
    case 'harpoon':
    case 'harpoonThrust':
      // pod RCS-style hiss with a thin triangle whine
      return { bus: 'sfx', wave: 'triangle', freq: engine === 'main' ? 150 : 185, noise: 1.8, gain: 0.11, wobble: { rate: 12, cents: 45 }, filter: { type: 'bandpass', freq: 2200, q: 0.8 }, pan, attack: 0.02 };
  }
}

/**
 * Minimum time (s) an engine must have been dark before relighting plays the
 * ignition pop. Pulse trains (DIRECT steering, tapped burns) flicker an engine
 * every tick or two: those are one continuous burn to the ear, and a pop per
 * flicker would also build four WebAudio nodes per tick.
 */
export const IGNITION_POP_MIN_OFF_SEC = 0.15;
/** Gain ramp (s) when an engine cuts out (the old loop stop release). */
const CUT_RAMP = 0.09;

interface Voice {
  loop: LoopHandle;
  spec: LoopSpec;
  /** The loop's gain is up (audible). */
  lit: boolean;
}

/**
 * Engine voices are PERSISTENT while flying: the first ignition of an engine
 * builds its loop once, and later cut-offs / relights only ramp that loop's
 * gain (no node creation per press - on iOS every createOscillator /
 * createBiquadFilter / connect is main-thread work plus garbage, and engine
 * pulses can toggle 30+ times a second). Voices are torn down only by
 * stopAll() (pause, crash, level end), silence() (tab hidden) and mode
 * changes (new timbre).
 *
 * The ignition pop follows the ENGINE, not the voice: it plays only when an
 * engine lights after IGNITION_POP_MIN_OFF_SEC dark. Rebuilding a voice for
 * an engine that never went dark (resume after silence(), re-voicing on a
 * mode change) does not pop; stopAll() is a real cut-off and records it.
 */
export class Thrusters {
  private mode: VesselMode = 'lander';
  private readonly voices = new Map<EngineId, Voice>();
  private flags: EngineFlags = { main: false, left: false, right: false };
  /** Per engine: lit as of the last update applied while the context ran (survives voice rebuilds). */
  private readonly on: Record<EngineId, boolean> = { main: false, left: false, right: false };
  /** Per engine: context time it went dark (-Infinity = never lit). Survives silence() / mode changes. */
  private readonly offAt: Record<EngineId, number> = { main: -Infinity, left: -Infinity, right: -Infinity };

  constructor(private readonly driver: AudioDriver) {}

  setMode(mode: VesselMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    // Re-voice any running engines with the new timbre: a still-firing engine keeps
    // its lit state (no pop), only the voices are rebuilt.
    this.dropVoices(0.05);
    this.update(this.flags);
  }

  get currentMode(): VesselMode {
    return this.mode;
  }

  /** Engines currently sounding. */
  get active(): EngineId[] {
    const out: EngineId[] = [];
    for (const [id, v] of this.voices) if (v.lit) out.push(id);
    return out;
  }

  /** Engine voices built (lit or gated silent) - tests / diagnostics. */
  get voiceCount(): number {
    return this.voices.size;
  }

  update(flags: EngineFlags): void {
    // S9 lander top thrusters voice through the same-side loop.
    const main = flags.main;
    const left = flags.left || flags.topLeft === true;
    const right = flags.right || flags.topRight === true;
    const f = this.flags;
    f.main = main;
    f.left = left;
    f.right = right;
    if (this.driver.state !== 'running') return;
    const now = this.driver.now();
    for (const id of ENGINE_IDS) {
      const on = f[id];
      const was = this.on[id];
      // a real ignition: the engine was dark long enough to hear it light again
      const ignite = on && !was && now - this.offAt[id] >= IGNITION_POP_MIN_OFF_SEC;
      if (!on && was) this.offAt[id] = now;
      this.on[id] = on;
      const v = this.voices.get(id);
      if (on && !v) {
        const spec = thrusterSpec(this.mode, id);
        this.voices.set(id, { loop: this.driver.loop(spec), spec, lit: true });
        if (ignite) this.pop(spec);
      } else if (on && v && !v.lit) {
        v.lit = true;
        v.loop.set({ gain: v.spec.gain }, v.spec.attack ?? 0.05);
        if (ignite) this.pop(v.spec);
      } else if (!on && v && v.lit) {
        v.lit = false;
        v.loop.set({ gain: 0 }, CUT_RAMP);
      }
    }
  }

  private pop(spec: LoopSpec): void {
    const t = this.driver.now();
    this.driver.noise({ bus: 'sfx', start: t, dur: 0.03, gain: spec.gain * 1.5, filter: { type: 'lowpass', freq: 2500 }, pan: spec.pan });
  }

  /** Stop the loops but REMEMBER which engines are lit (tab hidden / context suspended): relight() does not pop them. */
  silence(): void {
    this.dropVoices(0.03);
  }

  private dropVoices(release: number): void {
    for (const v of this.voices.values()) v.loop.stop(release);
    this.voices.clear();
  }

  /** Rebuild loops for the remembered flags (after resume). */
  relight(): void {
    this.update(this.flags);
  }

  /** Silence everything (pause, crash, level end). Engines re-light on the next enginesChanged. */
  stopAll(): void {
    this.dropVoices(0.05);
    const now = this.driver.now();
    for (const id of ENGINE_IDS) {
      if (this.on[id]) this.offAt[id] = now; // a real cut-off
      this.on[id] = false;
    }
    const f = this.flags;
    f.main = false;
    f.left = false;
    f.right = false;
  }
}

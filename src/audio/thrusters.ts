/**
 * Thruster loops: one sustained voice per lit engine, timbre per vessel
 * mode, keyed to `enginesChanged`. Each loop carries a pitch-wobble LFO and
 * a short ignition "pop"; on cut-off it fades out with a puff.
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

export class Thrusters {
  private mode: VesselMode = 'lander';
  private readonly loops = new Map<EngineId, LoopHandle>();
  private flags: EngineFlags = { main: false, left: false, right: false };

  constructor(private readonly driver: AudioDriver) {}

  setMode(mode: VesselMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    // Re-voice any running engines with the new timbre.
    const lit = this.flags;
    this.stopAll();
    this.update(lit);
  }

  get currentMode(): VesselMode {
    return this.mode;
  }

  get active(): EngineId[] {
    return [...this.loops.keys()];
  }

  update(flags: EngineFlags): void {
    this.flags = { main: flags.main, left: flags.left, right: flags.right };
    if (this.driver.state !== 'running') return;
    for (const id of ENGINE_IDS) {
      const on = flags[id];
      const loop = this.loops.get(id);
      if (on && !loop) {
        const spec = thrusterSpec(this.mode, id);
        this.loops.set(id, this.driver.loop(spec));
        const t = this.driver.now();
        // ignition pop
        this.driver.noise({ bus: 'sfx', start: t, dur: 0.03, gain: spec.gain * 1.5, filter: { type: 'lowpass', freq: 2500 }, pan: spec.pan });
      } else if (!on && loop) {
        loop.stop(0.09);
        this.loops.delete(id);
      }
    }
  }

  /** Silence everything (pause, crash, level end). Engines re-light on the next enginesChanged. */
  stopAll(): void {
    for (const l of this.loops.values()) l.stop(0.05);
    this.loops.clear();
    this.flags = { main: false, left: false, right: false };
  }
}

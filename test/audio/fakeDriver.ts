import type { AudioDriver, BusId, LoopHandle, LoopSpec, NoiseSpec, ToneSpec } from '../../src/audio/driver';

export type Call =
  | { kind: 'tone'; spec: ToneSpec }
  | { kind: 'noise'; spec: NoiseSpec }
  | { kind: 'loop'; spec: LoopSpec; id: number }
  | { kind: 'loopStop'; id: number }
  | { kind: 'gain'; target: BusId | 'master'; value: number };

export type VoiceCall = Extract<Call, { kind: 'tone' | 'noise' }>;

/** Recording AudioDriver for Node tests. Advance `time` by hand. */
export class FakeDriver implements AudioDriver {
  time = 0;
  state: AudioDriver['state'] = 'uninit';
  calls: Call[] = [];
  gains: Record<string, number> = {};
  liveLoops = new Set<number>();
  private nextLoop = 1;
  /** Make resume() reject (autoplay denied). */
  denyResume = false;

  now(): number {
    return this.time;
  }
  async resume(): Promise<void> {
    if (this.denyResume) throw new Error('NotAllowedError');
    this.state = 'running';
  }
  async suspend(): Promise<void> {
    if (this.state === 'running') this.state = 'suspended';
  }
  setGain(target: BusId | 'master', value: number): void {
    this.gains[target] = value;
    this.calls.push({ kind: 'gain', target, value });
  }
  tone(spec: ToneSpec): void {
    this.calls.push({ kind: 'tone', spec });
  }
  noise(spec: NoiseSpec): void {
    this.calls.push({ kind: 'noise', spec });
  }
  loop(spec: LoopSpec): LoopHandle {
    const id = this.nextLoop++;
    this.liveLoops.add(id);
    this.calls.push({ kind: 'loop', spec, id });
    return {
      set: () => {},
      stop: () => {
        this.liveLoops.delete(id);
        this.calls.push({ kind: 'loopStop', id });
      },
    };
  }

  voices(): VoiceCall[] {
    return this.calls.filter((c): c is VoiceCall => c.kind === 'tone' || c.kind === 'noise');
  }
  clear(): void {
    this.calls = [];
  }
}

export class MemStorage {
  map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

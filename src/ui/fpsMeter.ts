/**
 * FPS / frame-time meter (pure; the pause-menu FPS COUNTER toggle,
 * Settings.showFps). The App feeds one sample per animation frame: the rAF
 * timestamp and the CPU ms the frame's own work took (fixed steps + view
 * render + Pixi submit). Averages are published every `windowMs` so the
 * readout is stable and the text is re-rasterised at most twice a second.
 */

export interface FpsReading {
  /** Frames per second over the last window. */
  fps: number;
  /** Mean rAF-to-rAF interval (ms). */
  frameMs: number;
  /** Mean CPU ms of the game's own per-frame work (steps + render). */
  workMs: number;
  /** Worst rAF-to-rAF interval in the window (ms) - spikes / hitches. */
  worstMs: number;
}

export class FpsMeter {
  private lastMs: number | null = null;
  private windowStart: number | null = null;
  private frames = 0;
  private work = 0;
  private worst = 0;
  private _reading: FpsReading | null = null;

  constructor(private readonly windowMs = 500) {}

  /** Latest published reading (null until the first full window). */
  get reading(): FpsReading | null {
    return this._reading;
  }

  /** One animation frame at `nowMs` whose game work took `workMs`. Returns true when a new reading was published. */
  frame(nowMs: number, workMs: number): boolean {
    if (this.lastMs !== null) {
      const dt = nowMs - this.lastMs;
      // a long gap (tab hidden, paused rAF) is not a frame: restart the window
      if (dt > 1000) {
        this.restartWindow(nowMs);
        return false;
      }
      this.worst = Math.max(this.worst, dt);
      this.frames++;
      this.work += Math.max(0, workMs);
    }
    this.lastMs = nowMs;
    this.windowStart ??= nowMs;
    const span = nowMs - this.windowStart;
    if (span < this.windowMs || this.frames === 0) return false;
    this._reading = { fps: (this.frames * 1000) / span, frameMs: span / this.frames, workMs: this.work / this.frames, worstMs: this.worst };
    this.windowStart = nowMs;
    this.frames = 0;
    this.work = 0;
    this.worst = 0;
    return true;
  }

  /** Forget everything (counter switched off): the next reading comes from fresh frames only. */
  reset(): void {
    this.lastMs = null;
    this.windowStart = null;
    this.frames = 0;
    this.work = 0;
    this.worst = 0;
    this._reading = null;
  }

  private restartWindow(nowMs: number): void {
    this.lastMs = nowMs;
    this.windowStart = nowMs;
    this.frames = 0;
    this.work = 0;
    this.worst = 0;
  }
}

/** Compact readout, e.g. "60 FPS 16.7MS CPU 3.2". */
export function fpsText(r: FpsReading | null): string {
  if (!r) return '-- FPS';
  return `${Math.round(r.fps)} FPS ${r.frameMs.toFixed(1)}MS CPU ${r.workMs.toFixed(1)}`;
}

/**
 * FPS / frame-time meter (pure; the pause-menu FPS COUNTER toggle,
 * Settings.showFps). The App feeds one sample per animation frame: the rAF
 * timestamp and the CPU ms the frame's own work took (fixed steps + view
 * render + Pixi submit). Averages are published every `windowMs` so the
 * readout is stable and the text is re-rasterised at most twice a second.
 *
 * Hitch diagnostics (periodic stutter on phones): the worst frame of the last
 * ~2 s (a ring of the last HISTORY_WINDOWS window maxima) and a running count
 * of hitches (rAF intervals over HITCH_MS) since the counter was switched on.
 * No per-frame allocation: the reading object is reused.
 */

/** A rAF interval above this (ms) counts as a hitch (3 missed 60 Hz frames). */
export const HITCH_MS = 50;
/** Windows kept for the "worst of the last ~2 s" readout (4 × 500 ms). */
const HISTORY_WINDOWS = 4;

export interface FpsReading {
  /** Frames per second over the last window. */
  fps: number;
  /** Mean rAF-to-rAF interval (ms). */
  frameMs: number;
  /** Mean CPU ms of the game's own per-frame work (steps + render). */
  workMs: number;
  /** Worst rAF-to-rAF interval in the window (ms) - spikes / hitches. */
  worstMs: number;
  /** Worst rAF-to-rAF interval over the last HISTORY_WINDOWS windows (~2 s). */
  worstRecentMs: number;
  /** Frames longer than HITCH_MS since the meter started / was reset. */
  hitches: number;
}

export class FpsMeter {
  private lastMs: number | null = null;
  private windowStart: number | null = null;
  private frames = 0;
  private work = 0;
  private worst = 0;
  private hitches = 0;
  private readonly history = new Float64Array(HISTORY_WINDOWS);
  private historyAt = 0;
  private readonly out: FpsReading = { fps: 0, frameMs: 0, workMs: 0, worstMs: 0, worstRecentMs: 0, hitches: 0 };
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
      if (dt > HITCH_MS) this.hitches++;
      this.frames++;
      this.work += Math.max(0, workMs);
    }
    this.lastMs = nowMs;
    this.windowStart ??= nowMs;
    const span = nowMs - this.windowStart;
    if (span < this.windowMs || this.frames === 0) return false;
    this.history[this.historyAt] = this.worst;
    this.historyAt = (this.historyAt + 1) % HISTORY_WINDOWS;
    let recent = 0;
    for (let i = 0; i < HISTORY_WINDOWS; i++) recent = Math.max(recent, this.history[i]!);
    const r = this.out;
    r.fps = (this.frames * 1000) / span;
    r.frameMs = span / this.frames;
    r.workMs = this.work / this.frames;
    r.worstMs = this.worst;
    r.worstRecentMs = recent;
    r.hitches = this.hitches;
    this._reading = r;
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
    this.hitches = 0;
    this.history.fill(0);
    this.historyAt = 0;
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

/** Compact readout, e.g. "60 FPS 16.7MS CPU 3.2 MAX 34 HITCH 2" (MAX = worst frame ms of the last ~2 s). */
export function fpsText(r: FpsReading | null): string {
  if (!r) return '-- FPS';
  return `${Math.round(r.fps)} FPS ${r.frameMs.toFixed(1)}MS CPU ${r.workMs.toFixed(1)} MAX ${Math.round(r.worstRecentMs)} HITCH ${r.hitches}`;
}

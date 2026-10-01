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
 *
 * Hitch cause (stutter round 2): the App also hands in the frame's time per
 * phase (FRAME_PHASES, a reused Float64Array). A rAF interval spans the
 * PREVIOUS frame's work, so a hitch is blamed on the previous frame's
 * slowest phase - or on EXT (GC, audio timer, browser / compositor, GPU
 * wait) when no phase explains at least half of the overrun. PAINT and
 * UPLOAD are both terrain streaming: when neither alone explains half but
 * the pair does, the larger of the two is blamed with the pair's ms. The readout
 * shows the last hitch's cause and its ms ("LAST PAINT 23").
 */

/** A rAF interval above this (ms) counts as a hitch (3 missed 60 Hz frames). */
export const HITCH_MS = 50;
/**
 * Per-frame phases the App times (indices into the phases array):
 * STEP fixed steps (minus audio), AUDIO game-event audio handlers, PAINT
 * terrain chunk band painting, UPLOAD terrain chunk texture uploads (Pixi
 * uploads synchronously inside the terrain update), DRAW view + UI render
 * (minus paint + upload), SUBMIT Pixi render / GPU submit.
 */
export const FRAME_PHASES = ['STEP', 'AUDIO', 'PAINT', 'UPLOAD', 'DRAW', 'SUBMIT'] as const;
export const PHASE_STEP = 0;
export const PHASE_AUDIO = 1;
export const PHASE_PAINT = 2;
export const PHASE_UPLOAD = 3;
export const PHASE_DRAW = 4;
export const PHASE_SUBMIT = 5;
/** Hitch cause index: nothing the game timed explains it (GC, timers, compositor, GPU wait). */
export const CAUSE_EXT = FRAME_PHASES.length;
/** Labels by cause index (FRAME_PHASES + EXT). */
export const CAUSE_LABELS: readonly string[] = [...FRAME_PHASES, 'EXT'];
/** Nominal frame (ms) subtracted from a hitch interval to get its overrun. */
const NOMINAL_FRAME_MS = 1000 / 60;

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
  /** Cause index of the last hitch (FRAME_PHASES index or CAUSE_EXT), -1 = none yet. */
  lastCause: number;
  /** The last hitch cause's ms (the phase time, or the hitch interval for EXT). */
  lastCauseMs: number;
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
  private readonly out: FpsReading = { fps: 0, frameMs: 0, workMs: 0, worstMs: 0, worstRecentMs: 0, hitches: 0, lastCause: -1, lastCauseMs: 0 };
  /** The previous frame's phase times (a hitch interval spans that frame's work). */
  private readonly prevPhases = new Float64Array(FRAME_PHASES.length);
  private lastCause = -1;
  private lastCauseMs = 0;
  private _reading: FpsReading | null = null;

  constructor(private readonly windowMs = 500) {}

  /** Latest published reading (null until the first full window). */
  get reading(): FpsReading | null {
    return this._reading;
  }

  /**
   * One animation frame at `nowMs` whose game work took `workMs` (split per
   * FRAME_PHASES in `phases`, optional). Returns true when a new reading was
   * published.
   */
  frame(nowMs: number, workMs: number, phases?: ArrayLike<number>): boolean {
    if (this.lastMs !== null) {
      const dt = nowMs - this.lastMs;
      // a long gap (tab hidden, paused rAF) is not a frame: restart the window
      if (dt > 1000) {
        this.restartWindow(nowMs);
        return false;
      }
      this.worst = Math.max(this.worst, dt);
      if (dt > HITCH_MS) {
        this.hitches++;
        this.blame(dt);
      }
      this.frames++;
      this.work += Math.max(0, workMs);
    }
    if (phases) for (let i = 0; i < this.prevPhases.length; i++) this.prevPhases[i] = phases[i] ?? 0;
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
    r.lastCause = this.lastCause;
    r.lastCauseMs = this.lastCauseMs;
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
    this.lastCause = -1;
    this.lastCauseMs = 0;
    this.prevPhases.fill(0);
    this.history.fill(0);
    this.historyAt = 0;
    this._reading = null;
  }

  /** Blame a hitch interval `dt` on the previous frame's slowest phase, or EXT. */
  private blame(dt: number): void {
    let best = -1;
    let bestMs = 0;
    for (let i = 0; i < this.prevPhases.length; i++) {
      if (this.prevPhases[i]! > bestMs) {
        bestMs = this.prevPhases[i]!;
        best = i;
      }
    }
    const overrun = dt - NOMINAL_FRAME_MS;
    const paint = this.prevPhases[PHASE_PAINT]!;
    const upload = this.prevPhases[PHASE_UPLOAD]!;
    if (bestMs < overrun / 2 && paint + upload >= overrun / 2) {
      // terrain streaming split across its two phases: blame the pair (labelled by its larger half)
      best = paint >= upload ? PHASE_PAINT : PHASE_UPLOAD;
      bestMs = paint + upload;
    }
    if (best < 0 || bestMs < overrun / 2) {
      this.lastCause = CAUSE_EXT;
      this.lastCauseMs = dt;
    } else {
      this.lastCause = best;
      this.lastCauseMs = bestMs;
    }
  }

  private restartWindow(nowMs: number): void {
    this.lastMs = nowMs;
    this.windowStart = nowMs;
    this.frames = 0;
    this.work = 0;
    this.worst = 0;
  }
}

/** Terrain streaming counters for the FPS counter's second line (TerrainView diagnostics). */
export interface TerrainDiag {
  /** Camera jumps (synchronous on-screen repaints) since the level started. */
  jumps: number;
  /** Chunks that were on screen before they were finished (late fill) since the level started. */
  late: number;
  /** Synchronous uploads (level load + jumps) since the level started. */
  syncUploads: number;
  /** This frame's terrain update ms (paint + upload). */
  ms: number;
  /** This frame's upload ms (part of `ms`). */
  uploadMs: number;
}

/**
 * Worst terrain update ms over the last ~2 s (ring of window maxima like
 * FpsMeter), plus the latest counters: the readout a player report needs
 * to tell which streaming path fired.
 */
export class TerrainDiagMeter {
  private worst = 0;
  private worstUpload = 0;
  private readonly hist = new Float64Array(HISTORY_WINDOWS * 2);
  private at = 0;
  private last: TerrainDiag = { jumps: 0, late: 0, syncUploads: 0, ms: 0, uploadMs: 0 };
  private out = { jumps: 0, late: 0, sync: 0, worstMs: 0, worstUploadMs: 0 };

  note(d: TerrainDiag): void {
    this.worst = Math.max(this.worst, d.ms);
    this.worstUpload = Math.max(this.worstUpload, d.uploadMs);
    this.last = d;
  }

  /** Close a window (call when the FPS meter publishes); returns the reading. */
  publish(): { jumps: number; late: number; sync: number; worstMs: number; worstUploadMs: number } {
    this.hist[this.at * 2] = this.worst;
    this.hist[this.at * 2 + 1] = this.worstUpload;
    this.at = (this.at + 1) % HISTORY_WINDOWS;
    let w = 0;
    let wu = 0;
    for (let i = 0; i < HISTORY_WINDOWS; i++) {
      w = Math.max(w, this.hist[i * 2]!);
      wu = Math.max(wu, this.hist[i * 2 + 1]!);
    }
    this.worst = 0;
    this.worstUpload = 0;
    const o = this.out;
    o.jumps = this.last.jumps;
    o.late = this.last.late;
    o.sync = this.last.syncUploads;
    o.worstMs = w;
    o.worstUploadMs = wu;
    return o;
  }

  reset(): void {
    this.worst = 0;
    this.worstUpload = 0;
    this.hist.fill(0);
    this.at = 0;
  }
}

/** Terrain line, e.g. "TERRAIN MAX 7 UP 2 JUMP 0 LATE 3 SYNC 12" (MAX / UP: worst terrain / upload ms of the last ~2 s). */
export function terrainText(r: { jumps: number; late: number; sync: number; worstMs: number; worstUploadMs: number }): string {
  return `TERRAIN MAX ${Math.round(r.worstMs)} UP ${Math.round(r.worstUploadMs)} JUMP ${r.jumps} LATE ${r.late} SYNC ${r.sync}`;
}

/**
 * Compact readout, e.g. "60 FPS 16.7MS CPU 3.2 MAX 34 HITCH 2 LAST PAINT 23"
 * (MAX = worst frame ms of the last ~2 s; LAST = the last hitch's cause + ms).
 */
export function fpsText(r: FpsReading | null): string {
  if (!r) return '-- FPS';
  const base = `${Math.round(r.fps)} FPS ${r.frameMs.toFixed(1)}MS CPU ${r.workMs.toFixed(1)} MAX ${Math.round(r.worstRecentMs)} HITCH ${r.hitches}`;
  return r.lastCause >= 0 ? `${base} LAST ${CAUSE_LABELS[r.lastCause]} ${Math.round(r.lastCauseMs)}` : base;
}

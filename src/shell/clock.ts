/**
 * Fixed-step clock & frame loop.
 *
 * - Simulation always advances in exact FIXED_DT (1/60 s) steps; physics does
 *   SUB_STEPS sub-steps per step (see src/physics/engine.ts).
 * - Real frame time feeds an accumulator; at most MAX_FRAME_SECONDS (250 ms)
 *   of real time is accepted per frame — the excess is DROPPED, so a slow
 *   device runs in slow motion instead of spiralling.
 * - Render gets alpha = leftover accumulator / FIXED_DT to interpolate
 *   between the previous and the current simulation state.
 * - Simulation time = steps × FIXED_DT, never wall clock.
 * - FrameLoop pauses while the document is hidden or the window is blurred
 *   (and on manual pause), and reports every change via onPauseChange so the
 *   host clears input.
 *
 * FixedStepClock is pure and unit-tested; FrameLoop wires it to rAF + DOM.
 */

import { FIXED_DT, MAX_FRAME_SECONDS } from '../contracts';

const EPS = 1e-9;

export class FixedStepClock {
  private accumulator = 0;
  private _steps = 0;
  private _paused = false;

  get steps(): number {
    return this._steps;
  }

  /** Simulation seconds elapsed (steps × FIXED_DT). */
  get simTime(): number {
    return this._steps * FIXED_DT;
  }

  get paused(): boolean {
    return this._paused;
  }

  /** Interpolation factor in [0, 1] between the previous and current state. */
  get alpha(): number {
    return Math.min(1, Math.max(0, this.accumulator / FIXED_DT));
  }

  /**
   * Feed real elapsed seconds; returns how many fixed steps to run now.
   * Negative / non-finite input counts as 0; input above MAX_FRAME_SECONDS is
   * clamped. Paused clocks return 0 and accumulate nothing.
   */
  advance(realDtSeconds: number): number {
    if (this._paused) return 0;
    const dt = Math.min(MAX_FRAME_SECONDS, Math.max(0, Number.isFinite(realDtSeconds) ? realDtSeconds : 0));
    this.accumulator += dt;
    const n = Math.floor((this.accumulator + EPS) / FIXED_DT);
    this.accumulator = Math.max(0, this.accumulator - n * FIXED_DT);
    this._steps += n;
    return n;
  }

  pause(): void {
    this._paused = true;
  }

  /** Resume; leftover accumulated time is discarded. */
  resume(): void {
    this._paused = false;
    this.accumulator = 0;
  }

  reset(): void {
    this.accumulator = 0;
    this._steps = 0;
  }
}

export interface FrameLoopCallbacks {
  /** Run ONE fixed step. `index` = 0 for the first step of this frame. */
  step(index: number): void;
  /** Render with interpolation factor alpha. Called every animation frame (also while paused). */
  render(alpha: number): void;
  /** Loop paused (tab hidden / window blurred / manual) or resumed. Clear input on pause. */
  onPauseChange?(paused: boolean, cause: PauseCause): void;
}

export type PauseCause = 'hidden' | 'blurred' | 'manual';

export interface RafLike {
  request(cb: (nowMs: number) => void): number;
  cancel(id: number): void;
}

const browserRaf: RafLike = {
  request: (cb) => requestAnimationFrame(cb),
  cancel: (id) => cancelAnimationFrame(id),
};

/** Browser frame loop: rAF -> FixedStepClock -> step()/render(). */
export class FrameLoop {
  readonly clock = new FixedStepClock();
  private rafId = 0;
  private lastMs: number | null = null;
  private running = false;
  private unbind: (() => void) | null = null;
  private causes: Record<PauseCause, boolean> = { hidden: false, blurred: false, manual: false };

  constructor(
    private readonly cb: FrameLoopCallbacks,
    private readonly raf: RafLike = browserRaf,
  ) {}

  get paused(): boolean {
    return this.clock.paused;
  }

  get pauseCauses(): Readonly<Record<PauseCause, boolean>> {
    return { ...this.causes };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastMs = null;
    this.rafId = this.raf.request(this.tick);
  }

  stop(): void {
    if (this.running) this.raf.cancel(this.rafId);
    this.running = false;
    this.unbind?.();
    this.unbind = null;
  }

  /** Manual pause (pause screen); composes with hidden/blurred. */
  setPaused(paused: boolean): void {
    this.setCause('manual', paused);
  }

  /** Pause while the document is hidden and while the window is blurred. */
  bindVisibility(doc: Document = document, win: Window = window): void {
    this.unbind?.();
    const onVis = () => this.setCause('hidden', doc.visibilityState === 'hidden');
    const onBlur = () => this.setCause('blurred', true);
    const onFocus = () => this.setCause('blurred', false);
    const onPageHide = () => this.setCause('hidden', true);
    const onPageShow = () => this.setCause('hidden', doc.visibilityState === 'hidden');
    doc.addEventListener('visibilitychange', onVis);
    win.addEventListener('blur', onBlur);
    win.addEventListener('focus', onFocus);
    win.addEventListener('pagehide', onPageHide);
    win.addEventListener('pageshow', onPageShow);
    onVis();
    this.unbind = () => {
      doc.removeEventListener('visibilitychange', onVis);
      win.removeEventListener('blur', onBlur);
      win.removeEventListener('focus', onFocus);
      win.removeEventListener('pagehide', onPageHide);
      win.removeEventListener('pageshow', onPageShow);
    };
  }

  private setCause(cause: PauseCause, on: boolean): void {
    this.causes[cause] = on;
    const paused = this.causes.hidden || this.causes.blurred || this.causes.manual;
    if (paused === this.clock.paused) return;
    if (paused) this.clock.pause();
    else {
      this.clock.resume();
      this.lastMs = null; // do not count the time spent paused
    }
    this.cb.onPauseChange?.(paused, cause);
  }

  /** One animation frame (public for tests). */
  readonly tick = (nowMs: number): void => {
    if (!this.running) return;
    const dt = this.lastMs === null ? 0 : (nowMs - this.lastMs) / 1000;
    this.lastMs = nowMs;
    const n = this.clock.advance(dt);
    // Re-check pause between steps: a step may pause the loop (pause key,
    // mid-level cutscene) and the rest of a catch-up batch must not run.
    for (let i = 0; i < n && !this.clock.paused; i++) this.cb.step(i);
    this.cb.render(this.clock.alpha);
    this.rafId = this.raf.request(this.tick);
  };
}

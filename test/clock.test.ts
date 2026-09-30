import { describe, expect, it } from 'vitest';
import { FIXED_DT, MAX_FRAME_SECONDS } from '../src/contracts';
import { FixedStepClock, FrameLoop, MAX_CATCHUP_STEPS, type RafLike } from '../src/shell/clock';

describe('FixedStepClock', () => {
  it('runs one step per 1/60 s', () => {
    const c = new FixedStepClock();
    expect(c.advance(FIXED_DT)).toBe(1);
    expect(c.advance(FIXED_DT)).toBe(1);
    expect(c.steps).toBe(2);
    expect(c.simTime).toBeCloseTo(2 * FIXED_DT, 12);
  });

  it('accumulates partial frames and reports alpha', () => {
    const c = new FixedStepClock();
    expect(c.advance(FIXED_DT * 0.5)).toBe(0);
    expect(c.alpha).toBeCloseTo(0.5, 9);
    expect(c.advance(FIXED_DT * 0.75)).toBe(1);
    expect(c.alpha).toBeCloseTo(0.25, 9);
  });

  it('caps catch-up at MAX_CATCHUP_STEPS per frame and drops the excess', () => {
    const c = new FixedStepClock();
    expect(MAX_CATCHUP_STEPS).toBe(4);
    expect(MAX_FRAME_SECONDS / FIXED_DT).toBeGreaterThan(MAX_CATCHUP_STEPS); // the step cap is the tighter one
    expect(c.advance(5)).toBe(MAX_CATCHUP_STEPS);
    expect(c.advance(0)).toBe(0); // excess was dropped, not carried over
    // a 100 ms hitch: 4 steps now, not 6, and nothing owed to the next frame
    expect(c.advance(0.1)).toBe(4);
    expect(c.advance(FIXED_DT)).toBe(1);
    // the sub-step fraction survives for interpolation
    expect(c.advance(6.5 * FIXED_DT)).toBe(4);
    expect(c.alpha).toBeCloseTo(0.5, 6);
  });

  it('cancelSteps un-counts steps that were not run', () => {
    const c = new FixedStepClock();
    expect(c.advance(4 * FIXED_DT)).toBe(4);
    c.cancelSteps(3);
    expect(c.steps).toBe(1);
    expect(c.simTime).toBeCloseTo(1 * FIXED_DT, 12);
    c.cancelSteps(99);
    expect(c.steps).toBe(0);
  });

  it('ignores negative / non-finite time', () => {
    const c = new FixedStepClock();
    expect(c.advance(-1)).toBe(0);
    expect(c.advance(Number.NaN)).toBe(0);
    expect(c.advance(Number.POSITIVE_INFINITY)).toBe(0);
    expect(c.steps).toBe(0);
  });

  it('does not step while paused and discards leftover time on resume', () => {
    const c = new FixedStepClock();
    c.advance(FIXED_DT * 0.9);
    c.pause();
    expect(c.advance(1)).toBe(0);
    c.resume();
    expect(c.alpha).toBe(0);
    expect(c.advance(FIXED_DT * 0.5)).toBe(0);
  });

  it('is deterministic: while no frame exceeds MAX_CATCHUP_STEPS, step count depends only on total time, not slicing', () => {
    const total = 3.7;
    const slices = [0.001, 0.016, 0.033, 0.007, 0.05, 0.0166, 0.02];
    const a = new FixedStepClock();
    let t = 0;
    let i = 0;
    while (t < total - 1e-12) {
      const dt = Math.min(slices[i++ % slices.length]!, total - t);
      a.advance(dt);
      t += dt;
    }
    const b = new FixedStepClock();
    for (let k = 0; k < 74; k++) b.advance(0.05); // within the per-frame step cap
    expect(a.steps).toBe(b.steps);
    expect(a.steps).toBe(Math.floor(total / FIXED_DT + 1e-6));
    // beyond the cap the excess is dropped on purpose (slow motion), so totals then differ
    const c = new FixedStepClock();
    c.advance(0.2);
    expect(c.steps).toBe(MAX_CATCHUP_STEPS);
  });
});

class FakeRaf implements RafLike {
  private cb: ((t: number) => void) | null = null;
  request(cb: (t: number) => void): number {
    this.cb = cb;
    return 1;
  }
  cancel(): void {
    this.cb = null;
  }
  frame(t: number): void {
    const cb = this.cb;
    this.cb = null;
    cb?.(t);
  }
}

function fakeDom() {
  const listeners = new Map<string, () => void>();
  const target = {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
    fire: (type: string) => listeners.get(type)?.(),
  };
  return target;
}

describe('FrameLoop', () => {
  it('steps from rAF time and renders every frame with alpha', () => {
    const raf = new FakeRaf();
    const steps: number[] = [];
    const alphas: number[] = [];
    const loop = new FrameLoop({ step: (i) => steps.push(i), render: (a) => alphas.push(a) }, raf);
    loop.start();
    raf.frame(0); // first frame: dt = 0
    raf.frame(1000 / 30); // two steps
    expect(steps).toEqual([0, 1]);
    expect(alphas).toHaveLength(2);
    raf.frame(1000 / 30 + 1000); // 1 s gap -> capped to MAX_CATCHUP_STEPS
    expect(steps.length).toBe(2 + MAX_CATCHUP_STEPS);
  });

  it('stops the remaining steps of a batched frame when a step pauses the loop', () => {
    const raf = new FakeRaf();
    const steps: number[] = [];
    const loop: FrameLoop = new FrameLoop(
      {
        step: (i) => {
          steps.push(i);
          if (i === 0) loop.setPaused(true);
        },
        render: () => {},
      },
      raf,
    );
    loop.start();
    raf.frame(0);
    raf.frame(1000); // lagged frame: MAX_CATCHUP_STEPS steps batched
    expect(steps).toEqual([0]);
    // Only executed steps count: no phantom sim time from the skipped steps.
    expect(loop.clock.steps).toBe(1);
    expect(loop.clock.simTime).toBeCloseTo(FIXED_DT, 12);
    loop.setPaused(false);
    raf.frame(2000); // first frame after resume: dt = 0
    raf.frame(2000 + 1000 / 60 + 0.01);
    expect(steps).toEqual([0, 0]);
    expect(loop.clock.steps).toBe(steps.length);
    expect(loop.clock.simTime).toBeCloseTo(steps.length * FIXED_DT, 12);
  });

  it('pauses on visibility loss / blur, composes causes, and reports changes', () => {
    const raf = new FakeRaf();
    const changes: [boolean, string][] = [];
    let steps = 0;
    const loop = new FrameLoop({ step: () => steps++, render: () => {}, onPauseChange: (p, c) => changes.push([p, c]) }, raf);
    const doc = fakeDom();
    const win = fakeDom();
    loop.bindVisibility(doc as unknown as Document, win as unknown as Window);
    loop.start();
    raf.frame(0);

    doc.visibilityState = 'hidden';
    doc.fire('visibilitychange');
    expect(loop.paused).toBe(true);
    raf.frame(500);
    expect(steps).toBe(0);

    win.fire('blur');
    doc.visibilityState = 'visible';
    doc.fire('visibilitychange');
    expect(loop.paused).toBe(true); // still blurred
    win.fire('focus');
    expect(loop.paused).toBe(false);
    expect(changes).toEqual([
      [true, 'hidden'],
      [false, 'blurred'],
    ]);

    // time spent paused is not counted
    raf.frame(10_000);
    expect(steps).toBe(0);
    raf.frame(10_000 + 1000 / 60);
    expect(steps).toBe(1);

    loop.setPaused(true);
    expect(loop.pauseCauses.manual).toBe(true);
    raf.frame(20_000);
    expect(steps).toBe(1);
    loop.stop();
  });
});

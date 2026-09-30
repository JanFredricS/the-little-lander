import { describe, expect, it } from 'vitest';
import { FpsMeter, fpsText } from '../src/ui/fpsMeter';

describe('FPS meter', () => {
  it('publishes averaged fps / frame ms / cpu ms once per window', () => {
    const m = new FpsMeter(500);
    let published = 0;
    for (let i = 0; i <= 31; i++) if (m.frame(i * (1000 / 60), 3)) published++;
    expect(published).toBe(1);
    const r = m.reading!;
    expect(r.fps).toBeCloseTo(60, 0);
    expect(r.frameMs).toBeCloseTo(16.7, 1);
    expect(r.workMs).toBeCloseTo(3, 5);
    expect(fpsText(r)).toBe('60 FPS 16.7MS CPU 3.0');
  });

  it('tracks the worst frame and ignores a long hidden-tab gap', () => {
    const m = new FpsMeter(500);
    let t = 0;
    m.frame(t, 1);
    const worst: number[] = [];
    for (let i = 0; i < 40; i++) if (m.frame((t += i === 5 ? 50 : 1000 / 30), 1)) worst.push(m.reading!.worstMs);
    expect(worst[0]).toBe(50);
    expect(worst[1]).toBeCloseTo(33.3, 1);
    expect(m.frame(t + 5000, 1)).toBe(false); // gap: window restarts
    expect(fpsText(null)).toBe('-- FPS');
  });

  it('reset() drops the reading and the open window', () => {
    const m = new FpsMeter(500);
    for (let i = 0; i <= 31; i++) m.frame(i * (1000 / 60), 3);
    expect(m.reading).not.toBeNull();
    m.reset();
    expect(m.reading).toBeNull();
    // first frame after a reset only starts timing: no giant first interval
    expect(m.frame(99_000, 1)).toBe(false);
    for (let i = 1; i <= 31; i++) m.frame(99_000 + i * (1000 / 60), 1);
    expect(m.reading!.fps).toBeCloseTo(60, 0);
  });
});

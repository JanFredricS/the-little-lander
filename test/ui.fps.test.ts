import { describe, expect, it } from 'vitest';
import { CAUSE_EXT, FpsMeter, fpsText, FRAME_PHASES, PHASE_AUDIO, PHASE_DRAW, PHASE_PAINT, PHASE_STEP, PHASE_UPLOAD } from '../src/ui/fpsMeter';

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
    expect(fpsText(r)).toBe('60 FPS 16.7MS CPU 3.0 MAX 17 HITCH 0');
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

  it('keeps the worst frame of the last ~2 s and counts hitches (> 50 ms)', () => {
    const m = new FpsMeter(500);
    let t = 0;
    m.frame(t, 1);
    const recent: number[] = [];
    const hitches: number[] = [];
    // one 120 ms hitch at frame 10, then 3 s of steady 60 fps
    for (let i = 0; i < 200; i++)
      if (m.frame((t += i === 10 ? 120 : 1000 / 60), 1)) {
        recent.push(Math.round(m.reading!.worstRecentMs));
        hitches.push(m.reading!.hitches);
      }
    expect(recent.slice(0, 4)).toEqual([120, 120, 120, 120]); // stays up for 4 windows (~2 s)
    expect(recent[4]).toBe(17); // then drops back
    expect(hitches.at(-1)).toBe(1);
    m.frame((t += 51), 1);
    m.frame((t += 49), 1); // not a hitch
    for (let i = 0; i < 40; i++) m.frame((t += 1000 / 60), 1);
    expect(m.reading!.hitches).toBe(2);
    m.reset();
    for (let i = 0; i <= 31; i++) m.frame(t + i * (1000 / 60), 1);
    expect(m.reading!.hitches).toBe(0);
  });

  it('tags a hitch with the previous frame slowest phase, or EXT when no phase explains it', () => {
    const m = new FpsMeter(500);
    const ph = new Float64Array(FRAME_PHASES.length);
    let t = 0;
    const steady = (n: number): void => {
      ph.fill(0);
      ph[PHASE_STEP] = 1;
      for (let i = 0; i < n; i++) m.frame((t += 1000 / 60), 2, ph);
    };
    m.frame(t, 1, ph);
    steady(40);
    expect(m.reading!.lastCause).toBe(-1);
    expect(fpsText(m.reading)).toBe('60 FPS 16.7MS CPU 2.0 MAX 17 HITCH 0');
    // a frame whose terrain paint took 60 ms -> the NEXT interval is the hitch, blamed on PAINT
    ph[PHASE_PAINT] = 60;
    ph[PHASE_AUDIO] = 4;
    m.frame((t += 1000 / 60), 66, ph);
    ph.fill(0);
    m.frame((t += 70), 1, ph); // the late rAF
    steady(40);
    expect(m.reading!.hitches).toBe(1);
    expect(m.reading!.lastCause).toBe(PHASE_PAINT);
    expect(fpsText(m.reading)).toMatch(/HITCH 1 LAST PAINT 60$/);
    // a 120 ms gap with only ~1 ms of timed work: GC / compositor / timers -> EXT
    m.frame((t += 120), 1, ph);
    steady(40);
    expect(m.reading!.lastCause).toBe(CAUSE_EXT);
    expect(fpsText(m.reading)).toMatch(/HITCH 2 LAST EXT 120$/);
    // audio-heavy frame
    ph[PHASE_AUDIO] = 45;
    m.frame((t += 1000 / 60), 46, ph);
    ph.fill(0);
    m.frame((t += 60), 1, ph);
    steady(40);
    expect(fpsText(m.reading)).toMatch(/LAST AUDIO 45$/);
    m.reset();
    expect(m.reading).toBeNull();
    for (let i = 0; i <= 31; i++) m.frame(t + i * (1000 / 60), 1, ph);
    expect(m.reading!.lastCause).toBe(-1);
  });

  it('terrain streaming split across PAINT + UPLOAD: the pair is blamed (labelled by its larger half) when neither alone explains it', () => {
    const m = new FpsMeter(500);
    const ph = new Float64Array(FRAME_PHASES.length);
    let t = 0;
    const steady = (n: number): void => {
      ph.fill(0);
      for (let i = 0; i < n; i++) m.frame((t += 1000 / 60), 1, ph);
    };
    const hitch = (paint: number, upload: number, draw = 0): void => {
      ph.fill(0);
      ph[PHASE_PAINT] = paint;
      ph[PHASE_UPLOAD] = upload;
      ph[PHASE_DRAW] = draw;
      m.frame((t += 1000 / 60), paint + upload + draw, ph);
      ph.fill(0);
      m.frame((t += 80), 1, ph); // overrun ~63 ms: half is ~32
      steady(40);
    };
    m.frame(t, 1, ph);
    steady(40);
    hitch(20, 25); // neither half alone, the pair (45) does: UPLOAD (larger) with 45
    expect(fpsText(m.reading)).toMatch(/LAST UPLOAD 45$/);
    hitch(24, 18); // PAINT larger
    expect(fpsText(m.reading)).toMatch(/LAST PAINT 42$/);
    hitch(10, 8); // the pair is not enough either: EXT
    expect(m.reading!.lastCause).toBe(CAUSE_EXT);
    hitch(5, 5, 40); // one phase alone explains it: that phase, not the pair
    expect(fpsText(m.reading)).toMatch(/LAST DRAW 40$/);
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

describe('terrain diagnostics line (FPS counter)', () => {
  it('reports the latest counters and the worst terrain / upload ms of the last ~2 s windows', async () => {
    const { TerrainDiagMeter, terrainText } = await import('../src/ui/fpsMeter');
    const m = new TerrainDiagMeter();
    m.note({ jumps: 0, late: 1, syncUploads: 12, ms: 3, uploadMs: 1 });
    m.note({ jumps: 1, late: 2, syncUploads: 18, ms: 78.4, uploadMs: 61.2 });
    expect(terrainText(m.publish())).toBe('TERRAIN MAX 78 UP 61 JUMP 1 LATE 2 SYNC 18');
    // the spike stays in the readout for the ~2 s history, then ages out
    for (let w = 0; w < 3; w++) {
      m.note({ jumps: 1, late: 2, syncUploads: 18, ms: 2, uploadMs: 0.5 });
      expect(m.publish().worstMs).toBeCloseTo(78.4);
    }
    m.note({ jumps: 1, late: 2, syncUploads: 18, ms: 2, uploadMs: 0.5 });
    expect(terrainText(m.publish())).toBe('TERRAIN MAX 2 UP 1 JUMP 1 LATE 2 SYNC 18');
  });
});

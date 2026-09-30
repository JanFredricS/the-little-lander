import { describe, expect, it } from 'vitest';
import type { GameEvent, GameEventType } from '../../src/contracts';
import { cuesFor, EVENT_SFX, STATEFUL_EVENTS } from '../../src/audio/eventMap';
import { playSfx, SFX, SFX_IDS, type SfxId } from '../../src/audio/sfx';
import { FakeDriver } from './fakeDriver';
import { SAMPLE_EVENTS } from './samples';

const ALL_TYPES = Object.keys(SAMPLE_EVENTS) as GameEventType[];

/** Kinds with no one-shot cue at all, only engine state (music/thrusters). */
const STATE_ONLY: GameEventType[] = ['levelStarted', 'enginesChanged', 'cutsceneDone'];

/** Extra variants that reach SFX the base samples don't. */
const VARIANTS: GameEvent[] = [
  { type: 'ropeAttached', gun: 1, anchor: { x: 0, y: 0 }, brittle: true },
  { type: 'hullChanged', hull: 0.5, delta: -0.2, reason: 'debris' },
  { type: 'hullChanged', hull: 1, delta: 0.3, reason: 'repair' },
  { type: 'windGust', zoneId: 'w', phase: 'warning', accel: { x: -5, y: 0 } },
  { type: 'impact', pos: { x: 0, y: 0 }, speed: 200, with: 'debris:3' },
  { type: 'fuelChanged', fuel: 100, delta: 100, reason: 'refill' },
];

describe('event -> sfx mapping', () => {
  it('has a mapper for every GameEvent kind', () => {
    expect(Object.keys(EVENT_SFX).sort()).toEqual([...ALL_TYPES].sort());
  });

  it('every event kind produces cues or is handled as engine state', () => {
    for (const t of ALL_TYPES) {
      const cues = cuesFor(SAMPLE_EVENTS[t] as GameEvent);
      if (STATE_ONLY.includes(t)) {
        expect(cues, t).toEqual([]);
        expect(STATEFUL_EVENTS, t).toContain(t);
      } else {
        expect(cues.length, t).toBeGreaterThan(0);
      }
      for (const c of cues) expect(SFX_IDS, t).toContain(c.id);
    }
  });

  it('game-facing SFX are all reachable from some event (UI/dialogue ones are API-only)', () => {
    const reached = new Set<SfxId>();
    for (const e of [...Object.values(SAMPLE_EVENTS), ...VARIANTS] as GameEvent[]) for (const c of cuesFor(e)) reached.add(c.id);
    const apiOnly: SfxId[] = ['uiMove', 'uiConfirm', 'uiBack', 'typeBlip'];
    for (const id of SFX_IDS) if (!apiOnly.includes(id)) expect(reached.has(id), id).toBe(true);
  });

  it('hull hits scale with the 0..1 hull loss', () => {
    const small = cuesFor({ type: 'hullChanged', hull: 0.95, delta: -0.05, reason: 'impact' })[0]!.opts!.intensity!;
    const big = cuesFor({ type: 'hullChanged', hull: 0.6, delta: -0.4, reason: 'impact' })[0]!.opts!.intensity!;
    expect(small).toBeGreaterThan(0.1);
    expect(big).toBe(1);
  });

  it('continuous/negative-only events stay quiet where they should', () => {
    expect(cuesFor({ type: 'fuelChanged', fuel: 50, delta: -0.1, reason: 'burn' })).toEqual([]);
    expect(cuesFor({ type: 'gravityChanged', gravity: { x: 0, y: 9 }, rampProgress: 0.4 })).toEqual([]);
    expect(cuesFor({ type: 'windGust', zoneId: 'w', phase: 'end', accel: { x: 0, y: 0 } })).toEqual([]);
    expect(cuesFor({ type: 'hullChanged', hull: 0.9, delta: -0.05, reason: 'goo' })).toEqual([]);
    expect(cuesFor({ type: 'ropeReeling', gun: 0, dir: null })).toEqual([]);
  });

  it('every SFX recipe schedules at least one voice with sane params', () => {
    const d = new FakeDriver();
    for (const id of SFX_IDS) {
      d.clear();
      playSfx(d, id, 1, { intensity: 1, variant: 4, dur: 2 }, () => 0.5);
      const v = d.voices();
      expect(v.length, id).toBeGreaterThan(0);
      for (const c of v) {
        const s = c.spec;
        expect(s.start, id).toBeGreaterThanOrEqual(1);
        expect(s.gain, id).toBeGreaterThan(0);
        expect(s.gain, id).toBeLessThanOrEqual(1);
        expect(s.bus, id).toBe('sfx');
        if (c.kind === 'tone') expect(Number.isFinite(c.spec.freq) && c.spec.freq > 0, id).toBe(true);
      }
    }
    expect(Object.keys(SFX).sort()).toEqual([...SFX_IDS].sort());
  });
});

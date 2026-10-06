import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../src/contracts';
import type { GameEvent, LevelSpec, VesselState } from '../src/contracts';
import { frameHasInput, helpCard, helpCardKey } from '../src/ui/controlsHelp';
import { emptyFrame } from '../src/shell/input';
import {
  BANNER_TTL,
  BOSS_HINT_FIRST_AT,
  BOSS_HINT_REPEAT,
  BOSS_HINT_SHOW,
  BOSS_HINT_STOP_HITS,
  BOSS_HINTS,
  initHudResume,
  fuelLow,
  hudReduce,
  hudTick,
  initHud,
  objectiveLines,
  RADIATION_GRACE,
  RADIATION_HIT_FLASH,
  WIND_WARNING_TTL,
  windArrow,
  type HudState,
} from '../src/ui/hud/hudState';

const spec: Pick<LevelSpec, 'id' | 'vesselMode' | 'objectives' | 'startFuel'> = {
  id: 'floatingIsles',
  vesselMode: 'csm',
  startFuel: 0.8,
  objectives: [
    { kind: 'plantBeacons', id: 'beacons', count: 5, siteIds: ['a', 'b', 'c', 'd', 'e'] },
    { kind: 'collectOrbs', id: 'orbs', count: 3 },
    { kind: 'reachExit', id: 'exit', exitId: 'dock' },
  ],
};

const run = (events: GameEvent[], s: HudState = initHud(spec)) => events.reduce(hudReduce, s);

function vessel(p: Partial<VesselState> = {}): VesselState {
  return {
    mode: 'csm',
    pos: { x: 0, y: 0 },
    vel: { x: 0, y: 0 },
    angle: 0,
    angularVel: 0,
    fuel: 1,
    hull: 1,
    landed: false,
    crashed: false,
    attachedGoo: 0,
    engines: { main: false, left: false, right: false },
    ...p,
  };
}

describe('HUD reducer', () => {
  it('initialises objectives, fuel and mode from the level spec', () => {
    const s = initHud(spec);
    expect(s.fuel).toBe(0.8);
    expect(s.mode).toBe('csm');
    expect(s.beacons).toEqual({ planted: 0, total: 5 });
    expect(s.orbTarget).toBe(3);
    expect(objectiveLines(s)).toEqual([
      { text: 'BEACONS 0/5', done: false },
      { text: 'ORBS 0/3', done: false },
      { text: 'REACH THE EXIT', done: false },
    ]);
  });

  it('tracks fuel (low flag under 25%) and hull from events, clamped', () => {
    let s = run([
      { type: 'fuelChanged', fuel: 0.3, delta: -0.5, reason: 'burn' },
      { type: 'hullChanged', hull: 0.6, delta: -0.4, reason: 'impact' },
    ]);
    expect(fuelLow(s)).toBe(false);
    s = run([{ type: 'fuelChanged', fuel: 0.24, delta: -0.06, reason: 'burn' }], s);
    expect(fuelLow(s)).toBe(true);
    s = run([{ type: 'fuelChanged', fuel: 1.5, delta: 1, reason: 'refill' }, { type: 'hullChanged', hull: -1, delta: -2, reason: 'debris' }], s);
    expect(s.fuel).toBe(1);
    expect(s.hull).toBe(0);
  });

  it('counts beacons, orbs and completes objectives', () => {
    const s = run([
      { type: 'beaconPlanted', siteId: 'a', planted: 1, total: 5 },
      { type: 'beaconPlanted', siteId: 'b', planted: 2, total: 5 },
      { type: 'orbCollected', entityId: 'o1', points: 100, fuelRefill: 0.1 },
      { type: 'orbCollected', entityId: 'o2', points: 50, fuelRefill: 0.1 },
      { type: 'objectiveComplete', objectiveId: 'exit' },
    ]);
    expect(s.beacons).toEqual({ planted: 2, total: 5 });
    expect(s.orbs).toBe(2);
    expect(s.score).toBe(150);
    expect(objectiveLines(s)).toEqual([
      { text: 'BEACONS 2/5', done: false },
      { text: 'ORBS 2/3', done: false },
      { text: 'REACH THE EXIT', done: true },
    ]);
    expect(s.banner?.text).toBe('OBJECTIVE COMPLETE');
  });

  it('ignores objectiveComplete for unknown ids', () => {
    const s0 = initHud(spec);
    expect(hudReduce(s0, { type: 'objectiveComplete', objectiveId: 'nope' })).toBe(s0);
  });

  it('goo attach / burn count and mode changes', () => {
    const s = run([
      { type: 'gooAttached', gooId: 1, attached: 1 },
      { type: 'gooAttached', gooId: 2, attached: 2 },
      { type: 'gooBurned', gooId: 1, attached: 1 },
      { type: 'vesselModeChanged', from: 'csm', to: 'lander' },
    ]);
    expect(s.attachedGoo).toBe(1);
    expect(s.mode).toBe('lander');
  });

  it('wind gust: warning -> start -> end, and a stale warning self-clears', () => {
    let s = run([{ type: 'windGust', zoneId: 'w1', phase: 'warning', accel: { x: -6, y: 0 } }]);
    expect(s.wind?.phase).toBe('warning');
    expect(windArrow(s.wind!.accel)).toBe('left');
    s = run([{ type: 'windGust', zoneId: 'w1', phase: 'start', accel: { x: -6, y: 0 } }], s);
    expect(s.wind?.phase).toBe('start');
    // an 'end' for a different zone does not clear it
    s = run([{ type: 'windGust', zoneId: 'other', phase: 'end', accel: { x: 0, y: 0 } }], s);
    expect(s.wind).not.toBeNull();
    s = run([{ type: 'windGust', zoneId: 'w1', phase: 'end', accel: { x: 0, y: 0 } }], s);
    expect(s.wind).toBeNull();

    s = run([{ type: 'windGust', zoneId: 'w2', phase: 'warning', accel: { x: 3, y: -3 } }], s);
    expect(windArrow(s.wind!.accel)).toBe('upRight');
    for (let t = 0; t < WIND_WARNING_TTL + 0.1; t += FIXED_DT) s = hudTick(s, null, FIXED_DT);
    expect(s.wind).toBeNull();
  });

  it('radiation: charging counts down on sim time, hit flashes and clears the telegraph', () => {
    let s = run([{ type: 'radiationCharging', emitterId: 'sun', inSec: 2 }]);
    for (let i = 0; i < 60; i++) s = hudTick(s, null, FIXED_DT);
    expect(s.radiation?.inSec).toBeCloseTo(1, 5);
    s = run([{ type: 'radiationHit', emitterId: 'sun', fuelLost: 0.3 }], s);
    expect(s.radiation).toBeNull();
    expect(s.radiationHit).toBe(RADIATION_HIT_FLASH);
    expect(s.radiationFuelLost).toBe(0.3);
    for (let t = 0; t < RADIATION_HIT_FLASH + 0.05; t += FIXED_DT) s = hudTick(s, null, FIXED_DT);
    expect(s.radiationHit).toBe(0);
  });

  it('radiation telegraph with no hit clears shortly after the countdown ends', () => {
    let s = run([{ type: 'radiationCharging', emitterId: 'sun', inSec: 1 }]);
    for (let t = 0; t < 1 + FIXED_DT / 2; t += FIXED_DT) s = hudTick(s, null, FIXED_DT);
    expect(s.radiation?.inSec).toBe(0); // at 0.0s, still shown during the grace
    for (let t = 0; t < RADIATION_GRACE + 2 * FIXED_DT; t += FIXED_DT) s = hudTick(s, null, FIXED_DT);
    expect(s.radiation).toBeNull();
    // a fresh charge restarts the grace
    s = run([{ type: 'radiationCharging', emitterId: 'sun', inSec: 0.2 }], s);
    s = hudTick(s, null, FIXED_DT);
    expect(s.radiation).not.toBeNull();
  });

  it('crash clears warnings; banners expire', () => {
    let s = run([
      { type: 'windGust', zoneId: 'w', phase: 'start', accel: { x: 1, y: 0 } },
      { type: 'radiationCharging', emitterId: 'e', inSec: 3 },
      { type: 'beaconPlanted', siteId: 'a', planted: 1, total: 5 },
      { type: 'crash', cause: 'impact', pos: { x: 0, y: 0 }, speed: 300 },
    ]);
    expect(s.crashed).toBe(true);
    expect(s.wind).toBeNull();
    expect(s.radiation).toBeNull();
    for (let t = 0; t < BANNER_TTL + 0.05; t += FIXED_DT) s = hudTick(s, null, FIXED_DT);
    expect(s.banner).toBeNull();
  });

  it('boss hp from phase / hit / defeat events', () => {
    const boss = initHud({ id: 'keeper', vesselMode: 'harpoonThrust', objectives: [{ kind: 'surviveBoss', id: 'b', bossEntityId: 'k' }] });
    let s = run([{ type: 'bossPhase', phase: 1, hp: 1 }, { type: 'bossHit', damage: 0.2, hp: 0.8, source: 'rock' }], boss);
    expect(s.bossHp).toBeCloseTo(0.8);
    s = run([{ type: 'bossDefeated' }], s);
    expect(s.bossHp).toBe(0);
    expect(objectiveLines(s)[0]).toEqual({ text: 'DEFEAT THE KEEPER', done: true });
  });

  describe('round 21: boss-fight coaching (how to hurt the Keeper)', () => {
    const bossSpec = { id: 'keeper', vesselMode: 'harpoonThrust', objectives: [{ kind: 'surviveBoss', id: 'b', bossEntityId: 'k' }] } as const;
    /** Advance `sec` sim seconds; returns the hint text at every step. */
    const advance = (s0: HudState, sec: number) => {
      let s = s0;
      const seen: (string | null)[] = [];
      for (let i = 0; i < Math.round(sec / FIXED_DT); i++) {
        s = hudTick(s, null, FIXED_DT);
        seen.push(s.bossHint);
      }
      return { s, seen };
    };
    const rockHit = (hp: number): GameEvent => ({ type: 'bossHit', damage: 0.145, hp, source: 'rock' });

    it('the hints fit the HUD: two lines of at most 40 characters each', () => {
      expect(BOSS_HINTS.length).toBeGreaterThanOrEqual(2);
      for (const h of BOSS_HINTS) {
        expect(h.split('\n')).toHaveLength(2);
        for (const l of h.split('\n')) expect(l.length, l).toBeLessThanOrEqual(40);
      }
      expect(BOSS_HINTS[0]).toMatch(/HARPOON A CRACKED ROCK.*\n.*REEL IN.*KEEPER/);
      expect(BOSS_HINTS[1]).toMatch(/LURE/);
    });

    it('first hint after BOSS_HINT_FIRST_AT s for BOSS_HINT_SHOW s; the next one (the lure) after BOSS_HINT_REPEAT s without a rock hit', () => {
      let s = run([{ type: 'bossPhase', phase: 1, hp: 1 }], initHud(bossSpec));
      expect(s.bossHint).toBeNull();
      ({ s } = advance(s, BOSS_HINT_FIRST_AT - 0.1));
      expect(s.bossHint).toBeNull();
      ({ s } = advance(s, 0.2));
      expect(s.bossHint).toBe(BOSS_HINTS[0]);
      ({ s } = advance(s, BOSS_HINT_SHOW - 0.3));
      expect(s.bossHint).toBe(BOSS_HINTS[0]);
      ({ s } = advance(s, 0.3));
      expect(s.bossHint).toBeNull();
      ({ s } = advance(s, BOSS_HINT_REPEAT - 0.2));
      expect(s.bossHint).toBeNull();
      ({ s } = advance(s, 0.3));
      expect(s.bossHint).toBe(BOSS_HINTS[1]);
      // and round again: the hints alternate while no rock lands
      ({ s } = advance(s, BOSS_HINT_SHOW + BOSS_HINT_REPEAT + 0.1));
      expect(s.bossHint).toBe(BOSS_HINTS[0]);
    });

    it('a rock hit clears the hint at once and restarts the wait; after BOSS_HINT_STOP_HITS rock hits it never shows again', () => {
      let s = advance(initHud(bossSpec), BOSS_HINT_FIRST_AT + 1).s;
      expect(s.bossHint).toBe(BOSS_HINTS[0]);
      s = run([rockHit(0.855)], s);
      expect(s.bossHint).toBeNull();
      expect(s.bossRockHits).toBe(1);
      let r = advance(s, BOSS_HINT_REPEAT - 0.2);
      expect(r.seen.every((h) => h === null)).toBe(true);
      r = advance(r.s, 0.3);
      expect(r.s.bossHint).toBe(BOSS_HINTS[1]);
      // a tendril burn is not a rock drop: the coaching keeps its clock
      s = run([{ type: 'bossHit', damage: 0.035, hp: 0.82, source: 'exhaust' }], r.s);
      expect(s.bossHint).toBe(BOSS_HINTS[1]);
      for (let i = 1; i < BOSS_HINT_STOP_HITS; i++) s = run([rockHit(0.7)], s);
      expect(s.bossHint).toBeNull();
      r = advance(s, 10 * (BOSS_HINT_SHOW + BOSS_HINT_REPEAT));
      expect(r.seen.every((h) => h === null)).toBe(true);
    });

    it('no coaching once the boss is defeated, after a crash, or in a level without a boss', () => {
      const defeated = run([{ type: 'bossDefeated' }], initHud(bossSpec));
      expect(advance(defeated, 120).seen.every((h) => h === null)).toBe(true);
      let s = advance(initHud(bossSpec), BOSS_HINT_FIRST_AT + 1).s;
      expect(s.bossHint).not.toBeNull();
      s = run([{ type: 'crash', cause: 'boss', pos: { x: 0, y: 0 }, speed: 0 }], s);
      expect(s.bossHint).toBeNull();
      expect(advance(s, 120).seen.every((h) => h === null)).toBe(true);
      expect(advance(initHud(spec), 120).seen.every((h) => h === null)).toBe(true);
    });

    it('a checkpoint respawn counts the first hint from the respawn (HUD time carries the earlier lives)', () => {
      const s = initHudResume(bossSpec, { mode: 'harpoonThrust', fuel: 1, hull: 1, planted: [], completed: [], orbs: 0, score: 0, time: 100 });
      expect(advance(s, BOSS_HINT_FIRST_AT - 0.1).s.bossHint).toBeNull();
      expect(advance(s, BOSS_HINT_FIRST_AT + 0.1).s.bossHint).toBe(BOSS_HINTS[0]);
    });
  });

  it('VesselState polling is authoritative for fuel/hull/goo/mode and advances time', () => {
    let s = run([{ type: 'fuelChanged', fuel: 0.9, delta: 0, reason: 'burn' }]);
    s = hudTick(s, vessel({ fuel: 0.1, hull: 0.5, attachedGoo: 3, mode: 'lander', landed: true }), FIXED_DT);
    expect(s.fuel).toBe(0.1);
    expect(fuelLow(s)).toBe(true);
    expect(s.hull).toBe(0.5);
    expect(s.attachedGoo).toBe(3);
    expect(s.mode).toBe('lander');
    expect(s.landed).toBe(true);
    expect(s.time).toBeCloseTo(FIXED_DT);
  });

  it('windArrow covers 8 directions and calm', () => {
    expect(windArrow({ x: 0, y: 0 })).toBeNull();
    expect(windArrow({ x: 1, y: 0 })).toBe('right');
    expect(windArrow({ x: 0, y: 1 })).toBe('down');
    expect(windArrow({ x: 0, y: -1 })).toBe('up');
    expect(windArrow({ x: -1, y: 1 })).toBe('downLeft');
  });
});

describe('controls help', () => {
  it('has keyboard and touch cards for every mode', () => {
    for (const m of ['csm', 'lander', 'harpoon', 'harpoonThrust'] as const) {
      expect(helpCard(m, false).lines.length).toBeGreaterThan(2);
      expect(helpCard(m, true).lines.join(' ')).not.toMatch(/SPACE/);
    }
    expect(helpCard('lander', false).lines.join(' ')).toMatch(/LEFT ENGINE/);
    // S9: top thrusters on the keyboard + touch cards; the swapped touch card explains the flip
    expect(helpCard('lander', false).lines.join(' ')).toMatch(/Q \/ U\s+TOP LEFT/);
    expect(helpCard('lander', false).lines.join(' ')).toMatch(/E \/ O\s+TOP RIGHT/);
    expect(helpCard('lander', true).lines.join(' ')).toMatch(/TOP L/);
    expect(helpCard('lander', true, true, true).lines.join(' ')).toMatch(/LEFT BUTTON FIRES THE RIGHT ENGINE/);
    // feel pass: the swap applies to the keyboard lander keys too
    expect(helpCard('lander', false, true, true).lines.join(' ')).toMatch(/A \/ ← \/ J\s+RIGHT ENGINE/);
    expect(helpCard('lander', false, true, true).lines.join(' ')).toMatch(/Q \/ U\s+TOP RIGHT/);
    expect(helpCard('csm', false, true, true)).toEqual(helpCard('csm', false, true, false)); // other modes unaffected
    expect(helpCardKey('lander', true, true, 0, true)).not.toBe(helpCardKey('lander', true, true, 0, false));
  });

  it('help card cache key changes with the theme border (level change re-tints the card)', () => {
    expect(helpCardKey('lander', false, true, 0x4a78b0)).toBe(helpCardKey('lander', false, true, 0x4a78b0));
    expect(helpCardKey('lander', false, true, 0x4a78b0)).not.toBe(helpCardKey('lander', false, true, 0xd06a2a));
  });

  it('first-input detection ignores a hovering mouse aim', () => {
    const f = emptyFrame();
    expect(frameHasInput(f)).toBe(false);
    expect(frameHasInput({ ...f, aim: { x: 1, y: 0 }, aimTarget: { x: 10, y: 10 } })).toBe(false);
    expect(frameHasInput({ ...f, aim: { x: 1, y: 0 }, aimTarget: null })).toBe(true);
    expect(frameHasInput({ ...f, engineLeft: true })).toBe(true);
    expect(frameHasInput({ ...f, topLeft: true })).toBe(true); // S9 top thrusters dismiss the card too
    expect(frameHasInput({ ...f, topRight: true })).toBe(true);
    expect(frameHasInput({ ...f, fire: true })).toBe(true);
  });
});

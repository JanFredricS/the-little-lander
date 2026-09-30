/**
 * S7 playtests: reference autopilots fly maps 5-8 headless through the real
 * LevelSession with real InputFrames, and must complete them. These are
 * the "is it beatable" guards for the tuning in each level file (see the
 * playtest notes in the level headers).
 */

import { describe, expect, it } from 'vitest';
import { HOLLOW_ORBS, HOLLOW_ROUTE, HOLLOW_SHELTERS, hollow } from '../src/levels/hollow';
import { keeper } from '../src/levels/keeper';
import { MADDASH_ROUTE, madDash } from '../src/levels/madDash';
import { vaults } from '../src/levels/vaults';
import { runPilot } from './support/s7Harness';
import { harpoonPilot, keeperPilot, landerDashPilot, thrustPilot } from './support/s7Pilots';

describe('S7 playtests (autopilot completes the map)', () => {
  it('map 5 — The Vaults: hand-over-hand to the camp', { timeout: 120_000 }, async () => {
    const r = await runPilot(vaults, () => harpoonPilot({ landX: 13480 }), 240);
    expect(r.outcome?.kind).toBe('complete');
    expect(r.last.hull).toBeGreaterThan(0.4);
    expect(r.timeSec).toBeLessThan(200);
  });

  it('map 6 — The Hollow: through every gravity zone, 22+ orbs, into the tunnel', { timeout: 120_000 }, async () => {
    const r = await runPilot(hollow, () => hollowPilot(), 300);
    expect(r.outcome?.kind).toBe('complete');
    expect(r.counts.orbCollected).toBeGreaterThanOrEqual(22);
    expect(r.counts.gravityChanged).toBeGreaterThanOrEqual(8);
    expect(r.counts.radiationCharging).toBeGreaterThanOrEqual(10);
  });

  it('map 6 — The Hollow, careful line: hides from every sun pulse behind floating rock', { timeout: 120_000 }, async () => {
    const r = await runPilot(hollow, () => hollowPilot({ cover: true }), 480);
    expect(r.outcome?.kind).toBe('complete');
    expect(r.counts.radiationHit ?? 0).toBeLessThanOrEqual(3);
    expect(r.counts.radiationCharging).toBeGreaterThanOrEqual(20);
    expect(Math.min(...r.trace.map((t) => t.fuel))).toBeGreaterThan(0.3);
  });

  it('map 7 — The Keeper: lure it under rocks, drop them, burn off tendrils, dodge sweeps', { timeout: 300_000 }, async () => {
    // the fight is chaotic (sweeps, grabs, debris): a reference pilot of fixed
    // skill must win at least 2 of 3 slightly different lure spots
    const wins: number[] = [];
    for (const [offset, below] of [
      [130, 190],
      [140, 170],
      [125, 175],
    ] as const) {
      const log = { attempts: 0, drops: 0 };
      const r = await runPilot(keeper, () => keeperPilot(log, { offset, below }), 420);
      if (r.outcome?.kind !== 'complete') continue;
      expect(r.counts.bossPhase).toBe(3);
      expect(r.counts.bossDefeated).toBe(1);
      expect(r.events.filter((e) => e.type === 'bossHit' && e.source === 'rock').length).toBeGreaterThanOrEqual(5);
      wins.push(r.last.hull);
    }
    expect(wins.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...wins)).toBeGreaterThan(0.4);
  });

  it('map 8 — The Mad Dash: out-climbs the collapse, beats every closing gate, out through the crust', { timeout: 300_000 }, async () => {
    for (const vclimb of [90, 110, 125]) {
      let lead = Infinity;
      let gates: string[] = [];
      const r = await runPilot(madDash, () => landerDashPilot({ route: MADDASH_ROUTE, vclimb }), 200, (s) => {
        const f = s.systems.killFront!.fronts[0]!;
        if (f.active && !s.outcome) lead = Math.min(lead, f.pos - s.state.pos.y);
        gates = s.runtime.doors.doors.map((d) => d.phase);
      });
      expect(r.outcome?.kind, `climb ${vclimb} px/s`).toBe('complete');
      expect(lead, `climb ${vclimb} px/s`).toBeGreaterThan(150);
      // every gate was beaten while closing (none had to re-open)
      expect(gates.every((p) => p === 'closed')).toBe(true);
      expect(r.timeSec).toBeLessThan(130);
      expect(r.last.hull).toBeGreaterThan(0.5);
    }
  });
});

/** Thrust-only line through the on-route orbs (no rope). cover: hide in the nearest shelter while the sun charges. */
export function hollowPilot(o: { vmax?: number; cover?: boolean } = {}) {
  const orbs = HOLLOW_ORBS.filter((e) => !e.id.startsWith('orbBonus')).map((e) => ({ x: e.x, y: e.y }));
  const orbSet = new Set(orbs);
  const path = [...HOLLOW_ROUTE.filter((p) => !orbs.some((q) => Math.abs(q.x - p.x) < 80)), ...orbs].sort((a, b) => a.x - b.x);
  path.push({ x: 15900, y: 1430 });
  return thrustPilot({ path, precise: (p) => orbSet.has(p), vmax: o.vmax, ...(o.cover ? { shelters: HOLLOW_SHELTERS, shelterReach: 400 } : {}) });
}

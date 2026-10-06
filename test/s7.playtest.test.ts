/**
 * S7 playtests: reference autopilots fly maps 5-8 headless through the real
 * LevelSession with real InputFrames, and must complete them. These are
 * the "is it beatable" guards for the tuning in each level file (see the
 * playtest notes in the level headers).
 */

import { describe, expect, it } from 'vitest';
import { hollow } from '../src/levels/hollow';
import { KEEPER_ROCK_X, keeper } from '../src/levels/keeper';
import { KEEPER_TUNING } from '../src/levels/boss/keeperTuning';
import { MADDASH_ROUTE, madDash } from '../src/levels/madDash';
import { vaults } from '../src/levels/vaults';
import { runPilot } from './support/s7Harness';
import { harpoonPilot, hollowPilot, keeperPilot, landerDashPilot } from './support/s7Pilots';

describe('S7 playtests (autopilot completes the map)', () => {
  it('map 5 — The Vaults: hand-over-hand to the camp', { timeout: 120_000 }, async () => {
    const r = await runPilot(vaults, () => harpoonPilot({ landX: 13480 }), 240);
    expect(r.outcome?.kind).toBe('complete');
    expect(r.last.hull).toBeGreaterThan(0.4);
    expect(r.timeSec).toBeLessThan(200);
  });

  it('map 6 — The Hollow: through every gravity zone, 22+ orbs (20 needed), into the tunnel', { timeout: 120_000 }, async () => {
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
      // S8 fuel curve: the tightest map of the campaign keeps a margin on every winning line (measured 0.35-0.48)
      expect(r.last.fuel, `keeper lure ${offset}/${below} completion fuel`).toBeGreaterThanOrEqual(0.1);
      wins.push(r.last.hull);
    }
    expect(wins.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...wins)).toBeGreaterThan(0.4);
  });

  it('map 7 — The Keeper, round 21 winnability audit: 20 lure variants, rock supply, the lined-up glow tells the truth', { timeout: 300_000 }, async () => {
    // never more rock hits needed than rocks on the roof (7 of 12; they regrow too: 14 s, and all at a slam)
    expect(Math.ceil(1 / KEEPER_TUNING.rockDamage)).toBeLessThanOrEqual(KEEPER_ROCK_X.length * 0.6);
    // every rock can be lured under: the Keeper's hover range covers every rock, and the lure spot one dead zone past it is in the arena
    const a = keeper.entities.find((e) => e.kind === 'bossSpawn')!;
    if (a.kind !== 'bossSpawn') throw new Error('no boss');
    const m = KEEPER_TUNING.bodyRadius + 40;
    for (const x of KEEPER_ROCK_X) {
      expect(x).toBeGreaterThanOrEqual(a.arena.x + m);
      expect(x).toBeLessThanOrEqual(a.arena.x + a.arena.w - m);
      expect(x - KEEPER_TUNING.followDeadzone).toBeGreaterThan(a.arena.x);
      expect(x + KEEPER_TUNING.followDeadzone).toBeLessThan(a.arena.x + a.arena.w);
    }
    let wins = 0;
    let runs = 0;
    let minHanging = Infinity;
    let lined = 0;
    let linedHits = 0;
    let torn = 0;
    let rockHits = 0;
    for (const offset of [120, 130, 140, 150, 160])
      for (const below of [160, 175, 190, 210]) {
        const seen = new Set<number>();
        const linedIds = new Set<number>();
        let prev = new Set<number>();
        let hitsNow = 0;
        let hooked = false;
        const r = await runPilot(keeper, () => keeperPilot({ attempts: 0, drops: 0 }, { offset, below }), 480, (s) => {
          if (!hooked) {
            hooked = true;
            s.on((e) => {
              if (e.type === 'bossHit' && e.source === 'rock') hitsNow++;
            });
          }
          const rk = s.systems.rocks!;
          const b = s.systems.keeper!.brain;
          minHanging = Math.min(minHanging, rk.rocks.filter((h) => h.body !== null).length);
          const cur = new Set<number>();
          for (const f of rk.falling) {
            cur.add(f.id);
            if (seen.has(f.id)) continue;
            seen.add(f.id);
            if (b.linedUpUnder(rk.rocks.find((h) => h.entity.id === f.siteId)!.entity.x)) linedIds.add(f.id);
          }
          // a rock shattered on the Keeper leaves the falling list in the step its bossHit fires
          for (const id of prev)
            if (!cur.has(id) && hitsNow > 0) {
              hitsNow--;
              if (linedIds.has(id)) linedHits++;
            }
          hitsNow = 0;
          prev = cur;
        });
        runs++;
        if (r.outcome?.kind === 'complete') wins++;
        torn += seen.size;
        lined += linedIds.size;
        rockHits += r.events.filter((e) => e.type === 'bossHit' && e.source === 'rock').length;
      }
    // measured (round 21): 17/20 wins (the losses die in phase 3, 1-2 hits short), 9+ rocks always hanging,
    // 107 rocks torn -> 102 hits, 96 torn while lined up -> 95 hits
    expect(wins, `${wins}/${runs} lure variants win`).toBeGreaterThanOrEqual(14);
    expect(minHanging).toBeGreaterThanOrEqual(6);
    expect(rockHits / torn).toBeGreaterThan(0.85);
    expect(lined / torn).toBeGreaterThan(0.8);
    expect(linedHits / lined).toBeGreaterThan(0.95);
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
      expect(r.last.fuel, `climb ${vclimb} px/s completion fuel`).toBeGreaterThanOrEqual(0.15);
    }
  });
});

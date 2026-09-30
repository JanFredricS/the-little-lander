/**
 * LevelSpec design-rule tests for maps 5-8 (S7).
 */

import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../src/contracts';
import { LEVELS } from '../src/levels/registry';
import { s7YAt } from '../src/levels/s7Helpers';
import { validateLevel } from '../src/levels/validate';
import { HOLLOW_GRAVITY, HOLLOW_ORBS, HOLLOW_ROUTE, HOLLOW_SHELTERS, HOLLOW_SUN, hollow } from '../src/levels/hollow';
import { VAULTS_CEILING, VAULTS_GROUND, VAULTS_HOLES, VAULTS_ROUTE, VAULTS_SECTION_B, vaults } from '../src/levels/vaults';
import { LevelSession } from '../src/game/session';
import { KEEPER_ARENA, KEEPER_ROCK_X, keeper } from '../src/levels/keeper';
import { KEEPER_TUNING } from '../src/levels/boss/keeperTuning';
import { LEVEL_SYSTEM_OPTIONS } from '../src/levels/systems';
import { castSolid } from '../src/physics/tags';
import { resolveTuning } from '../src/physics/tuning';
import { vPxToM } from '../src/physics/units';

/** Densely resampled polyline (every `step` px of x). */
function sample(points: readonly Vec2[], step = 10): Vec2[] {
  const out: Vec2[] = [];
  for (let x = points[0]!.x; x <= points[points.length - 1]!.x; x += step) out.push({ x, y: s7YAt(points, x) });
  return out;
}

describe('S7 levels are registered and valid', () => {
  it.each(['vaults', 'hollow', 'keeper'] as const)('%s', (id) => {
    const spec = LEVELS[id];
    expect(spec).toBeDefined();
    expect(validateLevel(spec!)).toEqual([]);
  });
});

describe('map 5 — The Vaults', () => {
  const t = resolveTuning(vaults.physicsOverrides);
  const reach = t.harpoon.ropeRange - 30; // margin: aim + mount offset
  const roof = sample(VAULTS_CEILING).filter((p) => !VAULTS_HOLES.some(([a, b]) => p.x > a && p.x < b));
  const nearestRoof = (p: Vec2, ahead = false) => {
    let best = Infinity;
    for (const q of roof) {
      if (q.y >= p.y - 40) continue; // must be above
      if (ahead && q.x < p.x) continue;
      best = Math.min(best, Math.hypot(q.x - p.x, q.y - p.y));
    }
    return best;
  };

  it('anchorable roof ahead within harpoon range along the whole swing line', () => {
    const bad: number[] = [];
    for (let x = VAULTS_ROUTE.x0; x <= VAULTS_ROUTE.x1; x += 20) {
      const floor = Math.min(s7YAt(VAULTS_GROUND, x), 700);
      const roofHere = s7YAt(VAULTS_CEILING, x) > 100 ? s7YAt(VAULTS_CEILING, x) : 330;
      const line = { x, y: (floor + roofHere) / 2 + 40 }; // swing line: a bit below mid-height
      if (nearestRoof(line, true) > reach) bad.push(x);
    }
    expect(bad).toEqual([]);
  });

  it('section A: from every floor point the roof is in reach (no soft-lock in a pit)', () => {
    const bad: number[] = [];
    for (let x = 300; x < VAULTS_SECTION_B; x += 20) {
      const p = { x, y: s7YAt(VAULTS_GROUND, x) - 14 };
      if (nearestRoof(p) > reach) bad.push(x);
    }
    expect(bad).toEqual([]);
  });

  it('god-ray holes are narrower than a rope swing', () => {
    for (const [a, b] of VAULTS_HOLES) expect(b - a).toBeLessThan(reach);
  });

  it('paying out rope onto a floor is gentle: reelOutSpeed < damageSpeed', () => {
    expect(t.harpoon.reelOutSpeed).toBeLessThan(t.harpoon.damageSpeed);
  });

  it('is ~14k px of harpoon cave with brittle stretches, debris rains and a camp to land at', () => {
    expect(vaults.worldSize.w).toBeGreaterThanOrEqual(13000);
    expect(vaults.vesselMode).toBe('harpoon');
    expect(vaults.zones.filter((z) => z.kind === 'brittleRegion').length).toBeGreaterThanOrEqual(2);
    expect(vaults.entities.filter((e) => e.kind === 'debrisSpawner')).toHaveLength(2);
    expect(vaults.entities.filter((e) => e.kind === 'staticProp' && e.sprite === 'prop.bioParticle').length).toBeGreaterThan(40);
    const camp = vaults.entities.find((e) => e.kind === 'exitDock');
    expect(camp).toMatchObject({ requireLanding: true });
  });
});

describe('map 6 — The Hollow', () => {
  const t = resolveTuning(hollow.physicsOverrides);
  const thrustAcc = t.harpoonThrust.thrust * Math.hypot(hollow.gravity.x, hollow.gravity.y);

  async function world() {
    const s = await LevelSession.create(hollow);
    const blocked = (a: Vec2, b: Vec2) => castSolid(s.physics, vPxToM(a), vPxToM(b)) !== null;
    return { s, blocked };
  }

  it('~30 orbs; the objective leaves spares; on-route orbs sit on the flight line', () => {
    const orbs = HOLLOW_ORBS.filter((e) => e.kind === 'orb');
    expect(orbs.length).toBeGreaterThanOrEqual(28);
    expect(orbs.length).toBeLessThanOrEqual(32);
    const need = hollow.objectives.find((o) => o.kind === 'collectOrbs');
    expect(need && need.kind === 'collectOrbs' && need.count).toBeLessThanOrEqual(orbs.length - 6);
    expect(new Set(orbs.map((o) => o.id)).size).toBe(orbs.length);
    for (const o of orbs) {
      expect(o.x).toBeGreaterThan(100);
      expect(o.x).toBeLessThan(hollow.worldSize.w - 100);
    }
  });

  it('orbs, shelters and the flight line are in open air (not inside rock)', async () => {
    const { s, blocked } = await world();
    const probe = (p: Vec2) => [{ x: p.x - 14, y: p.y }, { x: p.x + 14, y: p.y }, { x: p.x, y: p.y - 14 }, { x: p.x, y: p.y + 14 }].some((q) => blocked(p, q));
    const bad = [...HOLLOW_ORBS.map((o) => ({ x: o.x, y: o.y })), ...HOLLOW_SHELTERS].filter(probe);
    expect(bad).toEqual([]);
    const cut: Vec2[] = [];
    for (let i = 1; i < HOLLOW_ROUTE.length; i++) if (blocked(HOLLOW_ROUTE[i - 1]!, HOLLOW_ROUTE[i]!)) cut.push(HOLLOW_ROUTE[i]!);
    expect(cut).toEqual([]);
    s.destroy();
  });

  it('radiation cover: every shelter is in shadow, and one is always within reach of the flight line', async () => {
    const { s, blocked } = await world();
    const sun = { x: HOLLOW_SUN.x, y: HOLLOW_SUN.y + 70 }; // just below the sun's own stalk
    const lit = HOLLOW_SHELTERS.filter((q) => !blocked(sun, q));
    expect(lit).toEqual([]);
    const emitter = hollow.zones.find((z) => z.kind === 'radiationEmitter');
    expect(emitter && emitter.kind === 'radiationEmitter' && emitter.warnSec).toBeGreaterThanOrEqual(3);
    // reach at a careful 110 px/s during the warning
    const reach = 110 * (emitter && emitter.kind === 'radiationEmitter' ? emitter.warnSec : 0);
    const far = HOLLOW_ROUTE.filter((p) => Math.min(...HOLLOW_SHELTERS.map((q) => Math.hypot(q.x - p.x, q.y - p.y))) > reach);
    expect(far).toEqual([]);
    s.destroy();
  });

  it('gravity zones alternate (up and both sideways), never overpower the thruster, never overlap', () => {
    expect(HOLLOW_GRAVITY.some((z) => z.g.y < 0)).toBe(true);
    expect(HOLLOW_GRAVITY.some((z) => z.g.x < 0)).toBe(true);
    expect(HOLLOW_GRAVITY.some((z) => z.g.x > 0)).toBe(true);
    const zs = [...HOLLOW_GRAVITY].sort((a, b) => a.x0 - b.x0);
    for (let i = 0; i < zs.length; i++) {
      expect(Math.hypot(zs[i]!.g.x, zs[i]!.g.y)).toBeLessThan(thrustAcc * 0.8);
      if (i > 0) expect(zs[i]!.x0).toBeGreaterThanOrEqual(zs[i - 1]!.x1 + 500); // a normal band between zones
    }
    const zones = hollow.zones.filter((z) => z.kind === 'gravityZone');
    expect(zones).toHaveLength(HOLLOW_GRAVITY.length);
  });
});

describe('map 7 — The Keeper', () => {
  const t = resolveTuning(keeper.physicsOverrides);
  const g = Math.hypot(keeper.gravity.x, keeper.gravity.y);
  const rocks = keeper.entities.filter((e) => e.kind === 'looseRock');
  const hoverY = KEEPER_ARENA.y + KEEPER_TUNING.hoverY;

  it('a row of loose rocks across the arena, each breakable by the winch but not by a pod just hanging on it', async () => {
    expect(rocks.length).toBe(KEEPER_ROCK_X.length);
    const s = await LevelSession.create(keeper);
    const mass = s.physics.getMass(s.vessel.body);
    s.destroy();
    const winch = (LEVEL_SYSTEM_OPTIONS.keeper?.looseRocks?.winchPull ?? 2.6) * mass * g;
    for (const r of rocks) {
      if (r.kind !== 'looseRock') continue;
      expect(r.breakForce).toBeGreaterThan(mass * g * 1.3); // hanging (and swinging a bit) holds
      expect(r.breakForce).toBeLessThan(winch * 0.9); // reeling in breaks it
      expect(r.x).toBeGreaterThan(KEEPER_ARENA.x);
      expect(r.x).toBeLessThan(KEEPER_ARENA.x + KEEPER_ARENA.w);
    }
    // neighbours closer than the Keeper's follow dead zone x 2: there is always a rock to lure it under
    for (let i = 1; i < KEEPER_ROCK_X.length; i++) expect(KEEPER_ROCK_X[i]! - KEEPER_ROCK_X[i - 1]!).toBeLessThanOrEqual(KEEPER_TUNING.followDeadzone * 2);
  });

  it('the lure spot (one dead zone beside a rock, above the Keeper) has the rock in rope range', () => {
    for (const x of KEEPER_ROCK_X) {
      const spot = { x: x + KEEPER_TUNING.followDeadzone, y: hoverY - 50 };
      const d = Math.hypot(spot.x - x, spot.y - (160 + 16));
      expect(d).toBeLessThan(t.harpoonThrust.ropeRange - 40);
      // and a dropped rock clears the vessel's hover line: it falls onto the Keeper, not the pod
      expect(spot.y).toBeLessThan(hoverY);
    }
  });

  it('the arena sits inside the world with room above and below the hover band; spawn outside it (no attacks before you enter)', () => {
    const a = KEEPER_ARENA;
    expect(a.x).toBeGreaterThan(0);
    expect(a.x + a.w).toBeLessThan(keeper.worldSize.w);
    expect(a.y + a.h).toBeLessThan(keeper.worldSize.h);
    expect(hoverY - a.y).toBeGreaterThan(KEEPER_TUNING.bodyRadius + 150);
    expect(keeper.spawn.x).toBeLessThan(a.x);
    const boss = keeper.entities.find((e) => e.kind === 'bossSpawn');
    expect(boss && boss.kind === 'bossSpawn' && boss.arena).toEqual(a);
    expect(keeper.objectives).toEqual([{ kind: 'surviveBoss', id: 'keeper', bossEntityId: 'keeper' }]);
  });

  it('fuel canisters float in open air, spread over the arena', async () => {
    const s = await LevelSession.create(keeper);
    const cans = keeper.entities.filter((e) => e.kind === 'fuelPickup');
    expect(cans.length).toBeGreaterThanOrEqual(6);
    const blocked = (a: Vec2, b: Vec2) => castSolid(s.physics, vPxToM(a), vPxToM(b)) !== null;
    for (const c of cans) {
      const p = { x: c.x, y: c.y };
      expect([{ x: p.x - 14, y: p.y }, { x: p.x + 14, y: p.y }, { x: p.x, y: p.y - 14 }, { x: p.x, y: p.y + 14 }].some((q) => blocked(p, q))).toBe(false);
    }
    const xs = cans.map((c) => c.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeLessThan(800);
    s.destroy();
  });
});

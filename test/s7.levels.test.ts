/**
 * LevelSpec design-rule tests for maps 5-8 (S7).
 */

import { surfaceY } from '../src/levels/kit';
import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../src/contracts';
import { LEVELS } from '../src/levels/registry';

import { validateLevel } from '../src/levels/validate';
import { HOLLOW_GRAVITY, HOLLOW_ORBS, HOLLOW_ROUTE, HOLLOW_SHELTERS, HOLLOW_SUN, hollow } from '../src/levels/hollow';
import { VAULTS_CEILING, VAULTS_GROUND, VAULTS_HOLES, VAULTS_ROUTE, VAULTS_SECTION_B, vaults } from '../src/levels/vaults';
import { LevelSession } from '../src/game/session';
import { KEEPER_ARENA, KEEPER_ROCK_X, keeper } from '../src/levels/keeper';
import { KEEPER_TUNING } from '../src/levels/boss/keeperTuning';
import { LEVEL_SYSTEM_OPTIONS } from '../src/levels/systems';
import { doorCentre, doorGap } from '../src/levels/runtime/doors';
import { aheadOfFront } from '../src/levels/systems/killFront';
import {
  MADDASH_GATES,
  MADDASH_INTENDED_SPEED,
  MADDASH_LEDGES,
  MADDASH_LEFT,
  MADDASH_RIGHT,
  MADDASH_ROUTE,
  MADDASH_STREAMS,
  MADDASH_TOWERS,
  madDash,
} from '../src/levels/madDash';
import { castSolid } from '../src/physics/tags';
import { resolveTuning } from '../src/physics/tuning';
import { vPxToM } from '../src/physics/units';

/** Densely resampled polyline (every `step` px of x). */
function sample(points: readonly Vec2[], step = 10): Vec2[] {
  const out: Vec2[] = [];
  for (let x = points[0]!.x; x <= points[points.length - 1]!.x; x += step) out.push({ x, y: surfaceY(points, x) });
  return out;
}

describe('S7 levels are registered and valid', () => {
  it.each(['vaults', 'hollow', 'keeper', 'madDash'] as const)('%s', (id) => {
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
      const floor = Math.min(surfaceY(VAULTS_GROUND, x), 700);
      const roofHere = surfaceY(VAULTS_CEILING, x) > 100 ? surfaceY(VAULTS_CEILING, x) : 330;
      const line = { x, y: (floor + roofHere) / 2 + 40 }; // swing line: a bit below mid-height
      if (nearestRoof(line, true) > reach) bad.push(x);
    }
    expect(bad).toEqual([]);
  });

  it('section A: from every floor point the roof is in reach (no soft-lock in a pit)', () => {
    const bad: number[] = [];
    for (let x = 300; x < VAULTS_SECTION_B; x += 20) {
      const p = { x, y: surfaceY(VAULTS_GROUND, x) - 14 };
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

describe('map 8 — The Mad Dash', () => {
  const LANDER_HALF = resolveTuning(madDash.physicsOverrides).lander.legSpan / 2; // 15 px
  /** Wall x at y (the wall profiles are sampled top -> bottom). */
  const wallAt = (wall: readonly Vec2[], y: number) => {
    for (let i = 1; i < wall.length; i++) {
      const a = wall[i - 1]!;
      const b = wall[i]!;
      if (y <= b.y) return a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y);
    }
    return wall[wall.length - 1]!.x;
  };
  /** The route resampled every 10 px of climb, bottom -> top. */
  const line = (() => {
    const out: Vec2[] = [];
    for (let i = 1; i < MADDASH_ROUTE.length; i++) {
      const a = MADDASH_ROUTE[i - 1]!;
      const b = MADDASH_ROUTE[i]!;
      for (let k = 0; k < 10; k++) out.push({ x: a.x + ((b.x - a.x) * k) / 10, y: a.y + ((b.y - a.y) * k) / 10 });
    }
    out.push(MADDASH_ROUTE[MADDASH_ROUTE.length - 1]!);
    return out;
  })();
  const front = madDash.zones.find((z) => z.kind === 'killFront')!;
  if (front.kind !== 'killFront') throw new Error('no front');
  const maxLag = LEVEL_SYSTEM_OPTIONS.madDash!.killFront!.maxLag!;

  it('is ~10,000 px of climb from the base hall to the hole in the crust, exit above the last wall', () => {
    const exit = madDash.entities.find((e) => e.kind === 'exitDock')!;
    expect(madDash.spawn.y - exit.y).toBeGreaterThan(9500);
    expect(MADDASH_ROUTE[0]!.y).toBeGreaterThan(madDash.spawn.y - 40);
    const top = MADDASH_ROUTE[MADDASH_ROUTE.length - 1]!;
    expect(exit.kind === 'exitDock' && top.y < exit.y && top.y > exit.y - exit.h && Math.abs(top.x - exit.x) < exit.w / 2).toBe(true);
    expect(madDash.objectives).toEqual([{ kind: 'reachExit', id: 'escape', exitId: exit.id }]);
  });

  it('the intended line keeps clear of walls, towers and crumbling ledges', () => {
    for (const p of line) {
      if (p.y < MADDASH_LEFT[0]!.y) continue; // in the sky
      expect(p.x - wallAt(MADDASH_LEFT, p.y), `left wall at y ${p.y}`).toBeGreaterThan(LANDER_HALF + 25);
      expect(wallAt(MADDASH_RIGHT, p.y) - p.x, `right wall at y ${p.y}`).toBeGreaterThan(LANDER_HALF + 25);
      for (const t of MADDASH_TOWERS) {
        const inY = p.y > t.y - 40 && p.y < t.y + t.h + 40;
        if (inY) expect(Math.abs(p.x - t.x), `${t.id} at y ${p.y}`).toBeGreaterThan(t.w / 2 + LANDER_HALF + 40);
      }
      for (const l of MADDASH_LEDGES) {
        if (Math.abs(p.y - l.y) < 40) expect(Math.abs(p.x - l.x), `${l.id} at y ${p.y}`).toBeGreaterThan(l.w / 2 + LANDER_HALF + 30);
      }
    }
  });

  it('debris streams fall beside the line, never on it', () => {
    for (const st of MADDASH_STREAMS) {
      for (const p of line) if (p.y > st.y && p.y < st.y + 800) expect(Math.abs(p.x - st.x), `${st.id} at y ${p.y}`).toBeGreaterThan(st.w / 2 + LANDER_HALF + 30);
    }
  });

  /** Fly the line at `speed` (px/s along the line) after a lift-off delay; returns the smallest lead over the front (px). */
  const leadAt = (speed: number, liftOff = 1.5) => {
    let t = 0;
    let pos = front.start;
    let active = false;
    let worst = Infinity;
    const act = front.activate;
    const step = (p: Vec2, dt: number) => {
      t += dt;
      if (!active) active = !act || act.kind === 'start' || (act.kind === 'time' ? t >= act.atSec : act.kind === 'enterRegion' ? p.y <= act.rect.y + act.rect.h && p.y >= act.rect.y - 200 : false);
      if (!active) return;
      pos += front.speed * dt;
      const ahead = aheadOfFront(front, pos, p);
      if (ahead > maxLag) pos += Math.sign(front.speed) * (ahead - maxLag);
      worst = Math.min(worst, aheadOfFront(front, pos, p));
    };
    for (let k = 0; k < liftOff * 60; k++) step(madDash.spawn, 1 / 60);
    for (let i = 1; i < line.length; i++) {
      const d = Math.hypot(line[i]!.x - line[i - 1]!.x, line[i]!.y - line[i - 1]!.y);
      step(line[i]!, d / speed);
    }
    return worst;
  };

  it('a survivable line: flown at the intended speed the collapse front stays >= 150 px behind', () => {
    expect(leadAt(MADDASH_INTENDED_SPEED)).toBeGreaterThanOrEqual(150);
  });

  it('it forces speed: the line flown barely faster than the front itself is caught', () => {
    expect(leadAt(Math.abs(front.speed) * 1.02)).toBeLessThan(0);
  });

  it('closing gates: at the intended speed each gap is still >= lander + 60 px wide when you reach it, and the line runs through it', () => {
    for (const g of MADDASH_GATES) {
      const e = madDash.entities.find((x) => x.id === g.id)!;
      if (e.kind !== 'blastDoor' || e.close.kind !== 'enterRegion') throw new Error(g.id);
      // triggered entering the region from below; reach the door's underside
      const climb = e.close.rect.y + e.close.rect.h - (e.y + e.h / 2 + 9);
      for (const speed of [MADDASH_INTENDED_SPEED, Math.abs(front.speed)]) {
        const c = Math.min(1, climb / speed / e.closeDurationSec);
        const gap = doorGap(e, c);
        if (speed === MADDASH_INTENDED_SPEED) expect(gap, g.id).toBeGreaterThanOrEqual(2 * LANDER_HALF + 60);
        else expect(gap, `${g.id} at the front's speed`).toBeGreaterThanOrEqual(2 * LANDER_HALF + 20);
        const door = doorCentre(e, c);
        const edge = g.from === 'left' ? door.x + e.w / 2 : door.x - e.w / 2;
        const x = line.reduce((best, p) => (Math.abs(p.y - e.y) < Math.abs(best.y - e.y) ? p : best)).x;
        expect(g.from === 'left' ? x - edge : edge - x, `${g.id}: the line is on the open side`).toBeGreaterThan(LANDER_HALF + 10);
      }
      // the door seals the shaft completely when shut (no roughness there)
      expect(wallAt(MADDASH_LEFT, e.y)).toBeGreaterThanOrEqual(e.x - e.w / 2 - 1);
      expect(wallAt(MADDASH_RIGHT, e.y)).toBeLessThanOrEqual(e.x + e.w / 2 + 1);
    }
  });

  it('fuel: the climb at the intended speed needs well under a tank', () => {
    const t = resolveTuning(madDash.physicsOverrides).lander;
    const length = line.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - line[i]!.x, p.y - line[i]!.y), 0);
    const hoverDuty = 1 / (2 * t.thrust);
    const burn = (length / MADDASH_INTENDED_SPEED) * hoverDuty;
    expect(burn / t.burnSeconds).toBeLessThan(0.8);
  });

});

/**
 * Round 18 (player feedback, filed against "The Vaults" but about the orb + gravity-zone
 * level, The Hollow): orb surplus, checkpoints every ~2 orbs, gravity-aware respawn rule.
 */
import { describe, expect, it } from 'vitest';
import type { GameEvent, LevelSpec } from '../src/contracts';
import { CHECKPOINT_MIN_FUEL, CHECKPOINT_MIN_HULL, LevelSession, type RespawnState } from '../src/game/session';
import { HOLLOW_CHECKPOINTS, HOLLOW_GRAVITY, HOLLOW_ORBS, HOLLOW_ROCKS, HOLLOW_SPIRES, hollow } from '../src/levels/hollow';
import { s7DistToPolygon } from '../src/levels/s7Helpers';
import { respawnSpotError, validateLevel } from '../src/levels/validate';
import { vPxToM } from '../src/physics/units';
import { missionPhrase } from '../src/ui/controlsHelp';
import { initHud } from '../src/ui/hud/hudState';
import { frame } from './support/s7Harness';
import { hollowPilot } from './support/s7Pilots';

const required = (() => {
  const o = hollow.objectives.find((q) => q.kind === 'collectOrbs');
  return o && o.kind === 'collectOrbs' ? o.count : 0;
})();
const placed = hollow.entities.filter((e) => e.kind === 'orb');
const surplus = placed.length - required;
const respawnState = (id: string, pickups: string[], fuel = 1, hull = 0.8): RespawnState => {
  const c = HOLLOW_CHECKPOINTS.find((q) => q.id === id)!;
  const r = c.respawn!;
  return { checkpoint: { id, mode: 'harpoonThrust', spawn: { pos: { x: r.x, y: r.y }, angle: r.angle ?? 0, vel: { x: 0, y: 0 }, fuel, hull }, resting: true, pickups, completed: [] }, planted: [], elapsed: 0 };
};
/** Respawn x of each checkpoint, with the level spawn first and the far wall last. */
const segBounds = [hollow.spawn.x, ...HOLLOW_CHECKPOINTS.map((c) => c.respawn!.x), hollow.worldSize.w];
const orbsIn = (a: number, b: number) => placed.filter((o) => o.x >= a && o.x < b);

describe('round 18: The Hollow orb surplus', () => {
  it('an explicit requirement (20 since round 20, was 22) below the placed count (30): a 50% surplus, 10 spares, nothing mandatory-perfect', () => {
    expect(required).toBe(20);
    expect(placed.length).toBe(30);
    expect(surplus).toBe(10);
    expect(placed.length).toBeGreaterThanOrEqual(Math.ceil(required * 1.5));
    // no stretch between consecutive respawn points holds more than the surplus: skipping a
    // whole stretch (or any surplus-many orbs anywhere) still leaves the requirement
    for (let i = 0; i + 1 < segBounds.length; i++) expect(orbsIn(segBounds[i]!, segBounds[i + 1]!).length, `segment ${segBounds[i]}`).toBeLessThanOrEqual(surplus);
  });

  it('HUD and mission text count toward the requirement, not the placed total', () => {
    expect(initHud(hollow).orbTarget).toBe(required);
    // HUD reads "ORBS x/20" (hudView: `ORBS ${orbs}/${orbTarget}`), the mission card "COLLECT 20 ORBS"
    expect(initHud(hollow).orbTarget).toBe(20);
    expect(initHud(hollow).objectives.find((o) => o.kind === 'collectOrbs')!.total).toBe(required);
    expect(missionPhrase(hollow.objectives[0]!)).toBe('COLLECT 20 ORBS');
  });
});

describe('round 18: The Hollow checkpoints (every ~2 orbs)', () => {
  it('13 enterRegion checkpoints in x order; ~2 orbs between respawns (<= 5 across the sideways zones, which cannot host one)', () => {
    expect(validateLevel(hollow)).toEqual([]);
    const cps = hollow.checkpoints!;
    expect(cps.length).toBe(13);
    expect(cps.map((c) => c.id)).toEqual(HOLLOW_CHECKPOINTS.map((c) => c.id));
    const counts: number[] = [];
    for (let i = 0; i + 1 < segBounds.length; i++) counts.push(orbsIn(segBounds[i]!, segBounds[i + 1]!).length);
    expect(counts).toEqual([2, 1, 4, 2, 1, 4, 1, 1, 2, 1, 3, 5, 1, 2]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(placed.length);
    // the 4- and 5-orb stretches are exactly the ones over a sideways zone (or up1's entry)
    const side = HOLLOW_GRAVITY.filter((z) => z.g.x !== 0);
    for (let i = 0; i + 1 < segBounds.length; i++) {
      if (counts[i]! <= 3) continue;
      const [a, b] = [segBounds[i]!, segBounds[i + 1]!];
      const overSide = side.some((z) => z.x0 < b && z.x1 > a);
      const up1Entry = a < 2600 && b > 2600;
      expect(overSide || up1Entry, `segment ${a}-${b}`).toBe(true);
    }
    expect(counts.reduce((a, b) => a + b, 0) / counts.length).toBeLessThan(2.25);
    for (const [i, c] of cps.entries()) {
      const r = c.respawn!;
      const rect = c.rect!;
      expect(c.at).toBe('enterRegion');
      expect([rect.y, rect.h, rect.w]).toEqual([0, hollow.worldSize.h, 40]);
      expect(r.x, c.id).toBeGreaterThan(rect.x + rect.w); // past its own band
      if (i > 0) expect(r.x, c.id).toBeGreaterThan(cps[i - 1]!.respawn!.x);
      // never in a sideways zone; upside down (angle pi) exactly in the up zones
      const z = HOLLOW_GRAVITY.find((q) => r.x >= q.x0 && r.x < q.x1);
      expect(z?.g.x ?? 0, c.id).toBe(0);
      expect(r.angle ?? 0, c.id).toBe(z && z.g.y < 0 ? Math.PI : 0);
    }
  });

  it('audit M1 / L1: every respawn is >= 45 px (centre) from any spire outline and >= 90 px from a gravity-zone edge', () => {
    const ids = new Set(HOLLOW_SPIRES.map((sp) => sp.id));
    const spires = hollow.terrain.pieces.filter((p) => ids.has(p.id));
    expect(spires.length).toBe(HOLLOW_SPIRES.length);
    for (const c of HOLLOW_CHECKPOINTS) {
      const r = c.respawn!;
      const near = Math.min(...spires.map((p) => s7DistToPolygon(r, p.points)));
      expect(near, c.id).toBeGreaterThanOrEqual(45);
      const edge = Math.min(...HOLLOW_GRAVITY.flatMap((z) => [Math.abs(r.x - z.x0), Math.abs(r.x - z.x1)]));
      expect(edge, c.id).toBeGreaterThanOrEqual(90);
    }
  });

  it('validator (gravity-aware respawn rule): an up-zone spot needs rock ABOVE; a sideways-zone spot is rejected', () => {
    const k = HOLLOW_ROCKS.find((q) => q.id === 'isle6')!; // up1
    const under = HOLLOW_CHECKPOINTS.find((c) => c.id === 'up1')!.respawn!;
    expect(respawnSpotError(hollow, under)).toBeNull();
    // audit L3: the angle must stand the pod upright against the local pull
    expect(respawnSpotError(hollow, { ...under, angle: 0 })).toMatch(/not upright/);
    const top = HOLLOW_CHECKPOINTS.find((c) => c.id === 'isle1')!.respawn!;
    expect(respawnSpotError(hollow, { ...top, angle: Math.PI })).toMatch(/not upright/);
    expect(respawnSpotError(hollow, { ...top, angle: 0.3 })).toBeNull();
    expect(respawnSpotError(hollow, { ...top, angle: -0.5 })).toMatch(/not upright/);
    // the same x but well below the rock: nothing within 40 px "below" in an up zone
    expect(respawnSpotError(hollow, { x: under.x, y: under.y + 120, angle: Math.PI })).toMatch(/above \(inverted gravity\)/);
    // resting on top of it would be falling off it upwards
    expect(respawnSpotError(hollow, { x: k.x, y: k.y - k.r - 14 })).not.toBeNull();
    const west = HOLLOW_GRAVITY.find((z) => z.id === 'west1')!;
    const rock = HOLLOW_ROCKS.find((q) => q.x > west.x0 + 150 && q.x < west.x1 - 150)!;
    expect(respawnSpotError(hollow, { x: rock.x, y: rock.y - rock.r - 12 })).toMatch(/sideways gravity zone 'west1'/);
    // and the level-wide rule still runs where gravity is plain down
    const bad: LevelSpec = { ...hollow, checkpoints: [{ id: 'x', at: 'enterRegion', rect: { x: 6000, y: 0, w: 40, h: 2400 }, respawn: { x: rock.x, y: rock.y - rock.r - 12 } }] };
    expect(validateLevel(bad).join()).toMatch(/sideways gravity zone/);
    const flipped: LevelSpec = { ...hollow, checkpoints: hollow.checkpoints!.map((c) => (c.id === 'up1' ? { ...c, respawn: { ...c.respawn!, angle: 0 } } : c)) };
    expect(validateLevel(flipped).join()).toMatch(/checkpoint 'up1': respawn angle 0.00 is not upright/);
  });

  it('captured on crossing a band, forward only', async () => {
    const s = await LevelSession.create(hollow);
    s.start();
    try {
      const go = (x: number) => {
        s.physics.setTransform(s.vessel.body, vPxToM({ x, y: 300 }), 0);
        s.physics.setLinearVelocity(s.vessel.body, { x: 0, y: 0 });
        s.step(frame());
        s.step(frame());
      };
      go(900);
      expect(s.checkpoint).toBeNull();
      const c5 = HOLLOW_CHECKPOINTS[5]!;
      go(c5.rect!.x + 20);
      expect(s.checkpoint?.id).toBe(c5.id);
      go(HOLLOW_CHECKPOINTS[1]!.rect!.x + 20); // back west: never moves the respawn back
      expect(s.checkpoint?.id).toBe(c5.id);
    } finally {
      s.destroy();
    }
  });

  it('every respawn rests silently (no thud, no damage), upright on rock tops and upside down under rocks in the up zones', async () => {
    for (const c of HOLLOW_CHECKPOINTS) {
      const s = await LevelSession.create(hollow, respawnState(c.id, []));
      const events: GameEvent[] = [];
      s.on((e) => events.push(e));
      s.start();
      for (let i = 0; i < 180; i++) s.step(frame());
      expect(s.outcome, c.id).toBeNull();
      expect(s.checkpoint?.id, c.id).toBe(c.id);
      expect(s.state.hull, c.id).toBeCloseTo(0.8, 5);
      expect(Math.hypot(s.state.pos.x - c.respawn!.x, s.state.pos.y - c.respawn!.y), c.id).toBeLessThan(6);
      expect(events.filter((e) => e.type === 'impact' || e.type === 'hullChanged' || e.type === 'crash').length, c.id).toBe(0);
      s.destroy();
    }
  });

  it(
    'from EVERY checkpoint the plain line pilot (no lead-in) still reaches the requirement: 3 most recent orbs missed, fuel + hull at the checkpoint floors',
    { timeout: 900_000 },
    async () => {
      const results: string[] = [];
      for (const c of HOLLOW_CHECKPOINTS) {
        const r = c.respawn!;
        // pessimistic premise: the player missed the 3 orbs right before the checkpoint
        // (on top of anything the pilot then misses), and arrives on the floors
        const west = placed.filter((o) => o.x < r.x).sort((a, b) => b.x - a.x);
        const pickups = west.slice(3).map((o) => o.id);
        const s = await LevelSession.create(hollow, respawnState(c.id, pickups, CHECKPOINT_MIN_FUEL, CHECKPOINT_MIN_HULL));
        s.start();
        // audit M2: the plain line pilot, no hand-made lead-in (it hid two spire-pinned spots)
        const pilot = hollowPilot();
        let t = 0;
        for (; t < 300 * 60 && !s.outcome; t++) s.step(pilot(s, t));
        results.push(`${c.id}: start ${pickups.length} -> ${s.outcome?.kind ?? 'none'} with ${s.orbs} orbs`);
        expect(s.outcome?.kind, results.join('\n')).toBe('complete');
        expect(s.orbs, c.id).toBeGreaterThanOrEqual(required);
        s.destroy();
      }
    },
  );
});

it('round 18: HOLLOW_ORBS is the placed set (30 = 26 line + 4 bonus)', () => {
  expect(HOLLOW_ORBS.map((o) => o.id)).toEqual(placed.map((o) => o.id));
  expect(HOLLOW_ORBS.filter((o) => o.id.startsWith('orbBonus')).length).toBe(4);
});

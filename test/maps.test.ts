/**
 * S6 maps 1-4: spec validity, geometry fairness (sensors on solid ground,
 * pickups / spawners in free space, door timings, island speeds), the
 * dragon-bird state machine, and autopilot playtests proving each map is
 * beatable within its fuel / hull budget.
 */

import { describe, expect, it } from 'vitest';
import type { BlastDoorEntity, CreatureEntity, LevelSpec, MovingIslandEntity, Vec2 } from '../src/contracts';
import { FIXED_DT, STORY_LEVELS } from '../src/contracts';
import { LevelSession } from '../src/game/session';
import { flyRoute } from '../src/levels/dev/autopilot';
import { ROUTES } from '../src/levels/dev/routes';
import { crossingsAt, surfaceY } from '../src/levels/kit';
import { LEVELS, resolveLevelParam } from '../src/levels/registry';
import { CARRY_SEC, DragonBirdSequence, SEIZE_RADIUS } from '../src/levels/runtime/creatures';
import { doorGap, REOPEN_AFTER_SEC } from '../src/levels/runtime/doors';
import { islandOffset, islandPeakSpeed } from '../src/levels/runtime/paths';
import { validateLevel } from '../src/levels/validate';
import { resolveTuning } from '../src/physics/tuning';

const S6 = ['hangarRun', 'descent', 'floatingIsles', 'throat'] as const;
const spec = (id: (typeof S6)[number]): LevelSpec => LEVELS[id]!;

// ------------------------------------------------------------ geometry utils

function insidePolygon(points: readonly Vec2[], p: Vec2): boolean {
  // vertical ray upward from p: odd number of edge crossings above -> inside
  return crossingsAt(points, p.x).filter((y) => y < p.y).length % 2 === 1;
}

/** Is world point p inside static solid terrain (+ moving islands at pose t)? */
function insideSolid(s: LevelSpec, p: Vec2, islandT = 0): boolean {
  for (const piece of s.terrain.pieces) {
    const pts = piece.points;
    if (piece.kind === 'polygon') {
      if (insidePolygon(pts, p)) return true;
    } else if (p.x >= pts[0]!.x && p.x <= pts[pts.length - 1]!.x) {
      const y = surfaceY(pts, p.x);
      if (piece.kind === 'ground' ? p.y > y : p.y < y) return true;
    }
  }
  for (const e of s.entities) {
    if (e.kind !== 'movingIsland') continue;
    const o = islandOffset(e.path, e.periodSec, e.motion, islandT);
    if (insidePolygon(e.outline.map((q) => ({ x: e.x + o.x + q.x, y: e.y + o.y + q.y })), p)) return true;
  }
  return false;
}

/** A landing surface at (x, y): free just above, solid just below. */
function onGround(s: LevelSpec, x: number, y: number, islandT = 0): boolean {
  return !insideSolid(s, { x, y: y - 4 }, islandT) && insideSolid(s, { x, y: y + 10 }, islandT);
}

// ---------------------------------------------------------------- the specs

describe('maps 1-4: specs', () => {
  it.each(S6)('%s validates', (id) => {
    expect(validateLevel(spec(id))).toEqual([]);
  });

  it('have real side-scroller lengths along their scroll axis', () => {
    const len = (id: (typeof S6)[number]) => Math.max(spec(id).worldSize.w, spec(id).worldSize.h);
    expect(len('hangarRun')).toBeGreaterThanOrEqual(8000);
    expect(len('descent')).toBeGreaterThanOrEqual(14000);
    expect(len('floatingIsles')).toBeGreaterThanOrEqual(18000);
    expect(len('throat')).toBeGreaterThanOrEqual(12000);
  });

  it('run in story order and resolve from ?level=map1..map4', () => {
    expect(STORY_LEVELS.slice(0, 4)).toEqual([...S6]);
    S6.forEach((id, i) => expect(resolveLevelParam(`map${i + 1}`)).toBe(id));
    expect(spec('hangarRun').vesselMode).toBe('lander');
    expect(spec('descent').vesselMode).toBe('csm');
    expect(spec('floatingIsles').vesselMode).toBe('csm');
    expect(spec('floatingIsles').modeSwitch).toMatchObject({ to: 'lander', cutscene: 'csmSeized' });
    expect(spec('throat').vesselMode).toBe('lander');
  });

  it('descent ramps gravity 0.15 g -> 1.2 g', () => {
    const r = spec('descent').gravityRamp!;
    expect(r.gravityFrom.y).toBeCloseTo(0.15 * 9.8);
    expect(r.gravityTo.y).toBeCloseTo(1.2 * 9.8);
  });

  it('get harder: crash / damage limits tighten from map 1 to map 4', () => {
    const t1 = resolveTuning(spec('hangarRun').physicsOverrides);
    const t4 = resolveTuning(spec('throat').physicsOverrides);
    expect(t4.lander.crashSpeed).toBeLessThan(t1.lander.crashSpeed);
    expect(t4.lander.damageSpeed).toBeLessThan(t1.lander.damageSpeed);
    expect(t4.lander.burnSeconds).toBeLessThan(t1.lander.burnSeconds);
  });
});

describe('maps 1-4: objectives are reachable', () => {
  it.each(S6)('%s: spawn, pickups, spawners and creatures sit in free space', (id) => {
    const s = spec(id);
    expect(insideSolid(s, s.spawn)).toBe(false);
    for (const e of s.entities) {
      if (e.kind === 'fuelPickup' || e.kind === 'orb' || e.kind === 'gooSpawner' || (e.kind === 'creature' && !e.depth)) {
        expect(insideSolid(s, e), `${e.id} inside terrain`).toBe(false);
      }
      if (e.kind === 'debrisSpawner') {
        const c = { x: e.area.x + e.area.w / 2, y: e.area.y + e.area.h / 2 };
        expect(insideSolid(s, c), `${e.id} area inside terrain`).toBe(false);
      }
    }
  });

  it.each(S6)('%s: beacon sites and landing exits sit on solid ground, with room above', (id) => {
    const s = spec(id);
    const islands = s.entities.filter((e): e is MovingIslandEntity => e.kind === 'movingIsland');
    for (const e of s.entities) {
      if (e.kind === 'beaconSite') {
        // a site on a moving island is checked at the island's mid pose
        const isl = islands.find((i) => Math.abs(i.x - e.x) < 80 && Math.abs(i.y - e.y) < 40);
        const t = isl ? isl.periodSec / 4 : 0;
        for (const dx of [0, -(e.w / 2 - 16), e.w / 2 - 16]) expect(onGround(s, e.x + dx, e.y, t), `${e.id} at dx ${dx}`).toBe(true);
        expect(insideSolid(s, { x: e.x, y: e.y - 30 }, t), `${e.id} buried`).toBe(false);
      }
      if (e.kind === 'exitDock') {
        expect(insideSolid(s, { x: e.x, y: e.y - e.h / 2 }), `${e.id} region buried`).toBe(false);
        if (e.requireLanding) for (const dx of [0, -(e.w / 2 - 16), e.w / 2 - 16]) expect(onGround(s, e.x + dx, e.y), `${e.id} at dx ${dx}`).toBe(true);
      }
    }
  });

  it('floatingIsles plants 5 beacons of the 5 sites, then the outpost', () => {
    const s = spec('floatingIsles');
    const sites = s.entities.filter((e) => e.kind === 'beaconSite').map((e) => e.id);
    expect(sites).toHaveLength(5);
    expect(s.objectives).toContainEqual(expect.objectContaining({ kind: 'plantBeacons', count: 5, siteIds: sites }));
    expect(s.objectives).toContainEqual(expect.objectContaining({ kind: 'reachExit' }));
  });

  it('moving islands move slower than the soft-landing limit', () => {
    const land = resolveTuning(spec('floatingIsles').physicsOverrides).lander.landSpeed;
    for (const id of S6) {
      for (const e of spec(id).entities) {
        if (e.kind === 'movingIsland') expect(islandPeakSpeed(e.path, e.periodSec, e.motion)).toBeLessThan(land * 0.7);
      }
    }
  });

  it('hangar blast doors leave a lander-sized gap for a relaxed 90 px/s run-up', () => {
    const t = resolveTuning(spec('hangarRun').physicsOverrides).lander;
    const need = t.height + 2 * t.legDrop + 16;
    const doors = spec('hangarRun').entities.filter((e): e is BlastDoorEntity => e.kind === 'blastDoor');
    expect(doors.length).toBeGreaterThanOrEqual(3);
    for (const d of doors) {
      expect(d.close.kind).toBe('enterRegion');
      if (d.close.kind !== 'enterRegion') continue;
      const dist = Math.abs(d.x - (d.close.rect.x + d.close.rect.w));
      const c = Math.min(1, dist / 90 / d.closeDurationSec);
      expect(doorGap(d, c), d.id).toBeGreaterThanOrEqual(need);
    }
    expect(REOPEN_AFTER_SEC).toBeLessThan(5); // a shut door re-opens: never a soft-lock
  });
});

// -------------------------------------------------------- dragon-bird script

describe('dragon-bird sequence', () => {
  const bird = (): CreatureEntity => ({ id: 'b', kind: 'creature', species: 'dragonBird', x: 0, y: 0, path: [], speed: 240, action: 'seizeCsm' });
  const csmAt = (x: number, y: number) => ({ pos: { x, y }, mode: 'csm' as const, crashed: false });

  it('dormant until activated, then stalks toward the CSM', () => {
    const b = new DragonBirdSequence(bird());
    expect(b.update(csmAt(500, 0), false)).toBeNull();
    expect(b.phase).toBe('dormant');
    expect(b.pos).toEqual({ x: 0, y: 0 });
    b.update(csmAt(500, 0), true);
    expect(b.phase).toBe('stalking');
    for (let i = 0; i < 30; i++) b.update(csmAt(500, 0), true);
    expect(b.pos.x).toBeGreaterThan(100);
    expect(b.facing).toBe(1);
  });

  it('seizes within SEIZE_RADIUS, carries the CSM off after the switch, then is gone', () => {
    const b = new DragonBirdSequence(bird());
    b.update(csmAt(300, 0), true);
    let seized = false;
    for (let i = 0; i < 600 && !seized; i++) seized = b.update(csmAt(300, 0), true) === 'seize';
    expect(seized).toBe(true);
    expect(b.phase).toBe('seizing');
    expect(Math.hypot(b.pos.x - 300, b.pos.y)).toBeLessThanOrEqual(SEIZE_RADIUS);
    // the host switched the vessel to lander
    b.update({ pos: { x: 300, y: 0 }, mode: 'lander', crashed: false }, true);
    expect(b.phase).toBe('carrying');
    expect(b.carrying).toBe(true);
    const y0 = b.pos.y;
    for (let t = 0; t < CARRY_SEC + 0.5; t += FIXED_DT) b.update({ pos: { x: 300, y: 0 }, mode: 'lander', crashed: false }, true);
    expect(b.phase).toBe('gone');
    expect(b.pos.y).toBeLessThan(y0); // flew off upward
  });

  it('re-asks for the switch if the host dropped it', () => {
    const b = new DragonBirdSequence(bird());
    b.update(csmAt(10, 0), true);
    expect(b.update(csmAt(10, 0), true)).toBe('seize');
    let again = false;
    for (let i = 0; i < 60 && !again; i++) again = b.update(csmAt(10, 0), true) === 'seize';
    expect(again).toBe(true);
  });

  it('backstop: a mode switch from the level region while stalking snaps it to carrying', () => {
    const b = new DragonBirdSequence(bird());
    b.update(csmAt(5000, 0), true);
    b.update({ pos: { x: 5000, y: 0 }, mode: 'lander', crashed: false }, true);
    expect(b.phase).toBe('carrying');
  });

  it('floatingIsles wires exactly one seizing dragon-bird plus a region backstop', () => {
    const s = spec('floatingIsles');
    const birds = s.entities.filter((e) => e.kind === 'creature' && e.action === 'seizeCsm');
    expect(birds).toHaveLength(1);
    expect(s.modeSwitch?.trigger.kind).toBe('enterRegion');
  });
});

// ------------------------------------------------------ autopilot playtests

/** Minimum fuel / hull left for the designer's line (the autopilot flies it well). */
const BUDGET: Record<(typeof S6)[number], { maxSec: number; fuel: number; hull: number }> = {
  hangarRun: { maxSec: 150, fuel: 0.4, hull: 0.9 },
  descent: { maxSec: 130, fuel: 0.3, hull: 0.25 },
  floatingIsles: { maxSec: 360, fuel: 0.3, hull: 0.9 },
  throat: { maxSec: 260, fuel: 0.2, hull: 0.6 },
};

describe('maps 1-4: autopilot playtest (beatable within budget)', () => {
  it.each(S6)(
    '%s',
    async (id) => {
      const s = await LevelSession.create(spec(id));
      s.start();
      let switched = 0;
      s.on((e) => {
        if (e.type === 'vesselModeChanged') switched++;
      });
      const b = BUDGET[id];
      const r = flyRoute(s, ROUTES[id]!, b.maxSec);
      s.destroy();
      expect(r.outcome, JSON.stringify(r)).toBe('complete');
      expect(r.fuel).toBeGreaterThanOrEqual(b.fuel);
      expect(r.hull).toBeGreaterThanOrEqual(b.hull);
      if (id === 'floatingIsles') expect(switched).toBe(1);
    },
    240_000,
  );
});

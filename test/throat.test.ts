/**
 * Round 14: The Throat overhaul (user: "too difficult, and also boring - repetitive,
 * the lights just looks like they are thrown in randomly - skeletons and ancient
 * aliens in the walls"). Pins the level's promises:
 *  - checkpoints: 'enterRegion' (chambers A-D), forward only, validator rules, each
 *    respawn rests silently on its pillar / fin;
 *  - squeezes 100-125 px wall to wall (measured on the wall polylines), squeeze 3 short;
 *  - chamber identities: the dark chamber C (darkness band), squeeze 4's updraft,
 *    chamber D's side branch (fuel + orb behind the fin, flown by an autopilot);
 *  - the light grammar and the wall decor;
 *  - playtests: the autopilot, and a sloppier mid-skill pilot (test/support/sloppyPilot.ts)
 *    that completes with the checkpoints.
 *
 * The mid-skill pilot (MID_SKILL: inputs 9 frames late, engine duty held over 7-frame
 * windows, 15 % fast, 16 px off-centre, random held / dropped pulses), seeds 1-24, as
 * the last test here runs it: single life 11/24 complete; with the checkpoints 23/24
 * (17 respawns; the one miss crashes in squeeze 1, before checkpoint A). The S-bend
 * (squeeze 5) is the main killer after checkpoint D - a ~1,200 px retry.
 */

import { describe, expect, it, vi } from 'vitest';
import type { ArtApi, GameEvent, LevelSpec, StaticPropEntity, Vec2 } from '../src/contracts';
import { LevelSession, type RespawnState } from '../src/game/session';
import { flyRoute, type RouteNode } from '../src/levels/dev/autopilot';
import { theThroatRoute } from '../src/levels/dev/routes';
import { crossingsAt, surfaceY } from '../src/levels/kit';
import { THROAT_CHECKPOINTS, THROAT_DARK, THROAT_SQUEEZES, THROAT_TUBE, THROAT_UPDRAFT, THROAT_WALLS, theThroat, wallX } from '../src/levels/theThroat';
import { validateLevel } from '../src/levels/validate';
import { WindSystem } from '../src/physics/env/wind';
import { vPxToM } from '../src/physics/units';
import { RESPAWN_DARK_FLOOR, RESPAWN_DARK_RAMP_S, respawnDarkRamp, S7_DARKNESS, s7DarknessAt } from '../src/render/s7LevelFx';
import { emptyFrame } from '../src/shell/input';
import { flyLives, MID_SKILL } from './support/sloppyPilot';

const props = theThroat.entities.filter((e): e is StaticPropEntity => e.kind === 'staticProp');
const byId = (id: string) => theThroat.entities.find((e) => e.id === id)!;

function insideSolid(s: LevelSpec, p: Vec2): boolean {
  for (const piece of s.terrain.pieces) {
    const pts = piece.points;
    if (piece.kind === 'polygon') {
      if (crossingsAt(pts, p.x).filter((y) => y < p.y).length % 2 === 1) return true;
    } else if (p.x >= pts[0]!.x && p.x <= pts[pts.length - 1]!.x) {
      const y = surfaceY(pts, p.x);
      if (piece.kind === 'ground' ? p.y > y : p.y < y) return true;
    }
  }
  return false;
}

function distToLine(p: Vec2, line: readonly Vec2[]): number {
  let b = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const c = line[i]!;
    const lx = c.x - a.x;
    const ly = c.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * lx + (p.y - a.y) * ly) / (lx * lx + ly * ly || 1)));
    b = Math.min(b, Math.hypot(p.x - a.x - lx * t, p.y - a.y - ly * t));
  }
  return b;
}

/** Narrowest wall-to-wall clearance (px) between y0 and y1. */
function clearance(y0: number, y1: number): number {
  let m = Infinity;
  for (const p of THROAT_WALLS.left) if (p.y >= y0 && p.y <= y1) m = Math.min(m, distToLine(p, THROAT_WALLS.right));
  for (const p of THROAT_WALLS.right) if (p.y >= y0 && p.y <= y1) m = Math.min(m, distToLine(p, THROAT_WALLS.left));
  return m;
}

function respawnAt(id: string, fuel = 0.6, hull = 0.8): RespawnState {
  const c = THROAT_CHECKPOINTS.find((q) => q.id === id)!;
  return { checkpoint: { id, mode: 'lander', spawn: { pos: { ...c.respawn }, angle: 0, vel: { x: 0, y: 0 }, fuel, hull }, resting: true, pickups: [], completed: [] }, planted: [], elapsed: 0 };
}

async function start(respawn: RespawnState | null = null) {
  const s = await LevelSession.create(theThroat, respawn);
  const events: GameEvent[] = [];
  s.on((e) => events.push(e));
  s.start();
  return { s, events };
}

const teleport = (s: LevelSession, p: Vec2) => {
  s.physics.setTransform(s.vessel.body, vPxToM(p), 0);
  s.physics.setLinearVelocity(s.vessel.body, { x: 0, y: 0 });
};

describe('The Throat round 14: checkpoints', () => {
  it('four enterRegion checkpoints (chambers A-D), validator-clean, each respawning on its pillar / fin', () => {
    expect(validateLevel(theThroat)).toEqual([]);
    expect(theThroat.checkpoints!.map((c) => [c.id, c.at])).toEqual(['chamberA', 'chamberB', 'chamberC', 'chamberD'].map((id) => [id, 'enterRegion']));
    // each region sits below the squeeze before it, in order down the tube
    const below = [THROAT_SQUEEZES[0]!, THROAT_SQUEEZES[1]!, THROAT_SQUEEZES[2]!, THROAT_SQUEEZES[3]!];
    THROAT_CHECKPOINTS.forEach((c, i) => {
      expect(c.rect.y, c.id).toBeGreaterThan(below[i]!.y1);
      expect(c.respawn.y, c.id).toBeGreaterThan(c.rect.y + c.rect.h); // respawn below its own region: never inside it
      expect(insideSolid(theThroat, c.respawn), c.id).toBe(false);
    });
  });

  it('validator: enterRegion needs a rect and a respawn; a respawn inside a LATER region is rejected', () => {
    const cps = theThroat.checkpoints!;
    const withCps = (c: LevelSpec['checkpoints']) => validateLevel({ ...theThroat, checkpoints: c });
    expect(withCps([{ ...cps[0]!, rect: undefined }]).join()).toMatch(/rect/);
    expect(withCps([{ ...cps[0]!, respawn: undefined }]).join()).toMatch(/needs a respawn/);
    const b = cps[1]!;
    expect(withCps([cps[0]!, { ...b, rect: { x: 0, y: cps[0]!.respawn!.y - 20, w: 1600, h: 60 } }]).join()).toMatch(/inside the region of the later checkpoint 'chamberB'/);
  });

  it('captured on entering a region (event on the next step), forward only: flying back up never moves the respawn back', async () => {
    const { s, events } = await start();
    const a = THROAT_CHECKPOINTS[0]!;
    teleport(s, { x: 830, y: a.rect.y + 40 });
    s.step(emptyFrame());
    expect(s.checkpoint?.id).toBe('chamberA');
    expect(events.some((e) => e.type === 'checkpointReached')).toBe(false);
    s.step(emptyFrame());
    expect(events.filter((e) => e.type === 'checkpointReached').map((e) => e.type === 'checkpointReached' && e.checkpointId)).toEqual(['chamberA']);
    s.destroy();
    // respawned at C: B's and A's regions above are dead
    const r = await start(respawnAt('chamberC'));
    for (const c of THROAT_CHECKPOINTS.slice(0, 2)) {
      teleport(r.s, { x: c.respawn.x, y: c.rect.y + c.rect.h / 2 });
      r.s.step(emptyFrame());
      expect(r.s.checkpoint?.id, c.id).toBe('chamberC');
    }
    // ...but D below captures
    teleport(r.s, { x: 900, y: THROAT_CHECKPOINTS[3]!.rect.y + 40 });
    r.s.step(emptyFrame());
    expect(r.s.checkpoint?.id).toBe('chamberD');
    r.s.destroy();
  });

  it('every respawn rests: no crash, no thud, settles on the rock within a few px', async () => {
    for (const c of THROAT_CHECKPOINTS) {
      const { s, events } = await start(respawnAt(c.id));
      for (let i = 0; i < 180; i++) s.step(emptyFrame());
      expect(s.outcome, c.id).toBeNull();
      expect(s.state.landed, c.id).toBe(true);
      expect(Math.hypot(s.state.pos.x - c.respawn.x, s.state.pos.y - c.respawn.y), c.id).toBeLessThan(6);
      expect(events.filter((e) => e.type === 'impact' || e.type === 'hullChanged').length, c.id).toBe(0);
      s.destroy();
    }
  });
});

describe('The Throat round 14: squeezes and chamber identities', () => {
  it('squeezes are 100-125 px wall to wall (85-110 before), squeeze 3 is short, the rest of the tube wider', () => {
    for (const q of THROAT_SQUEEZES) {
      const c = clearance(q.y0 - 20, q.y1 + 20);
      expect(c, q.id).toBeGreaterThanOrEqual(98);
      expect(c, q.id).toBeLessThanOrEqual(125);
    }
    const s3 = THROAT_SQUEEZES[2]!;
    expect(s3.y1 - s3.y0).toBeLessThanOrEqual(260);
    // between the squeezes, nothing is tighter than a squeeze
    const gaps = THROAT_SQUEEZES.slice(0, -1).map((q, i) => [q.y1 + 60, THROAT_SQUEEZES[i + 1]!.y0 - 60] as const);
    for (const [y0, y1] of gaps) expect(clearance(y0, y1), `${y0}-${y1}`).toBeGreaterThanOrEqual(100);
  });

  it('chamber C is the dark one: the darkness band covers it and nothing else; no god-ray in it; glow-life lights the left lane', () => {
    const d = S7_DARKNESS.throat!;
    expect([d.axis, d.x0, d.x1, d.out]).toEqual(['y', THROAT_DARK.y0, THROAT_DARK.y1, [THROAT_DARK.out0, THROAT_DARK.out1]]);
    for (const y of [6700, 7000, 7400]) expect(s7DarknessAt(theThroat, 800, y), `y ${y}`).toBeGreaterThan(0.55);
    for (const y of [2100, 4500, 9200, 11500]) expect(s7DarknessAt(theThroat, 800, y), `y ${y}`).toBe(0);
    const rays = props.filter((p) => p.sprite === 'prop.godRay');
    for (const r of rays) expect(r.y + 80 < THROAT_DARK.y0 || r.y - 80 > THROAT_DARK.out0, r.id).toBe(true);
    const glow = props.filter((p) => /glow|crystal/.test(p.sprite) && p.y > THROAT_DARK.y1 && p.y < THROAT_DARK.out0);
    expect(glow.length).toBeGreaterThanOrEqual(6);
    // on the safe (left) lane, round pillar C
    const left = glow.filter((p) => p.x < 760);
    expect(left.length).toBeGreaterThanOrEqual(5);
  });

  it('a respawn in the dark (checkpoint C) eases into it: the darkness ramps from 30 % to full over 1.25 s', async () => {
    expect(respawnDarkRamp(0, false)).toBe(1); // the level start: unchanged
    expect(respawnDarkRamp(0, true)).toBeCloseTo(RESPAWN_DARK_FLOOR, 5);
    expect(respawnDarkRamp(RESPAWN_DARK_RAMP_S / 2, true)).toBeGreaterThan(RESPAWN_DARK_FLOOR);
    expect(respawnDarkRamp(RESPAWN_DARK_RAMP_S, true)).toBe(1);
    // the live layer, from checkpoint C's pillar
    const { Texture } = await import('pixi.js');
    const { S7LevelFx } = await import('../src/render/s7LevelFx');
    const spy = vi.spyOn(Texture, 'from').mockImplementation(() => Texture.WHITE);
    const art = { getSprite: () => ({ canvas: {}, width: 8, height: 8, pivot: { x: 4, y: 4 } }), getSpriteFrameCount: () => 1 } as unknown as ArtApi;
    const { s } = await start(respawnAt('chamberC'));
    const fx = new S7LevelFx(s, art);
    const full = s7DarknessAt(theThroat, s.state.pos.x, s.state.pos.y);
    expect(full).toBeGreaterThan(0.55);
    fx.render(0, 0);
    expect(fx.darkness).toBeCloseTo(full * RESPAWN_DARK_FLOOR, 3);
    for (let i = 0; i < 90; i++) s.step(emptyFrame());
    fx.render(0, 1500);
    expect(fx.darkness).toBeCloseTo(s7DarknessAt(theThroat, s.state.pos.x, s.state.pos.y), 5);
    fx.destroy();
    s.destroy();
    spy.mockRestore();
  });

  it('squeeze 4 breathes an updraft: up inside, nothing outside, capped when rising; one whoosh per visit', () => {
    const w = new WindSystem(theThroat.zones, () => {});
    const r = THROAT_UPDRAFT.rect;
    const inS4 = { x: 980, y: 8450 };
    expect(inS4.x > r.x && inS4.x < r.x + r.w && inS4.y > r.y && inS4.y < r.y + r.h).toBe(true);
    expect(w.update(10, inS4).y).toBeCloseTo(-THROAT_UPDRAFT.accel, 5);
    expect(w.update(10.5, { x: 980, y: 7000 }).y).toBe(0);
    expect(w.update(11, inS4, 0, { x: 0, y: -THROAT_UPDRAFT.speedCap - 1 }).y).toBe(0);
    // telegraph: hover in it 9 s -> one 'start', then 'end' within 2 s of leaving
    const ev: string[] = [];
    const w2 = new WindSystem(theThroat.zones, (e) => e.type === 'windGust' && ev.push(e.phase));
    for (let t = 0; t < 9; t += 1 / 60) w2.update(t, inS4);
    expect(ev).toEqual(['start']);
    for (let t = 9; t < 11.1; t += 1 / 60) w2.update(t, { x: 800, y: 9500 });
    expect(ev).toEqual(['start', 'end']);
  });

  it("chamber D's side branch: fuel + orb behind the fin (not in the main lane); an autopilot through it takes both and finishes", async () => {
    const fin = theThroat.terrain.pieces.find((p) => p.id === 'finD')!;
    const finLeft = Math.min(...fin.points.map((p) => p.x));
    for (const id of ['fuelD', 'orbD']) {
      const e = byId(id);
      expect(e.x, id).toBeGreaterThan(wallX('left', e.y) + 15);
      expect(e.x, id).toBeLessThan(finLeft - 15);
    }
    // the branch is a real passage: >= 85 px between the wall and the fin (horizontally) all along it
    const finYs = fin.points.map((p) => p.y);
    for (let y = Math.min(...finYs) + 10; y < Math.max(...finYs) - 10; y += 10) {
      const xs = crossingsAt(fin.points.map((p) => ({ x: p.y, y: p.x })), y); // fin's x-extent at y
      expect(xs[0]! - wallX('left', y), `y ${y}`).toBeGreaterThanOrEqual(84); // measured min 85 (header: >= 85)
    }
    // detour route: swap the main-lane nodes for the branch
    const branch: RouteNode[] = [
      { x: 660, y: 8980, speed: 45, tol: 20 },
      { x: 605, y: 9150, speed: 40, tol: 20 },
      { x: 610, y: 9300, speed: 40, tol: 20 },
      { x: 660, y: 9460, speed: 45, tol: 25 },
    ];
    const route = [...theThroatRoute.filter((n) => n.y > 9500), ...branch].sort((a, b) => a.y - b.y);
    const { s } = await start(respawnAt('chamberD', 0.5));
    const r = flyRoute(s, route, 200);
    expect(r.outcome, JSON.stringify(r)).toBe('complete');
    expect(s.env.pickups.collectedIds()).toEqual(expect.arrayContaining(['fuelD', 'orbD']));
    s.destroy();
  }, 120_000);
});

describe('The Throat round 14: light grammar and wall decor', () => {
  const nearWall = (p: StaticPropEntity, side: 'left' | 'right') => {
    // a wall-grown prop's base: from its centre back along its "up" by h/2 - 3
    const a = p.angle ?? 0;
    const base = { x: p.x - Math.sin(a) * (p.h / 2 - 3), y: p.y + Math.cos(a) * (p.h / 2 - 3) };
    return Math.abs(base.x - wallX(side, base.y)) < 4;
  };

  it('every squeeze: a glow-plant pair on the upper lip and a glow-mushroom pair on the lower lip, grown out of each wall', () => {
    for (const q of THROAT_SQUEEZES) {
      for (const [suffix, sprite, y] of [
        ['Lip', 'prop.glowPlant', q.y0],
        ['Exit', 'prop.glowMushroom', q.y1],
      ] as const) {
        for (const side of ['left', 'right'] as const) {
          const p = byId(`${q.id}${suffix}${side === 'left' ? 'L' : 'R'}`) as StaticPropEntity;
          expect(p.sprite, p.id).toBe(sprite);
          expect(Math.abs(p.y - y), p.id).toBeLessThan(30);
          expect(nearWall(p, side), p.id).toBe(true);
          // pointing into the passage
          const a = p.angle ?? 0;
          expect(Math.sin(a) * (side === 'left' ? 1 : -1), p.id).toBeGreaterThan(0.3);
        }
      }
    }
  });

  it('god-rays mark chamber entries / exits: none over a squeeze, one within 600 px above each squeeze and each chamber entry outside the dark', () => {
    const rays = props.filter((p) => p.sprite === 'prop.godRay');
    for (const r of rays) {
      for (const q of THROAT_SQUEEZES) expect(r.y + 80 < q.y0 - 10 || r.y - 80 > q.y1 + 10, `${r.id} over ${q.id}`).toBe(true);
    }
    const tops = (y: number) => rays.some((r) => r.y - 80 <= y && r.y - 80 >= y - 600);
    for (const q of THROAT_SQUEEZES.filter((q) => q.id !== 'squeeze3')) expect(tops(q.y0), `above ${q.id}`).toBe(true); // squeeze 3 leads into the dark
    for (const c of THROAT_CHECKPOINTS.filter((c) => c.id !== 'chamberC')) expect(rays.some((r) => Math.abs(r.y - 80 - c.rect.y) < 200), `entry ${c.id}`).toBe(true);
  });

  it('decor: a fossil bed in chamber B, ancient reliefs lining the approach, a mural in the landing chamber - all set into the rock, none solid', () => {
    const decor = props.filter((p) => /fossil|ancient/.test(p.sprite));
    const fossils = decor.filter((p) => p.sprite.startsWith('prop.fossil'));
    expect(fossils.filter((p) => p.sprite === 'prop.fossilSkeleton').length).toBeGreaterThanOrEqual(2);
    expect(fossils.length).toBeGreaterThanOrEqual(5);
    for (const f of fossils) expect(f.y > 4000 && f.y < 5000, f.id).toBe(true);
    const reliefs = decor.filter((p) => p.sprite === 'prop.ancientRelief');
    expect(reliefs.length).toBeGreaterThanOrEqual(5);
    for (const r of reliefs) expect(r.y > 9600 && r.y < 11000, r.id).toBe(true);
    expect(new Set(reliefs.map((r) => (r.x < wallX('left', r.y) + 1 ? 'L' : 'R'))).size).toBe(2); // both walls
    const mural = decor.find((p) => p.sprite === 'prop.ancientMural')!;
    expect(mural.y).toBeGreaterThan(11000);
    for (const p of decor) {
      expect(p.solid ?? false, p.id).toBe(false);
      for (const [dx, dy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const) expect(insideSolid(theThroat, { x: p.x + (dx * p.w) / 2, y: p.y + (dy * p.h) / 2 }), `${p.id} corner`).toBe(true);
    }
  });
});

describe('The Throat round 14: playtests', () => {
  it('the autopilot completes with margin (the maps.test budget is the floor)', async () => {
    const { s } = await start();
    const r = flyRoute(s, theThroatRoute, 260);
    s.destroy();
    expect(r.outcome, JSON.stringify(r)).toBe('complete');
    expect(r.fuel).toBeGreaterThanOrEqual(0.35);
    expect(r.hull).toBeGreaterThanOrEqual(0.6);
    expect(r.timeSec).toBeLessThan(220);
  }, 120_000);

  it('a sloppier mid-skill pilot (late, coarse thumbs, hurried, off-centre): the checkpoints carry it through (seeds 1-24)', async () => {
    let single = 0;
    let done = 0;
    let respawns = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const o = { ...MID_SKILL, seed };
      if ((await flyLives((rs) => LevelSession.create(theThroat, rs), theThroatRoute, o, 1)).outcome === 'complete') single++;
      const r = await flyLives((rs) => LevelSession.create(theThroat, rs), theThroatRoute, o, 5);
      if (r.outcome === 'complete') {
        done++;
        respawns += r.respawns;
      }
    }
    // header numbers: single life 11/24, with checkpoints 23/24 (17 respawns)
    expect(single).toBeGreaterThanOrEqual(9); // the squeezes stay a real test...
    expect(single).toBeLessThanOrEqual(16); // ...not a free ride
    expect(done).toBeGreaterThanOrEqual(22);
    expect(respawns).toBeLessThanOrEqual(24);
  }, 300_000);
});

// keep THROAT_TUBE referenced for readers following the geometry
void THROAT_TUBE;

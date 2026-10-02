/**
 * Round 15: Map 9 — Spring Isles. Validation, the reachability envelope of every hop
 * (derived from the spring physics), the scripted jumper climbing the whole route through
 * the real LevelSession, checkpoints resting silently, and the story slot.
 * Round 16: the harder layout - progressive narrowing to SPRING_ISLES_MIN_FLAT, the themed
 * sections (precision tier, vine curtains, animal crossing, crate gate), denser checkpoints and
 * a sloppy-aim difficulty measure (the hazards themselves: springHazards.test.ts).
 */

import { describe, expect, it } from 'vitest';
import { PX_PER_M, STORY_LEVELS } from '../src/contracts';
import { LevelSession } from '../src/game/session';
import { getLevel, resolveLevelParam } from '../src/levels/registry';
import { SPRING_ISLES_BIRDS, SPRING_ISLES_CHECKPOINTS, SPRING_ISLES_CRATES, SPRING_ISLES_CURTAINS, SPRING_ISLES_G, SPRING_ISLES_MIN_FLAT, SPRING_ISLES_ROUTE, springIsles, STAND_DY, type RouteStop } from '../src/levels/springIsles';

const idx = (id: string) => SPRING_ISLES_ROUTE.findIndex((s) => s.id === id);
import { validateLevel } from '../src/levels/validate';
import { resolveTuning } from '../src/physics/tuning';
import { springMaxRise, springReach } from '../src/physics/vessel/spring';
import { nextStoryLevel } from '../src/story/flow';
import { frame, runPilot } from './support/s7Harness';
import { climbWithRespawns, solveHop, springJumper, type JumperLog } from './support/springJumper';

const tuning = resolveTuning(springIsles.physicsOverrides);

/**
 * A stop's REAL geometry (audit L6): the outline's x span (sloped lips included) and the flat
 * landing top (the run of outline points exactly at `top`). Crumbles are flat boxes.
 */
function geometryOf(s: RouteStop): { span: [number, number]; flat: [number, number] } {
  // the meadow is the whole ground: its stop is the nominal start area
  const piece = s.kind === 'meadow' ? undefined : springIsles.terrain.pieces.find((p) => p.id === s.id);
  if (!piece) return { span: [s.cx - s.w / 2, s.cx + s.w / 2], flat: [s.cx - s.w / 2, s.cx + s.w / 2] };
  const xs = piece.points.map((p) => p.x);
  const flat = piece.points.filter((p) => Math.abs(p.y - s.top) < 0.01).map((p) => p.x);
  return { span: [Math.min(...xs), Math.max(...xs)], flat: [Math.min(...flat), Math.max(...flat)] };
}
const overlap = (a: [number, number], b: [number, number]) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
const g = SPRING_ISLES_G * tuning.gravity.scale * PX_PER_M;

describe('Spring Isles: spec', () => {
  it('validates, is map 9 after the finale, opens with ?level=map9', () => {
    expect(validateLevel(springIsles)).toEqual([]);
    expect(STORY_LEVELS.indexOf('springIsles')).toBe(8);
    expect(nextStoryLevel('madDash')).toBe('springIsles');
    expect(resolveLevelParam('map9')).toBe('springIsles');
    expect(getLevel('springIsles')).toBe(springIsles);
    expect(springIsles.vesselMode).toBe('spring');
    expect(springIsles.themeId).toBe('islands');
  });

  it('teaches in order: one-way tiers, the precision tier, vine curtains, the animal crossing, the crate gate, then crumbles', () => {
    const kinds = SPRING_ISLES_ROUTE.map((s) => s.kind);
    const firstOneWay = kinds.indexOf('oneWay');
    const firstCrumble = kinds.indexOf('crumble');
    expect(firstOneWay).toBeGreaterThan(3);
    expect(firstCrumble).toBeGreaterThan(firstOneWay);
    expect(firstCrumble).toBeGreaterThan(SPRING_ISLES_ROUTE.length * 0.6);
    const firstCurtain = Math.min(...SPRING_ISLES_CURTAINS.map((c) => idx(c.into)));
    const gate = SPRING_ISLES_ROUTE.findIndex((s) => s.gate);
    expect(firstCurtain).toBeGreaterThan(idx('c7')); // after the precision tier
    expect(idx('e1')).toBeGreaterThan(Math.max(...SPRING_ISLES_CURTAINS.map((c) => idx(c.into))));
    expect(gate).toBeGreaterThan(idx('e6'));
    expect(gate).toBeLessThan(firstCrumble);
    expect(SPRING_ISLES_BIRDS.length).toBe(3);
    expect(SPRING_ISLES_CRATES.length).toBeGreaterThanOrEqual(3);
  });

  it('a checkpoint every <= 5 hops from a4 on (12), one right after the crate gate', () => {
    expect(SPRING_ISLES_CHECKPOINTS.length).toBe(12);
    const cpIdx = SPRING_ISLES_CHECKPOINTS.map((c) => SPRING_ISLES_ROUTE.findIndex((s) => `cp_${s.id}` === c.id));
    expect(cpIdx.every((i) => i > 0)).toBe(true);
    let prev = cpIdx[0]!;
    expect(prev).toBeLessThanOrEqual(5);
    for (const i of [...cpIdx.slice(1), SPRING_ISLES_ROUTE.length - 1]) {
      expect(i - prev).toBeLessThanOrEqual(5);
      prev = i;
    }
    expect(cpIdx).toContain(SPRING_ISLES_ROUTE.findIndex((s) => s.gate));
  });

  it('narrows progressively: forgiving first hops, then each section narrower, down to SPRING_ISLES_MIN_FLAT at the top', () => {
    for (const s of SPRING_ISLES_ROUTE.slice(1, idx('b1') + 1)) expect(s.w, s.id).toBeGreaterThanOrEqual(160);
    const mean = (letter: string) => {
      const ws = SPRING_ISLES_ROUTE.filter((s) => s.id[0] === letter && s.id.length === 2).map((s) => s.w);
      return ws.reduce((a, b) => a + b, 0) / ws.length;
    };
    const order = ['a', 'b', 'c', 'd', 'e', 'g', 'h', 'i'].map(mean);
    for (let k = 1; k < order.length; k++) expect(order[k]!, `section ${k}`).toBeLessThan(order[k - 1]!);
    // after the teaching stretch nothing but checkpoints / the gate is wider than 100 px
    for (const s of SPRING_ISLES_ROUTE.slice(idx('c1'), -1)) expect(s.w, s.id).toBeLessThanOrEqual(110);
    for (const s of SPRING_ISLES_ROUTE.slice(idx('i1'), -1)) expect(s.w, s.id).toBeLessThanOrEqual(48);
    expect(Math.min(...SPRING_ISLES_ROUTE.map((s) => s.w))).toBe(SPRING_ISLES_MIN_FLAT);
  });
});

describe('Spring Isles: reachability envelope', () => {
  const maxRise = springMaxRise(tuning.spring, g);

  it('the physics envelope: full charge rises 200 px, reaches ~400 px on the flat (45°)', () => {
    expect(maxRise).toBeCloseTo(200.6, 0);
    expect(springReach(tuning.spring, g, 0)).toBeCloseTo(401, 0);
  });

  it.each(SPRING_ISLES_ROUTE.slice(1).map((s, i) => [SPRING_ISLES_ROUTE[i]!.id, s.id, i] as const))('hop %s -> %s is within 80 %% of the full-charge envelope', (_a, _b, i) => {
    const a = SPRING_ISLES_ROUTE[i]!;
    const b = SPRING_ISLES_ROUTE[i + 1]!;
    const rise = a.top - b.top;
    const dx = Math.abs(b.cx - a.cx);
    expect(rise).toBeLessThanOrEqual(0.8 * maxRise);
    // a curtain hop must also fit the aim-past allowance (the vines drag it short)
    expect(dx + (b.curtain ?? 0)).toBeLessThanOrEqual(0.8 * springReach(tuning.spring, g, rise));
    // real outlines: b's flat landing top (not its nominal w) is what the hop must reach - its near edge is within
    // the same 80 %, and the far edge is beyond it (the landing window is the flat top, >= SPRING_ISLES_MIN_FLAT, below)
    const fb = geometryOf(b).flat;
    const near = b.cx > a.cx ? fb[0] - a.cx : a.cx - fb[1];
    expect(near).toBeLessThanOrEqual(0.8 * springReach(tuning.spring, g, rise));
    // and a real aim + charge does it with the apex clearance the jumper uses
    expect(solveHop(tuning.spring, g, b.cx - a.cx, rise)).not.toBeNull();
  });

  it('stacked tiers are one-way; nothing solid overhangs a stop\'s flat landing top within one hop height (real outlines)', () => {
    for (const [i, s] of SPRING_ISLES_ROUTE.entries()) {
      const below = geometryOf(s).flat;
      for (const o of SPRING_ISLES_ROUTE.slice(i + 1)) {
        const above = s.top - o.top;
        // the upper piece's whole outline (lips included) over the lower stop's flat top
        if (overlap(geometryOf(o).span, below) > 0 && above > 0 && above < maxRise + 40) expect([o.id, o.kind === 'oneWay' || o.kind === 'crumble']).toEqual([o.id, true]);
      }
    }
  });

  it('every stop has a flat landing top of at least SPRING_ISLES_MIN_FLAT (40 px = 1.67 leg spans; real outline, not the nominal w)', () => {
    expect(SPRING_ISLES_MIN_FLAT).toBe(40);
    for (const s of SPRING_ISLES_ROUTE) {
      const g2 = geometryOf(s);
      expect(g2.flat[1] - g2.flat[0], s.id).toBeGreaterThanOrEqual(SPRING_ISLES_MIN_FLAT - 0.01);
      expect(g2.span[1] - g2.span[0], s.id).toBeGreaterThanOrEqual(s.w);
    }
  });
});

describe('Spring Isles: scripted jumper playtest', () => {
  it('climbs the whole route from the meadow to the summit dock without a miss: waits out the birds, rams the crate gate', async () => {
    const log: JumperLog = { hops: [], misses: 0 };
    const r = await runPilot(springIsles, () => springJumper(SPRING_ISLES_ROUTE, log), 400);
    expect(r.outcome?.kind).toBe('complete');
    expect(log.misses).toBe(0);
    expect(log.rams ?? 0).toBeGreaterThanOrEqual(1);
    expect(log.birdWaits ?? 0).toBeGreaterThan(0);
    // every stop is landed on in order (the ram hop is the extra one)
    const landed = log.hops.map((h) => h.to);
    for (let k = 1; k < SPRING_ISLES_ROUTE.length; k++) expect(landed, SPRING_ISLES_ROUTE[k]!.id).toContain(k);
    expect(r.counts.platformCrumbling ?? 0).toBeGreaterThanOrEqual(5);
    expect(r.counts.checkpointReached ?? 0).toBe(SPRING_ISLES_CHECKPOINTS.length);
    expect(r.last.hull).toBe(1);
    expect(r.counts.crash ?? 0).toBe(0);
  });

  it('hesitating on a crumbling islet drops you; it grows back and the climb resumes', async () => {
    const log: JumperLog = { hops: [], misses: 0 };
    const pilot = springJumper(SPRING_ISLES_ROUTE, log);
    let waited = 0;
    const r = await runPilot(
      springIsles,
      () => (s, i) => {
        const here = SPRING_ISLES_ROUTE.findIndex((q) => q.id === 'g2');
        const on = Math.abs(s.state.pos.y + STAND_DY - SPRING_ISLES_ROUTE[here]!.top) < 8 && Math.abs(s.state.pos.x - SPRING_ISLES_ROUTE[here]!.cx) < 60;
        if (on && s.state.landed && waited < 200) {
          waited++;
          return frame();
        }
        return pilot(s, i);
      },
      600,
    );
    expect(r.counts.platformCrumbled ?? 0).toBeGreaterThanOrEqual(1);
    expect(r.outcome?.kind).toBe('complete');
  });
});

describe('Spring Isles: difficulty (sloppy aim)', () => {
  // seeded uniform noise (mulberry32)
  const rng = (seed: number) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  it.each([
    [0.06, 2],
    [0.15, 2],
  ] as const)('a jumper aiming +-%s rad finishes (respawning from checkpoints)', async (noise, seeds) => {
    for (let seed = 1; seed <= seeds; seed++) {
      const r = rng(seed * 7919);
      const res = await climbWithRespawns(springIsles, SPRING_ISLES_ROUTE, { aimNoise: () => (r() * 2 - 1) * noise }, 1500);
      expect(res.complete, `seed ${seed}: ${res.respawns} respawns`).toBe(true);
      expect(res.respawns).toBeLessThanOrEqual(noise < 0.1 ? 4 : 10);
    }
  }, 600_000);
});

describe('Spring Isles: checkpoints', () => {
  it.each(SPRING_ISLES_CHECKPOINTS.map((c) => [c.id, c] as const))('%s respawn rests silently on its islet', async (_id, c) => {
    const s = await LevelSession.create({ ...springIsles, spawn: { x: c.respawn!.x, y: c.respawn!.y } });
    const events: string[] = [];
    s.on((e) => events.push(e.type));
    s.start();
    for (let i = 0; i < 90; i++) s.step(frame());
    expect(s.state.landed).toBe(true);
    expect(s.state.hull).toBe(1);
    expect(Math.abs(s.state.vel.y)).toBeLessThan(1);
    expect(events.filter((e) => e === 'hullChanged' || e === 'crash')).toEqual([]);
    s.destroy();
  });
});

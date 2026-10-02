/**
 * Round 15: Map 9 — Spring Isles. Validation, the reachability envelope of every hop
 * (derived from the spring physics), the scripted jumper climbing the whole route through
 * the real LevelSession, checkpoints resting silently, and the story slot.
 */

import { describe, expect, it } from 'vitest';
import { PX_PER_M, STORY_LEVELS } from '../src/contracts';
import { LevelSession } from '../src/game/session';
import { getLevel, resolveLevelParam } from '../src/levels/registry';
import { SPRING_ISLES_CHECKPOINTS, SPRING_ISLES_G, SPRING_ISLES_ROUTE, springIsles, STAND_DY, type RouteStop } from '../src/levels/springIsles';

const stop = (id: string) => SPRING_ISLES_ROUTE.find((s) => s.id === id)!;
import { validateLevel } from '../src/levels/validate';
import { resolveTuning } from '../src/physics/tuning';
import { springMaxRise, springReach } from '../src/physics/vessel/spring';
import { nextStoryLevel } from '../src/story/flow';
import { frame, runPilot } from './support/s7Harness';
import { solveHop, springJumper, type JumperLog } from './support/springJumper';

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

  it('teaches in order: one-way tiers before crumbling islets, crumbling ones late, a checkpoint every few tiers', () => {
    const kinds = SPRING_ISLES_ROUTE.map((s) => s.kind);
    const firstOneWay = kinds.indexOf('oneWay');
    const firstCrumble = kinds.indexOf('crumble');
    expect(firstOneWay).toBeGreaterThan(3);
    expect(firstCrumble).toBeGreaterThan(firstOneWay);
    expect(firstCrumble).toBeGreaterThan(SPRING_ISLES_ROUTE.length * 0.6);
    expect(SPRING_ISLES_CHECKPOINTS.length).toBeGreaterThanOrEqual(4);
    const cpIdx = SPRING_ISLES_CHECKPOINTS.map((c) => SPRING_ISLES_ROUTE.findIndex((s) => `cp_${s.id}` === c.id));
    let prev = 0;
    for (const i of [...cpIdx, SPRING_ISLES_ROUTE.length - 1]) {
      expect(i - prev).toBeLessThanOrEqual(8);
      prev = i;
    }
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
    expect(dx).toBeLessThanOrEqual(0.8 * springReach(tuning.spring, g, rise));
    // real outlines: b's flat landing top (not its nominal w) is what the hop must reach - its near edge is within
    // the same 80 %, and the far edge is beyond it (the landing window is the flat top, >= 60 px, below)
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
    // the measurement is the real one: b4's outline overhangs b2's outline by > 24 px (a harmless lip bonk, 380 < 480 px/s)
    // but none of b2's flat top
    expect(overlap(geometryOf(stop('b4')).span, geometryOf(stop('b2')).span)).toBeGreaterThan(24);
    expect(overlap(geometryOf(stop('b4')).span, geometryOf(stop('b2')).flat)).toBeLessThanOrEqual(0);
  });

  it('every stop has a flat landing top of at least 2.5 hull widths (real outline, not the nominal w)', () => {
    for (const s of SPRING_ISLES_ROUTE) {
      const g2 = geometryOf(s);
      expect(g2.flat[1] - g2.flat[0], s.id).toBeGreaterThanOrEqual(60);
      expect(g2.span[1] - g2.span[0], s.id).toBeGreaterThanOrEqual(s.w);
    }
  });
});

describe('Spring Isles: scripted jumper playtest', () => {
  it('climbs the whole route from the meadow to the summit dock without a miss', async () => {
    const log: JumperLog = { hops: [], misses: 0 };
    const r = await runPilot(springIsles, () => springJumper(SPRING_ISLES_ROUTE, log), 400);
    expect(r.outcome?.kind).toBe('complete');
    expect(log.misses).toBe(0);
    expect(log.hops.length).toBe(SPRING_ISLES_ROUTE.length - 1);
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
        const here = SPRING_ISLES_ROUTE.findIndex((q) => q.id === 'e2');
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

/**
 * Round 13 — The Hollow (map 6, harpoonThrust): the spire field and the floor softlock.
 *
 * User: "harpoon mission too easy, should be more stalactites from floor and roof to make
 * it more tricky. also if the user falls to the floor they get stuck due to cable not long
 * enough to reach anything".
 *  - geometry: solid spires from floor and crust along the whole route, tight gates, the
 *    route / orbs / sun shelters left clear; roof crystal lets the sun through;
 *  - recovery: a pod resting on the floor (or, in the UP zones, on the crust) with an EMPTY
 *    tank climbs back to the flight line on the rope alone, from every gap between spires;
 *    with fuel it simply flies back up.
 */

import { describe, expect, it } from 'vitest';
import type { LevelSpec, Vec2 } from '../src/contracts';
import { LevelSession } from '../src/game/session';
import { FLOOR_SPIRE_MIN_GAP, HOLLOW_GRAVITY, HOLLOW_ORBS, HOLLOW_ROCKS, HOLLOW_SHELTERS, HOLLOW_SPIRES, HOLLOW_SUN, ROUTE_CLEAR, hollow, hollowCeilY, hollowFloorY, hollowRouteY } from '../src/levels/hollow';
import { validateLevel } from '../src/levels/validate';
import { castSolid } from '../src/physics/tags';
import { vPxToM } from '../src/physics/units';
import { frame } from './support/s7Harness';
import { climbToRoute } from './support/hollowClimber';

const inUpZone = (x: number) => HOLLOW_GRAVITY.some((z) => z.g.y < 0 && x >= z.x0 && x <= z.x1);

/** Is a world-px point inside solid terrain? (crossing parity over polygons + the floor / crust polylines) */
function insideTerrain(spec: LevelSpec, p: Vec2): boolean {
  if (p.y >= hollowFloorY(p.x) || p.y <= hollowCeilY(p.x)) return true;
  for (const piece of spec.terrain.pieces) {
    if (piece.kind !== 'polygon') continue;
    let inside = false;
    const pts = piece.points;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i]!;
      const b = pts[j]!;
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

const piecePts = (id: string): readonly Vec2[] => hollow.terrain.pieces.find((p) => p.id === id)!.points;

/** x-extent of a polygon cut by the horizontal line y (null if it misses). */
function spanAt(pts: readonly Vec2[], y: number): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a.y > y === b.y > y) continue;
    const x = a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y);
    lo = Math.min(lo, x);
    hi = Math.max(hi, x);
  }
  return lo <= hi ? [lo, hi] : null;
}

/** y-extent of a polygon cut by the vertical line x (null if it misses). */
function spanAtX(pts: readonly Vec2[], x: number): [number, number] | null {
  const sw = pts.map((v) => ({ x: v.y, y: v.x }));
  return spanAt(sw, x);
}

/** Distance (px) from p to a polygon's outline (inside or out). */
function edgeDist(p: Vec2, pts: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

function insidePoly(p: Vec2, pts: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

function polygonsIntersect(p: readonly Vec2[], q: readonly Vec2[]): boolean {
  if (p.some((v) => insidePoly(v, q)) || q.some((v) => insidePoly(v, p))) return true;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) for (let k = 0, l = q.length - 1; k < q.length; l = k++) if (segmentsCross(p[i]!, p[j]!, q[k]!, q[l]!)) return true;
  return false;
}

/** Pod half-width + 15 px: a resting pod's centre this far off a spire flank. */
const FLANK_OFF = 8 + 15;

/**
 * Resting spots from the actual spire gaps: in every gap between neighbouring spires on
 * the floor (on the crust in the UP zones) — 15 px off each flank (measured at the pod's
 * resting height) and the gap's middle.
 */
function restSpots(): { x: number; onCrust: boolean }[] {
  const out: { x: number; onCrust: boolean }[] = [];
  for (const onCrust of [false, true]) {
    const from = onCrust ? 'ceiling' : 'floor';
    const spans = HOLLOW_SPIRES.filter((sp) => sp.from === from)
      .map((sp) => spanAt(piecePts(sp.id), onCrust ? hollowCeilY(sp.x) + 14 : hollowFloorY(sp.x) - 14))
      .filter((v): v is [number, number] => v !== null)
      .sort((a, b) => a[0] - b[0]);
    const edges: [number, number][] = [];
    let prev = 700 - FLANK_OFF;
    for (const [lo, hi] of [...spans, [15200 + FLANK_OFF, 15200 + FLANK_OFF] as [number, number]]) {
      if (lo > prev) edges.push([prev, lo]);
      prev = Math.max(prev, hi);
    }
    for (const [a, b] of edges) {
      if (b - a < 2 * FLANK_OFF) continue;
      for (const x of new Set([Math.round(a + FLANK_OFF), Math.round((a + b) / 2), Math.round(b - FLANK_OFF)]))
        if (x >= 700 && x <= 15200 && inUpZone(x) === onCrust) out.push({ x, onCrust });
    }
  }
  return out.sort((p, q) => p.x - q.x);
}

async function restingSession(x: number, onCrust: boolean, fuel: 'empty' | 'full'): Promise<LevelSession> {
  const y = onCrust ? hollowCeilY(x) + 14 : hollowFloorY(x) - 14;
  const s = await LevelSession.create({ ...hollow, spawn: { x, y } });
  s.start();
  if (fuel === 'empty') s.vessel.addFuel(-1, 'burn');
  for (let i = 0; i < 120; i++) s.step(frame());
  return s;
}

describe('round 13: The Hollow spire field', () => {
  it('level validates; spires on both surfaces, all along the route, rope 400', () => {
    expect(validateLevel(hollow)).toEqual([]);
    const floor = HOLLOW_SPIRES.filter((sp) => sp.from === 'floor');
    const roof = HOLLOW_SPIRES.filter((sp) => sp.from === 'ceiling');
    expect(floor.length).toBeGreaterThanOrEqual(35);
    expect(roof.length).toBeGreaterThanOrEqual(45);
    // no stretch of the route longer than ~2 steps without a spire
    const xs = HOLLOW_SPIRES.map((sp) => sp.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!, `spire gap at x ${xs[i - 1]}`).toBeLessThan(700);
    // every spire is a solid terrain piece; floor spires rock, roof spires sun-translucent crystal
    for (const sp of HOLLOW_SPIRES) {
      const piece = hollow.terrain.pieces.find((p) => p.id === sp.id);
      expect(piece?.kind, sp.id).toBe('polygon');
      expect(piece?.anchorable ?? true, sp.id).toBe(true);
      expect(piece?.castsShadow ?? true, sp.id).toBe(sp.from === 'floor');
    }
    expect(hollow.physicsOverrides?.['harpoonThrust.ropeRange']).toBe(400);
  });

  it('gates: paired spires (or a stalagmite under a rock hanging from its stalactite) leave a narrow slot; the route itself stays open', () => {
    const gates = HOLLOW_SPIRES.filter((sp) => sp.id.startsWith('gate'));
    expect(gates.length).toBeGreaterThanOrEqual(8);
    const narrow = gates.filter((g) => {
      const mite = HOLLOW_SPIRES.find((sp) => sp.id === `mite${g.id.slice(4)}`);
      if (!mite) return false;
      // the upper jaw at the gate's x: the stalactite's tip, or the underside of the rock it ends in
      const rock = HOLLOW_ROCKS.find((k) => polygonsIntersect(piecePts(g.id), piecePts(k.id)));
      const jaw = rock ? spanAtX(piecePts(rock.id), mite.x)![1] : g.tip;
      return mite.tip - jaw <= 230;
    });
    expect(narrow.length).toBeGreaterThanOrEqual(6);
    // the flight line, every orb and every shelter is open air
    for (let x = 500; x <= 15500; x += 10) expect(insideTerrain(hollow, { x, y: hollowRouteY(x) }), `route at x ${x}`).toBe(false);
    for (const o of HOLLOW_ORBS) expect(insideTerrain(hollow, o as Vec2), o.id).toBe(false);
    for (const p of HOLLOW_SHELTERS) expect(insideTerrain(hollow, p), `shelter ${p.x},${p.y}`).toBe(false);
    // no spire touches a floating rock - except a roof spire that ENDS INSIDE one (the
    // rock hangs from it): its tip well inside the rock outline, nothing of it below the rock
    let hanging = 0;
    for (const sp of HOLLOW_SPIRES)
      for (const k of HOLLOW_ROCKS) {
        const spire = piecePts(sp.id);
        const rock = piecePts(k.id);
        if (!polygonsIntersect(spire, rock)) continue;
        expect(sp.from, `${sp.id} vs rock ${k.id}`).toBe('ceiling');
        const tips = spire.filter((v) => v.y === sp.tip);
        expect(tips.length, sp.id).toBe(2);
        for (const v of tips) {
          expect(insidePoly(v, rock), `${sp.id} tip inside rock ${k.id}`).toBe(true);
          expect(edgeDist(v, rock), `${sp.id} tip depth in rock ${k.id}`).toBeGreaterThanOrEqual(8);
        }
        const rockBottom = Math.max(...rock.map((v) => v.y));
        expect(Math.max(...spire.map((v) => v.y)), `${sp.id} below rock ${k.id}`).toBeLessThan(rockBottom - 8);
        hanging++;
      }
    expect(hanging).toBeGreaterThanOrEqual(3);
  });

  it(`invariants: floor spires >= ${FLOOR_SPIRE_MIN_GAP} px apart; >= ${ROUTE_CLEAR} px open air between the flight line and every spire outline`, () => {
    const xs = HOLLOW_SPIRES.filter((sp) => sp.from === 'floor').map((sp) => sp.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!, `floor spires at ${xs[i - 1]} / ${xs[i]}`).toBeGreaterThanOrEqual(FLOOR_SPIRE_MIN_GAP - 1);
    // measured on the built terrain polygons, independently of the generator's helper
    for (const sp of HOLLOW_SPIRES) {
      const pts = piecePts(sp.id);
      const x0 = Math.min(...pts.map((v) => v.x)) - 120;
      const x1 = Math.max(...pts.map((v) => v.x)) + 120;
      let best = Infinity;
      for (let x = x0; x <= x1; x += 2) {
        const p = { x, y: hollowRouteY(x) };
        best = Math.min(best, insidePoly(p, pts) ? 0 : edgeDist(p, pts));
      }
      expect(best, `${sp.id} clearance to the flight line`).toBeGreaterThanOrEqual(ROUTE_CLEAR - 1);
    }
  });

  it('roof crystal lets the sun through; floor rock still casts a shadow', async () => {
    const s = await LevelSession.create(hollow);
    const ignore = [...s.vessel.parts];
    const rad = s.env.radiation;
    const roof = HOLLOW_SPIRES.filter((sp) => sp.from === 'ceiling');
    const floor = HOLLOW_SPIRES.filter((sp) => sp.from === 'floor');
    let throughCrystal = 0;
    for (const sp of roof) {
      // a point just beyond the spire's middle, seen from the sun
      const mid = { x: sp.x, y: (sp.tip + hollowCeilY(sp.x)) / 2 };
      const d = { x: mid.x - HOLLOW_SUN.x, y: mid.y - HOLLOW_SUN.y };
      const l = Math.hypot(d.x, d.y);
      const beyond = { x: mid.x + (d.x / l) * 400, y: mid.y + (d.y / l) * 400 };
      if (insideTerrain(hollow, beyond)) continue;
      const solid = castSolid(s.physics, vPxToM(HOLLOW_SUN), vPxToM(beyond), ignore); // the spire IS solid
      if (!solid) continue;
      if (rad.lineOfSight(HOLLOW_SUN, beyond, [...ignore, ...s.built.shadowless]) === null) throughCrystal++;
    }
    expect(throughCrystal).toBeGreaterThanOrEqual(5);
    let shaded = 0;
    for (const sp of floor) {
      const d = { x: sp.x - HOLLOW_SUN.x, y: sp.tip + 60 - HOLLOW_SUN.y };
      const l = Math.hypot(d.x, d.y);
      const beyond = { x: sp.x + (d.x / l) * 120, y: sp.tip + 60 + (d.y / l) * 120 };
      if (insideTerrain(hollow, beyond)) continue;
      if (rad.lineOfSight(HOLLOW_SUN, beyond, ignore) !== null) shaded++;
    }
    expect(shaded).toBeGreaterThanOrEqual(5);
    s.destroy();
  });
});

describe('round 13: no floor softlock in The Hollow', () => {
  const spots = restSpots();

  it('there are resting spots all across the cavern', () => {
    expect(spots.length).toBeGreaterThanOrEqual(35);
    for (let x0 = 700; x0 < 15000; x0 += 1500) expect(spots.some((p) => p.x >= x0 && p.x < x0 + 1500), `spots in ${x0}..${x0 + 1500}`).toBe(true);
    expect(spots.some((p) => p.onCrust)).toBe(true);
  });

  it('with an EMPTY tank, the rope alone climbs back to the flight line from every gap', { timeout: 600_000 }, async () => {
    const fails: string[] = [];
    const times: number[] = [];
    let retried = 0;
    for (const { x, onCrust } of spots) {
      // a player who misjudges a line tries another: up to three climbing styles
      // (how much a sideways anchor is worth vs. height), each from the same rest
      const tries: string[] = [];
      for (const lateral of [0.7, 0.3, 1.5]) {
        const s = await restingSession(x, onCrust, 'empty');
        expect(s.state.fuel, `x ${x} tank`).toBeLessThan(0.01);
        const r = climbToRoute(s, 60, undefined, lateral);
        const ok = r.reached && !s.outcome;
        if (!ok) tries.push(`closest ${Math.round(r.closest)} px ${s.outcome ? JSON.stringify(s.outcome) : ''}`);
        s.destroy();
        if (ok) {
          times.push(r.t);
          break;
        }
      }
      if (tries.length === 3) fails.push(`x ${x}${onCrust ? ' (crust)' : ''}: ${tries.join(' / ')}`);
      else if (tries.length > 0) retried++;
    }
    // most spots get out on the first line
    expect(retried, `spots needing a second line`).toBeLessThanOrEqual(Math.ceil(spots.length * 0.1));
    expect(fails, fails.join('\n')).toEqual([]);
    expect(Math.max(...times)).toBeLessThan(60);
  });

  it('with fuel, the pod simply flies back up off the floor', async () => {
    for (const x of [1500, 6100, 8600, 12400]) {
      const s = await restingSession(x, false, 'full');
      const y0 = s.state.pos.y;
      for (let i = 0; i < 120; i++) s.step(frame({ thrust: true }));
      expect(y0 - s.state.pos.y, `x ${x}`).toBeGreaterThan(80);
      expect(s.outcome).toBeNull();
      s.destroy();
    }
  });
});

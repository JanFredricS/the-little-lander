/**
 * Round 17: The Vaults' solid stalactites (src/levels/vaults.ts VAULTS_STALACTITES).
 *
 *  - placement invariants: clear of the god-ray holes, the A pits, the debris
 *    collapses and the chasm lips (VAULTS_LIP_CLEAR); spacing; floor clearance;
 *    sparse + short in A, denser + longer in B; decor drips kept off them;
 *  - they are real terrain: solid, anchorable, and a pendulum swung under one
 *    strikes it;
 *  - rope-only recovery: from floor spots all across both sections (chasms
 *    excepted - a fall there is fatal by design) the rope alone hauls the pod
 *    back up under the roof (test/support/hollowClimber.ts, generalised);
 *  - the reference swing pilot and 11 variants still reach the camp (round 20: the
 *    stalactites grew - A 70-80 -> 120-150 px, two more; B 100-180 -> 150-220 px - so a
 *    checkpoint respawn is allowed, most finish on their first life, and some hit them);
 *  - the caves backdrop's silhouettes read as scenery (dim, small, far back);
 *  - round-17 audit: the winch never drags the pod into a spire it is roped to
 *    (M1: rope-line stall probe + no anchors on the tips), checkpoints through
 *    section B (M2), collapse 2 leaves a rain-free start over chasm 4 (L2), the
 *    lip pegs hold (L3), tipped recovery spawns (L4).
 */

import { describe, expect, it } from 'vitest';
import type { GameEvent, Vec2 } from '../src/contracts';
import { generateBackdrop } from '../src/art/backdrops';
import { LevelSession, type RespawnState } from '../src/game/session';
import { surfaceY } from '../src/levels/kit';
import { s7DistToPolygon } from '../src/levels/s7Helpers';
import { validateLevel } from '../src/levels/validate';
import {
  VAULTS_BRITTLE,
  VAULTS_BRITTLE_SPANS,
  VAULTS_CEILING,
  VAULTS_CHECKPOINTS,
  VAULTS_CHASMS,
  VAULTS_COLLAPSES,
  VAULTS_DRIP_CLEAR,
  VAULTS_GROUND,
  VAULTS_HOLES,
  VAULTS_LIP_CLEAR,
  VAULTS_SECTION_B,
  VAULTS_STALACTITES,
  VAULTS_PEG_TIP_NO_ANCHOR,
  VAULTS_TIP_NO_ANCHOR,
  vaults,
  vaultsStalactitePoints,
  vaultsTipNoAnchor,
} from '../src/levels/vaults';
import { castSolid } from '../src/physics/tags';
import { resolveTuning } from '../src/physics/tuning';
import { vMToPx, vPxToM } from '../src/physics/units';
import { climbToRoute } from './support/hollowClimber';
import { frame, runPilot } from './support/s7Harness';
import { harpoonPilot, type HarpoonPilotOptions } from './support/s7Pilots';

const floorY = (x: number) => surfaceY(VAULTS_GROUND, x);
const roofY = (x: number) => surfaceY(VAULTS_CEILING, x);
const tuning = resolveTuning(vaults.physicsOverrides);
const polys = VAULTS_STALACTITES.map((sp) => ({ sp, pts: vaultsStalactitePoints(sp) }));
const span = (pts: readonly Vec2[]): [number, number] => [Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x))];
const pegs = VAULTS_STALACTITES.filter((sp) => sp.id.startsWith('lipPeg'));
const spikes = VAULTS_STALACTITES.filter((sp) => !sp.id.startsWith('lipPeg'));
const inA = spikes.filter((sp) => sp.x < VAULTS_SECTION_B);
const inB = spikes.filter((sp) => sp.x >= VAULTS_SECTION_B);
/** The A pits (floor dips), from the ground profile. */
const PITS: [number, number][] = [
  [2250, 2550],
  [3950, 4250],
  [5700, 6000],
];
/** Swing line (as test/s7.levels.test.ts): a bit below mid-height. */
const swingY = (x: number) => (Math.min(floorY(x), 700) + roofY(x)) / 2 + 40;
/** Chasm [a, b]: the line `below` px under its higher lip. */
const lipLine = ([a, b]: readonly [number, number]) => Math.min(floorY(a - 40), floorY(b + 40)) + VAULTS_LIP_CLEAR.below;

describe('round 17: The Vaults stalactites - placement', () => {
  it('level validates; solid rock stalactites through both sections, shorter in A, longer in B', () => {
    expect(validateLevel(vaults)).toEqual([]);
    // round 20 (user: "the stalacites are too small and the map still too easy"): A 7 -> 9
    expect(inA.length).toBe(9);
    expect(inB.length).toBe(7);
    // a lip peg on the ledge side of every chasm lip but chasm 1's west one (its ledge
    // reaches the stalactite at 6950 / the lip crystal)
    expect(pegs.length).toBe(7);
    for (const sp of pegs) expect(sp.x).toBeGreaterThan(VAULTS_SECTION_B);
    for (const { sp } of polys) {
      const piece = vaults.terrain.pieces.find((p) => p.id === sp.id);
      expect(piece, sp.id).toBeDefined();
      expect(piece!.kind).toBe('polygon');
      expect(piece!.style.material).toBe('rock');
      expect(sp.from).toBe('ceiling');
    }
    const len = (sp: (typeof VAULTS_STALACTITES)[number]) => sp.tip - roofY(sp.x);
    // round 20: A 70-80 -> 120-150 px, B 100-180 -> 150-220 px
    for (const sp of inA) {
      expect(len(sp), sp.id).toBeGreaterThanOrEqual(115);
      expect(len(sp), sp.id).toBeLessThanOrEqual(155);
    }
    for (const sp of inB) {
      expect(len(sp), sp.id).toBeGreaterThanOrEqual(145);
      expect(len(sp), sp.id).toBeLessThanOrEqual(225);
    }
    expect(Math.max(...inB.map(len))).toBeGreaterThanOrEqual(215);
  });

  it('spacing: in A >= 600 px but for two weaving pairs (230-300 px); in B >= 300 px between stalactites, >= 150 px to a lip peg', () => {
    const all = [...VAULTS_STALACTITES].sort((a, b) => a.x - b.x);
    let pairs = 0;
    for (let i = 1; i < all.length; i++) {
      const [p, q] = [all[i - 1]!, all[i]!];
      if (q.x < VAULTS_SECTION_B && q.x - p.x < 300) pairs++;
      else if (q.x < VAULTS_SECTION_B) expect(q.x - p.x, `${p.id} -> ${q.id}`).toBeGreaterThanOrEqual(600);
      const min = q.x < VAULTS_SECTION_B ? 230 : p.id.startsWith('lipPeg') || q.id.startsWith('lipPeg') ? 150 : 300;
      expect(q.x - p.x, `${p.id} -> ${q.id}`).toBeGreaterThanOrEqual(min);
    }
    expect(pairs).toBe(2);
    expect(spikes.filter((sp) => sp.x >= VAULTS_SECTION_B).every((sp, i, a) => i === 0 || sp.x - a[i - 1]!.x >= 300)).toBe(true);
  });

  it('floor clearance: >= 120 px under every tip in A, >= 100 px in B (round 20: was 170 / 150)', () => {
    for (const { sp, pts } of polys) {
      const [x0, x1] = span(pts);
      const floor = Math.min(floorY(x0), floorY(sp.x), floorY(x1));
      expect(floor - sp.tip, sp.id).toBeGreaterThanOrEqual(sp.x < VAULTS_SECTION_B ? 120 : 100);
    }
  });

  it('A: the swing-school spikes stay above the swing line, low enough that a lazy pendulum clips them; B: the low ones hang within 50 px of it', () => {
    for (const sp of inA) {
      expect(swingY(sp.x) - sp.tip, sp.id).toBeGreaterThan(25);
      expect(swingY(sp.x) - sp.tip, sp.id).toBeLessThan(60); // round 20: was > 80
    }
    const low = inB.filter((sp) => swingY(sp.x) - sp.tip < 50);
    expect(low.length).toBeGreaterThanOrEqual(3);
  });

  it('god-ray holes keep their no-anchor crossing: no stalactite within 250 px of a hole', () => {
    for (const { sp, pts } of polys) {
      const [x0, x1] = span(pts);
      for (const [a, b] of VAULTS_HOLES) expect(Math.max(a - x1, x0 - b), `${sp.id} vs hole ${a}`).toBeGreaterThanOrEqual(250);
    }
  });

  it('off the A pits (their rope-out climbs stay as before) and off the debris collapses', () => {
    for (const { sp, pts } of polys) {
      const [x0, x1] = span(pts);
      for (const [a, b] of PITS) expect(Math.max(a - x1, x0 - b), `${sp.id} vs pit ${a}`).toBeGreaterThanOrEqual(100);
      for (const [a, b] of VAULTS_COLLAPSES) expect(Math.max(a - x1, x0 - b), `${sp.id} vs collapse ${a}`).toBeGreaterThanOrEqual(100);
    }
  });

  it('no rope can hold the pod below lip level over a chasm (the roof never could; no stalactite may)', () => {
    for (const ch of VAULTS_CHASMS) {
      const y = lipLine(ch);
      const line: Vec2[] = [];
      for (let x = ch[0]; x <= ch[1]; x += 10) line.push({ x, y });
      // the roof alone (the pre-round-17 guarantee)
      for (let x = ch[0] - 400; x <= ch[1] + 400; x += 10) {
        const r = { x, y: roofY(x) };
        for (const p of line) expect(Math.hypot(p.x - r.x, p.y - r.y), `roof ${x} vs chasm ${ch[0]}`).toBeGreaterThan(VAULTS_LIP_CLEAR.reach);
      }
      for (const { sp, pts } of polys) for (const v of pts) for (const p of line) expect(Math.hypot(p.x - v.x, p.y - v.y), `${sp.id} vs chasm ${ch[0]}`).toBeGreaterThan(VAULTS_LIP_CLEAR.reach);
    }
    expect(VAULTS_LIP_CLEAR.reach).toBeGreaterThanOrEqual(tuning.harpoon.ropeRange + 10);
  });

  it('decor drips (prop.stalactite) are kept off the solid ones but stay elsewhere', () => {
    const drips = vaults.entities.filter((e) => e.kind === 'staticProp' && e.sprite === 'prop.stalactite');
    expect(drips.length).toBeGreaterThan(20);
    for (const d of drips) for (const sp of VAULTS_STALACTITES) expect(Math.abs(d.x - sp.x), `${d.id} near ${sp.id}`).toBeGreaterThanOrEqual(sp.base / 2 + VAULTS_DRIP_CLEAR);
  });
});

describe('round 17: The Vaults stalactites - physics', () => {
  it('every stalactite is solid and anchorable up its flanks, not on its tip; brittle stalactites crack, lip pegs hold', async () => {
    const s = await LevelSession.create(vaults);
    s.start();
    try {
      for (const sp of VAULTS_STALACTITES) {
        // a slanting shot into the left flank, well above the tip
        const from = { x: sp.x - 120, y: sp.tip + 20 };
        const to = { x: sp.x + 40, y: sp.tip - 100 };
        const hit = castSolid(s.physics, vPxToM(from), vPxToM(to), [...s.vessel.parts]);
        expect(hit, sp.id).not.toBeNull();
        const p = vMToPx(hit!.point);
        expect(s7DistToPolygon(p, vaultsStalactitePoints(sp)), sp.id).toBeLessThan(3);
        expect(p.y, sp.id).toBeLessThan(sp.tip - vaultsTipNoAnchor(sp));
        const a = s.vessel.hooks.anchorAt(hit!.body, p);
        expect(a.ok, sp.id).toBe(true);
        const brittle = VAULTS_BRITTLE_SPANS.some(([x0, x1]) => p.x >= x0 && p.x <= x1);
        expect(a.brittleSec !== undefined, `${sp.id} brittle`).toBe(brittle);
        // straight up into the blunt tip: no purchase (audit M1)
        const tipHit = castSolid(s.physics, vPxToM({ x: sp.x, y: sp.tip + 60 }), vPxToM({ x: sp.x, y: sp.tip - 60 }), [...s.vessel.parts]);
        expect(tipHit, sp.id).not.toBeNull();
        expect(s.vessel.hooks.anchorAt(tipHit!.body, vMToPx(tipHit!.point)).ok, `${sp.id} tip`).toBe(false);
      }
      const brittleAt = (sp: (typeof VAULTS_STALACTITES)[number]) => VAULTS_BRITTLE_SPANS.some(([a, b]) => sp.x > a && sp.x < b);
      expect(spikes.filter(brittleAt).length).toBe(5);
      // audit L3: the pegs at the west lips of chasms 2-4 stand in brittle stretches but hold
      expect(pegs.filter((sp) => VAULTS_BRITTLE.some(([a, b]) => sp.x > a && sp.x < b)).map((sp) => sp.x)).toEqual([8770, 10570, 12070]);
      expect(pegs.filter(brittleAt).length).toBe(0);
      // ... while the roof right beside them still cracks
      for (const sp of pegs.filter((q) => VAULTS_BRITTLE.some(([a, b]) => q.x > a && q.x < b))) {
        const [x0, x1] = span(vaultsStalactitePoints(sp));
        for (const x of [x0 - 10, x1 + 10]) {
          const roof = castSolid(s.physics, vPxToM({ x, y: roofY(x) + 40 }), vPxToM({ x, y: roofY(x) - 20 }), [...s.vessel.parts]);
          expect(s.vessel.hooks.anchorAt(roof!.body, vMToPx(roof!.point)).brittleSec, `roof by ${sp.id} at ${x}`).toBe(1.4);
        }
      }
    } finally {
      s.destroy();
    }
  });

  /** Rest at x (tipped by `angle`), fire at `aim` (or straight up), then hold reel-in for 8 s. */
  async function reelInto(x: number, angle: number, aim: Vec2 | null) {
    const s = await LevelSession.create({ ...vaults, spawn: { x, y: Math.min(floorY(x - 12), floorY(x), floorY(x + 12)) - 12, angle } });
    let crash: GameEvent | null = null;
    s.on((e) => {
      if (e.type === 'crash') crash = e;
    });
    s.start();
    for (let i = 0; i < 120; i++) s.step(frame());
    const p = s.state.pos;
    const d = aim ? { x: aim.x - p.x, y: aim.y - p.y } : { x: 0, y: -1 };
    const l = Math.hypot(d.x, d.y);
    s.step(frame({ aim: { x: d.x / l, y: d.y / l }, fire: true }));
    for (let i = 0; i < 480 && !s.outcome; i++) s.step(frame({ reelIn: true }));
    const out = { crash: crash as GameEvent | null, len: s.state.ropeState?.guns[0]?.length, phase: s.state.ropeState?.guns[0]?.phase, pos: { ...s.state.pos } };
    s.destroy();
    return out;
  }

  it('audit M1: reeling in from beside any stalactite / peg (dx 0, +-45; upright or tipped; aimed up, at the tip, at the low flank) never crashes', { timeout: 600_000 }, async () => {
    const crashes: string[] = [];
    let n = 0;
    for (const sp of VAULTS_STALACTITES)
      for (const dx of [0, 45, -45])
        for (const angle of [0, 1.3, -1.3])
          for (const [aim, target] of [
            ['up', null],
            ['tip', { x: sp.x, y: sp.tip - 4 }],
            ['flank', { x: sp.x, y: sp.tip - 28 }],
          ] as const) {
            const r = await reelInto(sp.x + dx, angle, target);
            n++;
            if (r.crash?.type === 'crash') crashes.push(`${sp.id} dx ${dx} angle ${angle} ${aim}: ${Math.round(r.crash.speed)} px/s at ${Math.round(r.crash.pos.x)},${Math.round(r.crash.pos.y)}`);
          }
    expect(n).toBe(VAULTS_STALACTITES.length * 27);
    // pre-fix: 11/376 (auditor) - e.g. round-17 stalactite14 (x 11720) dx -45 tipped, tip shot: 249 px/s
    expect(crashes).toEqual([]);
  });

  it('audit M1: plain roof unchanged - a straight-up reel still winches the pod all the way up (rope at ropeMin)', async () => {
    for (const x of [600, 1200, 2350, 3400, 5000, 6650, 7100, 13400]) {
      if (VAULTS_STALACTITES.some((sp) => Math.abs(sp.x - x) < 150)) continue;
      const r = await reelInto(x, 0, null);
      expect(r.crash, `x ${x}`).toBeNull();
      expect(r.phase, `x ${x}`).toBe('anchored');
      expect(r.len, `x ${x}`).toBeCloseTo(tuning.harpoon.ropeMin, 0);
      expect(r.pos.y - roofY(r.pos.x), `x ${x}`).toBeLessThan(45);
    }
  });

  it('audit M1: the tipped pod at x 8650 (ropes the brittle flank of the stalactite at 8600, it breaks, re-ropes, reels) recovers', { timeout: 120_000 }, async () => {
    for (const angle of [1.3, -1.3]) {
      const x = 8650;
      const s = await LevelSession.create({ ...vaults, spawn: { x, y: floorY(x) - 12, angle } });
      s.start();
      for (let i = 0; i < 120; i++) s.step(frame());
      const r = climbToRoute(s, 40, undefined, 0.7, { routeY: (px) => roofY(px) + 70, band: 50 });
      expect(s.outcome, `angle ${angle}`).toBeNull();
      expect(r.reached, `angle ${angle}`).toBe(true);
      expect(s.state.hull, `angle ${angle}`).toBeGreaterThan(0.9);
      s.destroy();
    }
  });

  it('a pendulum swung under a stalactite strikes it (a physical hindrance, not scenery)', async () => {
    const sp = VAULTS_STALACTITES.find((q) => q.x === 6950)!;
    const pts = vaultsStalactitePoints(sp);
    const s = await LevelSession.create({ ...vaults, spawn: { x: sp.x - 230, y: sp.tip - 20 } });
    const hits: Vec2[] = [];
    s.on((e) => {
      if (e.type === 'impact') hits.push(e.pos);
    });
    s.start();
    try {
      const anchor = { x: sp.x - 100, y: roofY(sp.x - 100) };
      const d = { x: anchor.x - s.state.pos.x, y: anchor.y - s.state.pos.y };
      const l = Math.hypot(d.x, d.y);
      s.step(frame({ aim: { x: d.x / l, y: d.y / l }, fire: true }));
      for (let i = 0; i < 240 && !s.outcome; i++) s.step(frame());
      expect(s.state.ropeState?.guns[0]?.phase).toBe('anchored');
      expect(hits.some((p) => s7DistToPolygon(p, pts) < 6)).toBe(true);
    } finally {
      s.destroy();
    }
  });
});

describe('round 17: The Vaults - rope-only recovery', () => {
  /** Floor spots every 50 px across both sections, up to the chasm lips (a fall into a chasm is fatal). */
  const spots: number[] = [];
  for (let x = 300; x <= 13350; x += 50) if (!VAULTS_CHASMS.some(([a, b]) => x > a - 20 && x < b + 20)) spots.push(x);

  async function recoverAll(angleAt: (x: number) => number) {
    const fails: string[] = [];
    const times: number[] = [];
    for (const x of spots) {
      const tries: string[] = [];
      const angle = angleAt(x);
      for (const lateral of [0.7, 0.3, 1.5]) {
        const y = Math.min(floorY(x - 12), floorY(x), floorY(x + 12)) - (angle === 0 ? 10 : 12);
        const s = await LevelSession.create({ ...vaults, spawn: { x, y, angle } });
        s.start();
        for (let i = 0; i < 120; i++) s.step(frame());
        // "under the roof": within 20-120 px of it, where every swing starts
        const r = climbToRoute(s, 40, undefined, lateral, { routeY: (px) => roofY(px) + 70, band: 50 });
        const ok = r.reached && !s.outcome;
        if (!ok) tries.push(`closest ${Math.round(r.closest)} px ${s.outcome ? JSON.stringify(s.outcome) : ''}`);
        s.destroy();
        if (ok) {
          times.push(r.t);
          break;
        }
      }
      if (tries.length === 3) fails.push(`x ${x} angle ${angle}: ${tries.join(' / ')}`);
    }
    times.sort((a, b) => a - b);
    return { fails, median: times[Math.floor(times.length / 2)]! };
  }

  it('from every floor spot the rope alone hauls the pod back up under the roof (pre-round-17: 59 B spots could not)', { timeout: 600_000 }, async () => {
    expect(spots.length).toBeGreaterThan(200);
    const r = await recoverAll(() => 0);
    expect(r.fails).toEqual([]);
    expect(r.median).toBeLessThan(10);
  });

  it('audit L4: ... and from a tipped landing (+-1.3 rad, alternating along the grid)', { timeout: 600_000 }, async () => {
    const r = await recoverAll((x) => ((x / 50) % 2 === 0 ? 1.3 : -1.3));
    expect(r.fails).toEqual([]);
    expect(r.median).toBeLessThan(12);
  });
});

describe('round-17 audit M2: The Vaults checkpoints (section B only)', () => {
  const respawnAt = (id: string, hull = 0.8): RespawnState => {
    const c = VAULTS_CHECKPOINTS.find((q) => q.id === id)!;
    return { checkpoint: { id, mode: 'harpoon', spawn: { pos: { ...c.respawn }, angle: 0, vel: { x: 0, y: 0 }, fuel: 1, hull }, resting: true, pickups: [], completed: [] }, planted: [], elapsed: 0 };
  };

  it('five enterRegion checkpoints: B start + past every chasm; none in A; each respawn on a clear, flat ledge', () => {
    expect(validateLevel(vaults)).toEqual([]);
    const cps = vaults.checkpoints!;
    expect(cps.map((c) => [c.id, c.at])).toEqual(['sectionB', 'chasm1', 'chasm2', 'chasm3', 'chasm4'].map((id) => [id, 'enterRegion']));
    expect(cps[0]!.rect!.x).toBeGreaterThanOrEqual(VAULTS_SECTION_B - 60);
    // one past each chasm: its band lies between that chasm's east lip and the next chasm
    VAULTS_CHASMS.forEach(([, b], i) => {
      const r = cps[i + 1]!.rect!;
      expect(r.x, cps[i + 1]!.id).toBeGreaterThanOrEqual(b);
      expect(r.x + r.w, cps[i + 1]!.id).toBeLessThan(VAULTS_CHASMS[i + 1]?.[0] ?? 13700);
      expect([r.y, r.h], cps[i + 1]!.id).toEqual([0, vaults.worldSize.h]);
    });
    for (const c of cps) {
      const p = c.respawn!;
      const r = c.rect!;
      expect(p.x, c.id).toBeGreaterThan(r.x + r.w); // past its own band
      for (const [a, b] of VAULTS_CHASMS) expect(p.x < a - 80 || p.x > b + 60, `${c.id} vs chasm ${a}`).toBe(true);
      // outside the collapse rains (and past their trigger bands: a respawn never sets one off)
      for (const [a, b] of VAULTS_COLLAPSES) expect(p.x < a - 350 || p.x > b + 60, `${c.id} vs collapse ${a}`).toBe(true);
      // not under any hanging rock
      for (const { sp, pts } of polys) {
        const [x0, x1] = span(pts);
        expect(Math.max(x0 - p.x, p.x - x1), `${c.id} vs ${sp.id}`).toBeGreaterThanOrEqual(45);
      }
      // flat floor under it
      expect(Math.abs(floorY(p.x - 15) - floorY(p.x + 15)), c.id).toBeLessThan(3);
      expect(floorY(p.x) - p.y, c.id).toBeGreaterThanOrEqual(7);
      expect(floorY(p.x) - p.y, c.id).toBeLessThan(12);
    }
  });

  it('captured on crossing a band, forward only', async () => {
    const s = await LevelSession.create(vaults);
    s.start();
    try {
      const go = (x: number) => {
        s.physics.setTransform(s.vessel.body, vPxToM({ x, y: floorY(x) - 60 }), 0);
        s.physics.setLinearVelocity(s.vessel.body, { x: 0, y: 0 });
        s.step(frame());
        s.step(frame());
      };
      go(4000);
      expect(s.checkpoint).toBeNull();
      go(VAULTS_CHECKPOINTS[2]!.rect.x + 20);
      expect(s.checkpoint?.id).toBe('chasm2');
      go(VAULTS_CHECKPOINTS[0]!.rect.x + 20); // back west: never moves the respawn back
      expect(s.checkpoint?.id).toBe('chasm2');
    } finally {
      s.destroy();
    }
  });

  it('every respawn rests silently (no thud, no damage) and the run goes on from there; nothing of the roof carries over', async () => {
    for (const c of VAULTS_CHECKPOINTS) {
      const s = await LevelSession.create(vaults, respawnAt(c.id));
      const events: GameEvent[] = [];
      s.on((e) => events.push(e));
      s.start();
      for (let i = 0; i < 180; i++) s.step(frame());
      expect(s.outcome, c.id).toBeNull();
      expect(s.checkpoint?.id, c.id).toBe(c.id);
      expect(s.state.hull, c.id).toBeCloseTo(0.8, 5);
      expect(Math.hypot(s.state.pos.x - c.respawn.x, s.state.pos.y - c.respawn.y), c.id).toBeLessThan(6);
      expect(events.filter((e) => e.type === 'impact' || e.type === 'hullChanged' || e.type === 'crash').length, c.id).toBe(0);
      // a fresh session: brittle anchors are per-rope timers, the roof itself never cracks away
      expect(s.state.ropeState?.guns.every((g) => g.phase === 'idle'), c.id).toBe(true);
      s.destroy();
    }
  });
});

describe('round-17 audit L2: collapse 2 leaves a rain-free start over chasm 4', () => {
  it('like collapse 1 over chasm 2: the west 200 px of the chasm and the ledge stay out of the rain', () => {
    const rains = vaults.entities.filter((e) => e.kind === 'debrisSpawner');
    expect(rains.length).toBe(2);
    for (const [i, ch] of [
      [0, VAULTS_CHASMS[1]!],
      [1, VAULTS_CHASMS[3]!],
    ] as const) {
      const e = rains[i]!;
      if (e.kind !== 'debrisSpawner') throw new Error('kind');
      const free = e.area.x - ch[0];
      expect(free, e.id).toBeGreaterThanOrEqual(200); // rain-free chasm start
      expect(e.area.x + e.area.w, e.id).toBeLessThanOrEqual(ch[1] + 1);
      const act = e.activate;
      expect(act?.kind === 'enterRegion' && act.rect.x + act.rect.w < ch[0], e.id).toBe(true); // triggered on the ledge
      expect(e.durationSec).toBeLessThanOrEqual(12); // can be waited out there
    }
  });

  it('pilots crossing chasm 4 under the live collapse (from checkpoint chasm3) reach the camp', { timeout: 600_000 }, async () => {
    const c = VAULTS_CHECKPOINTS.find((q) => q.id === 'chasm3')!;
    const spawner = vaults.entities.find((e) => e.id === 'collapse2')!;
    const act = spawner.kind === 'debrisSpawner' ? spawner.activate : undefined;
    if (spawner.kind !== 'debrisSpawner' || act?.kind !== 'enterRegion') throw new Error('collapse2');
    const trig = act.rect.x;
    const rows: string[] = [];
    let ok = 0;
    const opts: HarpoonPilotOptions[] = [{}, { switchLen: 120 }, { maxAhead: 180 }, { calmSpeed: 100 }, { minAdvance: 110 }, { minRise: 90 }];
    for (const o of opts) {
      let tTrig = -1;
      let inRain = 0;
      const r = await runPilot({ ...vaults, spawn: { ...c.respawn } }, () => harpoonPilot({ landX: 13480, ...o }), 90, (s) => {
        const x = s.state.pos.x;
        if (tTrig < 0 && x >= trig) tTrig = s.simTime;
        if (tTrig >= 0 && s.simTime - tTrig <= spawner.durationSec! && x >= spawner.area.x && x <= spawner.area.x + spawner.area.w) inRain++;
      });
      const done = r.outcome?.kind === 'complete';
      if (done) ok++;
      rows.push(`${JSON.stringify(o)} ${r.outcome?.kind ?? 'none'} hull ${r.last.hull.toFixed(2)} inRain ${inRain}`);
      // they really crossed under the live rain
      expect(inRain, JSON.stringify(o)).toBeGreaterThan(0);
    }
    expect(ok, rows.join('\n')).toBe(opts.length);
  });
});

describe('round 17: The Vaults - swing playtest over the new geometry', () => {
  const VARIANTS: Record<string, HarpoonPilotOptions> = {
    base: {},
    switch120: { switchLen: 120 },
    ahead180: { maxAhead: 180 },
    ahead280: { maxAhead: 280 },
    calm100: { calmSpeed: 100 },
    calm160: { calmSpeed: 160 },
    adv40: { minAdvance: 40 },
    adv110: { minAdvance: 110 },
    rise40: { minRise: 40 },
    rise90: { minRise: 90 },
    wild170: { wildSpeed: 170 },
    c3: { minAdvance: 90, wildSpeed: 190 },
  };

  it('the reference pilot and 11 variants all reach the camp (round 20: checkpoints allowed); stalactites carry anchors and now take hits', { timeout: 600_000 }, async () => {
    const fails: string[] = [];
    const lossA: number[] = [];
    let firstLife = 0;
    let spikeHits = 0;
    const rows: string[] = [];
    const times: number[] = [];
    const hulls: number[] = [];
    for (const [name, o] of Object.entries(VARIANTS)) {
      let respawn: RespawnState | null = null;
      let done = false;
      let lives = 0;
      let totalSec = 0;
      let finalHull = 0;
      for (; lives < 4 && !done; lives++) {
        const s = await LevelSession.create(vaults, respawn ?? undefined);
        const events: GameEvent[] = [];
        s.on((e) => events.push(e));
        s.start();
        const pilot = harpoonPilot({ landX: 13480, ...o });
        let prev = s.state.hull;
        let a = 0;
        for (let i = 0; i < 240 * 60 && !s.outcome; i++) {
          s.step(pilot(s, i));
          if (s.state.hull < prev - 0.001) {
            if (s.state.pos.x < VAULTS_SECTION_B) a += prev - s.state.hull;
            prev = s.state.hull;
          }
        }
        spikeHits += events.filter((e) => e.type === 'impact' && polys.some(({ pts }) => s7DistToPolygon(e.pos, pts) < 8)).length;
        if (lives === 0) {
          lossA.push(a);
          if (name === 'base') {
            const onSpikes = events.filter((e) => e.type === 'ropeAttached' && polys.some(({ pts }) => s7DistToPolygon(e.anchor, pts) < 4)).length;
            expect(onSpikes, 'base: anchors on stalactites').toBeGreaterThanOrEqual(10);
          }
        }
        done = s.outcome?.kind === 'complete';
        totalSec += s.simTime;
        if (done) finalHull = s.state.hull;
        rows.push(`${name} life ${lives}: ${s.outcome?.kind ?? 'timeout'} x ${Math.round(s.state.pos.x)} hull ${s.state.hull.toFixed(2)} @${s.checkpoint?.id ?? '-'}`);
        if (done && lives === 0) firstLife++;
        respawn = done ? null : s.respawnState();
        s.destroy();
        if (!done && !respawn) break;
      }
      // the round-17 bars, kept: not a scrape-through (hull >= 0.15 at the camp) and not a
      // crawl (<= 200 s, now summed over every life incl. the respawned one). Measured: final
      // hull min 0.51, total time max 119 s
      if (!done || finalHull < 0.15 || totalSec > 200) fails.push(`${name}: hull ${finalHull.toFixed(2)} t ${totalSec.toFixed(0)} ${rows.filter((r) => r.startsWith(name)).join(' / ')}`);
      times.push(totalSec);
      hulls.push(finalHull);
    }
    // round 20 (bigger stalactites, "slightly more challenge"): every variant still
    // reaches the camp, most on their first life (measured 12 / 12, 11 / 12 with stalactite 7 at
    // 150 px - pilot runs are chaotic at this margin; round 17: 12 / 12)
    expect(fails).toEqual([]);
    expect(firstLife, rows.join('\n')).toBeGreaterThanOrEqual(10);
    // ... and the stalactites are now in the way (round 17: no pilot ever struck one)
    expect(spikeHits).toBeGreaterThanOrEqual(3); // measured 5
    // section A stays the swing school: little hull lost there
    lossA.sort((a, b) => a - b);
    expect(lossA[Math.floor(lossA.length / 2)]!).toBeLessThan(0.12);
    // measured median 0.107, max 0.305 (round 20, audit fix; 0.033 / 0.28 with stalactite 7
    // at 150 px): the median bar 0.12 is a deliberate tripwire (round 17 cut A's spikes when
    // pit-lip scrapes pushed it to ~0.13); the max bar has headroom for pilot noise
    expect(Math.max(...lossA)).toBeLessThan(0.35);
  });
});

describe('round 17: the caves backdrop silhouettes read as scenery', () => {
  it('dim (no terrain highlights, no outline), small, slower parallax', () => {
    const layers = generateBackdrop('caves');
    const near = layers.find((l) => l.label.includes('stalactites'))!;
    expect(near).toBeDefined();
    expect(near.parallax).toBeLessThanOrEqual(0.3);
    const used = new Set<number>();
    let filled = 0;
    let longest = 0;
    for (let x = 0; x < near.pix.w; x++) {
      let run = 0;
      for (let y = 0; y < near.pix.h; y++) {
        const c = near.pix.get(x, y);
        used.add(c);
        if (c !== 0) filled++;
        run = c !== 0 ? run + 1 : 0;
        longest = Math.max(longest, run);
      }
    }
    // audit L5: bounds, not an exact palette. Mostly the two deepest rock shades (1-2);
    // the terrain's lit rock shades (3-6) stay out (a sprinkle of accent pixels - the
    // drips - is fine); no outline ring (ramp index 0 is transparent, there is none)
    const lit = [3, 4, 5, 6];
    let deep = 0;
    let bright = 0;
    for (let x = 0; x < near.pix.w; x++)
      for (let y = 0; y < near.pix.h; y++) {
        const c = near.pix.get(x, y);
        if (c === 1 || c === 2) deep++;
        if (lit.includes(c)) bright++;
      }
    // no outline ring: a shape's edge pixels are not (almost) all one shade, as an outline's are
    const edge = new Map<number, number>();
    for (let x = 1; x < near.pix.w - 1; x++)
      for (let y = 1; y < near.pix.h - 1; y++) {
        const c = near.pix.get(x, y);
        if (c === 0 || c === 7) continue;
        if ([near.pix.get(x - 1, y), near.pix.get(x + 1, y), near.pix.get(x, y - 1), near.pix.get(x, y + 1)].includes(0)) edge.set(c, (edge.get(c) ?? 0) + 1);
      }
    const edges = [...edge.values()].sort((m, n) => n - m);
    expect(edges.length).toBeGreaterThanOrEqual(2);
    expect(edges[0]! / edges.reduce((m, n) => m + n, 0)).toBeLessThan(0.98);
    expect(used.has(0)).toBe(true);
    expect(deep / filled).toBeGreaterThan(0.9);
    expect(bright).toBe(0);
    expect(longest).toBeLessThanOrEqual(110);
    expect(filled / (near.pix.w * near.pix.h)).toBeLessThan(0.04);
  });
});

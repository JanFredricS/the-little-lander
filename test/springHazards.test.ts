/**
 * Round 16: the Spring Isles hazards - harmful creatures (a general CreatureEntity `harm`
 * sting), vine curtains (a soft drag the spring legs never stand on) and the crate gate
 * (dynamic crate props a full-ish charge topples), through units and the real LevelSession.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { FIXED_DT, PX_PER_M } from '../src/contracts';
import type { CreatureEntity, GameEvent, InputFrame, LevelSpec, PhysicsApi, VesselState } from '../src/contracts';
import { LevelSession } from '../src/game/session';
import { CREATURE_HIT_COOLDOWN_SEC, CreatureSystem } from '../src/levels/runtime/creatures';
import type { RuntimeHost } from '../src/levels/runtime/types';
import { CRATE, CRATE_ROWS, GATE_CATCH, SKY_BIRD_HARM, SKY_BIRD_KNOCK, SPRING_ISLES_BIRDS, SPRING_ISLES_CHECKPOINTS, SPRING_ISLES_NETS, SPRING_ISLES_CRATES, SPRING_ISLES_CURTAINS, SPRING_ISLES_ROUTE, springIsles, STAND_DY, type RouteStop } from '../src/levels/springIsles';
import { validateLevel } from '../src/levels/validate';
import { PhysicsWorld } from '../src/physics/engine';
import { resolveTuning, type VesselOptions } from '../src/physics/tuning';
import { mToPx, pxToM } from '../src/physics/units';
import { createVessel } from '../src/physics/vessel';
import { springMaxRise, springReach, SPRING_STICK_DEADZONE } from '../src/physics/vessel/spring';
import { emptyFrame } from '../src/shell/input';
import { gateStanding, laneHop, solveHop, springJumper, standingOn, type JumperLog } from './support/springJumper';

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});
const input = (f: Partial<InputFrame>): InputFrame => ({ ...emptyFrame(), ...f });
const stop = (id: string) => SPRING_ISLES_ROUTE.find((s) => s.id === id)!;
const idx = (id: string) => SPRING_ISLES_ROUTE.findIndex((s) => s.id === id);
const tuning = resolveTuning(springIsles.physicsOverrides);
const g = springIsles.gravity.y * tuning.gravity.scale * PX_PER_M;
const stick = (aim: number, power: number): InputFrame => input({ steer: { x: Math.sin(aim), y: -Math.cos(aim) }, steerLength: SPRING_STICK_DEADZONE + power * (1 - SPRING_STICK_DEADZONE) });

async function session(spec: LevelSpec = springIsles, at?: { x: number; y: number }) {
  const s = await LevelSession.create(at ? { ...spec, spawn: at } : spec);
  cleanup.push(() => s.destroy());
  const events: GameEvent[] = [];
  s.on((e) => events.push(e));
  s.start();
  const run = (n: number, f: InputFrame = emptyFrame()) => {
    for (let i = 0; i < n && !s.outcome; i++) s.step(f);
    return s.state;
  };
  return { s, events, run };
}

/** Stand still on route stop `id` (at dx from its centre). */
async function standOn(id: string, dx = 0, spec: LevelSpec = springIsles) {
  const at = stop(id);
  const r = await session(spec, { x: at.cx + dx, y: at.top - STAND_DY - 1 });
  r.run(40);
  return r;
}

/** Jump with the stick (aim, power) and fly until the legs are on the ground again (max ticks). */
function hop(r: Awaited<ReturnType<typeof session>>, aim: number, power: number, max = 300) {
  for (let i = 0; i < 4; i++) r.s.step(stick(aim, power));
  r.s.step(emptyFrame());
  let i = 0;
  for (; i < max && r.s.vessel.springState!().phase === 'air'; i++) r.s.step(emptyFrame());
  return i;
}

// ------------------------------------------------------------------ creatures

describe('harmful creatures (CreatureEntity.harm)', () => {
  const bird = (o: Partial<CreatureEntity> = {}): CreatureEntity => ({ id: 'b', kind: 'creature', species: 'dragonBird', x: 0, y: 0, path: [{ x: -100, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 10 }], speed: 60, harm: 0.15, ...o });
  function rig(entity: CreatureEntity) {
    let t = 0;
    const hurts: { amount: number; kick: { x: number; y: number }; t: number }[] = [];
    const host = {
      physics: {
        get simTime() {
          return t;
        },
      } as unknown as PhysicsApi,
      spec: { entities: [entity] } as unknown as LevelSpec,
      triggerContext: (p: { x: number; y: number }) => ({ simTime: t, vesselPos: p, completed: new Set<string>() }),
      requestModeSwitch: () => {},
      crashVessel: () => {},
      hurtVessel: (amount: number, kick: { x: number; y: number }) => hurts.push({ amount, kick, t }),
    } satisfies RuntimeHost;
    const sys = new CreatureSystem(host);
    const step = (pos: { x: number; y: number }, crashed = false) => {
      t += FIXED_DT;
      sys.afterStep({ pos, crashed } as VesselState);
    };
    return { sys, hurts, step };
  }

  it('stings on contact: `harm` hull and a knock away from it, once per cooldown while it overlaps', () => {
    const r = rig(bird());
    // the vessel hovers on the bird's line, just right of its start
    for (let i = 0; i < 30; i++) r.step({ x: -90, y: 8 });
    expect(r.hurts.length).toBe(1);
    expect(r.hurts[0]!.amount).toBe(0.15);
    // a horizontal swat away from the bird (the vessel is right of it, below its line: still sideways)
    expect(r.hurts[0]!.kick).toEqual({ x: 150, y: 0 });
    const left = rig(bird({ speed: 0 }));
    left.step({ x: -110, y: 4 });
    expect(left.hurts[0]!.kick).toEqual({ x: -150, y: 0 });
    // straight below a still bird: along its facing, never vertical
    const under = rig(bird({ speed: 0 }));
    under.step({ x: -100, y: 20 });
    expect(Math.abs(under.hurts[0]!.kick.x)).toBe(150);
    expect(under.hurts[0]!.kick.y).toBe(0);
    // stays in the way: the next sting only after the cooldown
    const r2 = rig(bird({ speed: 0 }));
    for (let i = 0; i < Math.round((CREATURE_HIT_COOLDOWN_SEC * 2.5) / FIXED_DT); i++) r2.step({ x: -100, y: 5 });
    expect(r2.hurts.length).toBe(3);
    expect(r2.hurts[1]!.t - r2.hurts[0]!.t).toBeGreaterThanOrEqual(CREATURE_HIT_COOLDOWN_SEC - 1e-9);
  });

  it('harmless creatures (no harm), far vessels and a crashed hull are never stung', () => {
    const a = rig(bird({ harm: undefined }));
    for (let i = 0; i < 120; i++) a.step({ x: -100, y: 0 });
    expect(a.hurts).toEqual([]);
    const b = rig(bird());
    for (let i = 0; i < 120; i++) b.step({ x: 0, y: 60 });
    expect(b.hurts).toEqual([]);
    const c = rig(bird());
    for (let i = 0; i < 120; i++) c.step({ x: -100, y: 0 }, true);
    expect(c.hurts).toEqual([]);
  });

  it('the validator: harm in (0, 1), world plane, ambient, with a patrol; hitRadius / knock need harm', () => {
    const spec = (o: Partial<CreatureEntity>): LevelSpec => ({ ...springIsles, entities: [...springIsles.entities, bird({ id: 'tb', x: 700, y: 3000, ...o })] });
    expect(validateLevel(spec({}))).toEqual([]);
    for (const [o, msg] of [
      [{ harm: 1 }, 'harm must be in (0, 1)'],
      [{ harm: 0 }, 'harm must be in (0, 1)'],
      [{ depth: 0.5 }, 'world plane'],
      [{ action: 'seizeCsm' }, 'no action'],
      [{ path: [{ x: 0, y: 0 }] }, 'patrol path'],
      [{ hitRadius: 0 }, 'hitRadius must be positive'],
      [{ knock: -5 }, 'knock must be >= 0'],
      [{ harm: undefined, knock: 100 }, 'need harm'],
    ] as const) {
      expect(validateLevel(spec(o as Partial<CreatureEntity>)).join('\n'), JSON.stringify(o)).toContain(msg);
    }
  });

  it('in a session: a sky-bird crossing a standing hull dents it (reason creature) and knocks it - a sting, not a kill', async () => {
    const b = SPRING_ISLES_BIRDS[0]!;
    // a test ledge right on bird1's loop (its lowest point)
    const low = { x: b.x + b.path[2]!.x, y: b.y + b.path[2]!.y };
    const spec: LevelSpec = {
      ...springIsles,
      terrain: { pieces: [...springIsles.terrain.pieces, { id: 'testLedge', kind: 'polygon', points: [{ x: low.x - 40, y: low.y + 10 }, { x: low.x + 40, y: low.y + 10 }, { x: low.x + 40, y: low.y + 30 }, { x: low.x - 40, y: low.y + 30 }], style: { material: 'soil' } }] },
    };
    const r = await session(spec, { x: low.x, y: low.y + 10 - STAND_DY });
    let kicked = 0;
    for (let i = 0; i < 60 * 8 && !r.s.outcome; i++) {
      const before = r.events.length;
      r.s.step(emptyFrame());
      if (r.events.slice(before).some((e) => e.type === 'hullChanged' && e.reason === 'creature')) kicked = Math.max(kicked, Math.hypot(r.s.state.vel.x, r.s.state.vel.y));
    }
    const stings = r.events.filter((e): e is Extract<GameEvent, { type: 'hullChanged' }> => e.type === 'hullChanged' && e.reason === 'creature');
    expect(stings.length).toBeGreaterThanOrEqual(1);
    expect(stings[0]!.delta).toBeCloseTo(-SKY_BIRD_HARM, 6);
    expect(kicked).toBeGreaterThan(SKY_BIRD_KNOCK * 0.7); // swatted sideways
    expect(r.events.some((e) => e.type === 'crash')).toBe(false);
  });

  it('Spring Isles: 3 world-plane sky-birds, each loop crossing its gap\'s hop lane part of the time (a timing obstacle, no RNG)', () => {
    expect(SPRING_ISLES_BIRDS.length).toBe(3);
    const lanes = [['e1', 'e2'], ['e4', 'e5'], ['e5', 'e6']] as const;
    SPRING_ISLES_BIRDS.forEach((b, i) => {
      expect(b.depth ?? 0).toBe(0);
      expect(b.harm).toBeGreaterThan(0);
      expect(b.harm).toBeLessThan(0.25);
      const [from, to] = lanes[i]!.map(stop);
      const h = solveHop(tuning.spring, g, to!.cx - from!.cx, from!.top - to!.top)!;
      const vx = Math.sin(h.aim) * h.speed;
      const vy = -Math.cos(h.aim) * h.speed;
      const T = Math.abs((to!.cx - from!.cx) / vx);
      // the bird's loop as a periodic function of the launch time
      const pts = b.path.map((p) => ({ x: b.x + p.x, y: b.y + p.y }));
      const len = pts.reduce((a, p, k) => a + Math.hypot(pts[(k + 1) % pts.length]!.x - p.x, pts[(k + 1) % pts.length]!.y - p.y), 0);
      const at = (d: number) => {
        let s = ((d % len) + len) % len;
        for (let k = 0; k < pts.length; k++) {
          const a = pts[k]!;
          const c = pts[(k + 1) % pts.length]!;
          const l = Math.hypot(c.x - a.x, c.y - a.y);
          if (s <= l) return { x: a.x + ((c.x - a.x) * s) / l, y: a.y + ((c.y - a.y) * s) / l };
          s -= l;
        }
        return pts[0]!;
      };
      let blocked = 0;
      const N = 120;
      for (let k = 0; k < N; k++) {
        const d0 = (len * k) / N;
        let hit = false;
        for (let t = 0; t <= T && !hit; t += 1 / 60) {
          const p = at(d0 + b.speed * t);
          const x = from!.cx + vx * t;
          const y = from!.top - STAND_DY + vy * t + (g * t * t) / 2;
          hit = Math.hypot(x - p.x, y - p.y) < (b.hitRadius ?? 0) + 12;
        }
        if (hit) blocked++;
      }
      // in the way for part of every loop, never all of it: wait and go
      expect(blocked / N, b.id).toBeGreaterThan(0.15);
      expect(blocked / N, b.id).toBeLessThan(0.7);
    });
  });
});

describe('a sting is a short setback (audit M1)', () => {
  // the nets are landing spots too: route + nets, each net standing for its rejoin stop
  const nets = [...SPRING_ISLES_NETS, { ...GATE_CATCH, rejoin: 'e6' }];
  const spots: RouteStop[] = [...SPRING_ISLES_ROUTE, ...nets];
  /** Hops from a resting spot back onto route stop `target` (Infinity: nowhere known). */
  const hopsBack = (on: number | null, target: number) => {
    if (on === null) return Infinity;
    if (on < SPRING_ISLES_ROUTE.length) return Math.max(0, target - on);
    return 1 + target - idx(nets[on - SPRING_ISLES_ROUTE.length]!.rejoin);
  };

  it('every net is a safe landing: its rejoin stop is within the 80 % envelope from the net, and no net overhangs a stop', () => {
    for (const n of SPRING_ISLES_NETS) {
      const r = stop(n.rejoin);
      const rise = n.top - r.top;
      const near = Math.max(0, Math.abs(r.cx - n.cx) - n.w / 2);
      expect(rise, n.id).toBeLessThanOrEqual(0.8 * springMaxRise(tuning.spring, g));
      expect(near, n.id).toBeLessThanOrEqual(0.8 * springReach(tuning.spring, g, rise));
      for (const s of SPRING_ISLES_ROUTE) {
        const below = s.top - n.top;
        const overlapX = Math.min(n.cx + n.w / 2 + 9, s.cx + s.w / 2) - Math.max(n.cx - n.w / 2 - 9, s.cx - s.w / 2);
        if (overlapX > 0) expect(below <= 0 || below > springMaxRise(tuning.spring, g) + 40, `${n.id} over ${s.id}`).toBe(true);
      }
    }
  });

  it.each(SPRING_ISLES_BIRDS.map((b, k) => [b.id, k] as const))('%s: 30 launch timings across its loop - every stung hop rests at most 2 hops below its target', async (_id, k) => {
    const b = SPRING_ISLES_BIRDS[k]!;
    const from = idx(['e1', 'e4', 'e5'][k]!);
    const len = b.path.reduce((a, p, i) => {
      const q = b.path[(i + 1) % b.path.length]!;
      return a + Math.hypot(q.x - p.x, q.y - p.y);
    }, 0);
    const period = Math.round((len / b.speed) * 60);
    let stung = 0;
    const bad: string[] = [];
    for (let j = 0; j < 30; j++) {
      const r = await laneHop(springIsles, SPRING_ISLES_ROUTE, from, Math.round((j * period) / 30));
      if (!r.stung) continue;
      stung++;
      const on = standingOn(spots, r.pos);
      if (hopsBack(on, from + 1) > 2) bad.push(`t${j}: (${r.pos.x.toFixed(0)},${r.pos.y.toFixed(0)}) ${on === null ? 'nowhere' : spots[on]!.id}`);
    }
    expect(stung).toBeGreaterThanOrEqual(5); // the timing challenge stays
    expect(bad).toEqual([]);
  }, 60_000);
});

// ------------------------------------------------------------------ vines

describe('vine curtains', () => {
  it('the spring legs never stand on a vine: no touchdown soak, never `landed`, but a hull resting in vines can still charge and hop', async () => {
    const physics = await PhysicsWorld.create({ gravity: { x: 0, y: 12 }, hitSpeedThreshold: 0.5 });
    cleanup.push(() => physics.destroy());
    const mat = physics.createBody({ type: 'static', position: { x: 0, y: pxToM(600) }, tag: 'vine' });
    physics.addBox(mat, pxToM(200), pxToM(4));
    const events: GameEvent[] = [];
    const options: VesselOptions = { tuning: resolveTuning(), refGravity: 12, harpoonGuns: 1 };
    const v = createVessel('spring', physics, { pos: { x: 0, y: 560 } }, (e) => events.push(e), options);
    const tick = (f: InputFrame = emptyFrame()) => {
      v.applyInput(f, FIXED_DT);
      physics.step(FIXED_DT);
      return v.state();
    };
    let landed = false;
    for (let i = 0; i < 120; i++) landed ||= tick().landed;
    expect(landed).toBe(false);
    expect(v.springState!().phase).toBe('ground'); // still + touching: grounded by the wedged rule
    for (let i = 0; i < 40; i++) tick(input({ thrust: true }));
    tick();
    expect(events.some((e) => e.type === 'springJump')).toBe(true);
    expect(tick().vel.y).toBeLessThan(-200);
  });

  it('Spring Isles: the c7 -> d1 hop crosses d2\'s curtain - dragged short (no mid-air soak, no damage); the curtain allowance lands it', async () => {
    const c7 = stop('c7');
    const d1 = stop('d1');
    const noVines: LevelSpec = { ...springIsles, entities: springIsles.entities.filter((e) => e.kind !== 'vine') };
    const plain = solveHop(tuning.spring, g, d1.cx - c7.cx, c7.top - d1.top)!;
    const flight = async (spec: LevelSpec, h: { aim: number; power: number }) => {
      const r = await standOn('c7', 0, spec);
      for (let i = 0; i < 4; i++) r.s.step(stick(h.aim, h.power));
      r.s.step(emptyFrame());
      let vineTicks = 0;
      let soakedInAir = false;
      for (let i = 0; i < 240 && r.s.vessel.springState!().phase === 'air'; i++) {
        r.s.step(emptyFrame());
        const tags = r.s.physics.bodyContacts(r.s.vessel.body).map((c) => r.s.physics.getTag(c.other));
        if (tags.includes('vine')) vineTicks++;
        // a soak (phase ground) while only vines touch would be a mid-air stop
        if (r.s.vessel.springState!().phase !== 'air' && tags.every((t) => t === 'vine')) soakedInAir = true;
      }
      r.run(30);
      return { x: r.s.state.pos.x, y: r.s.state.pos.y, vineTicks, soakedInAir, hull: r.s.state.hull, on: standingOn(SPRING_ISLES_ROUTE, r.s.state.pos) };
    };
    const clear = await flight(noVines, plain);
    const through = await flight(springIsles, plain);
    expect(clear.on).toBe(idx('d1'));
    expect(through.vineTicks).toBeGreaterThan(3);
    expect(through.soakedInAir).toBe(false);
    expect(through.hull).toBe(1);
    // the drag: the same launch lands >= 10 px shorter (or misses d1 altogether)
    expect(through.on !== idx('d1') || clear.x - through.x >= 10, `clear ${clear.x.toFixed(0)} through ${through.x.toFixed(0)}`).toBe(true);
    // charging through with the curtain allowance (aim d1.curtain px past it) lands on d1
    const boosted = solveHop(tuning.spring, g, d1.cx + d1.curtain! - c7.cx, c7.top - d1.top)!;
    expect((await flight(springIsles, boosted)).on).toBe(idx('d1'));
  });

  it('every curtain hangs under its islet across the gap it names, clear of the islets\' landing tops', () => {
    for (const { over, into } of SPRING_ISLES_CURTAINS) {
      const vines = springIsles.entities.filter((e) => e.kind === 'vine' && e.id.startsWith(`vine_${over}_`));
      expect(vines.length).toBeGreaterThanOrEqual(3);
      const prev = SPRING_ISLES_ROUTE[idx(into) - 1]!;
      const to = stop(into);
      for (const v of vines) {
        if (v.kind !== 'vine') continue;
        // between the two islets of the hop, hanging below the islet above
        expect(v.x).toBeGreaterThan(Math.min(prev.cx, to.cx) + Math.min(prev.w, to.w) / 2);
        expect(v.x).toBeLessThan(Math.max(prev.cx, to.cx) - Math.min(prev.w, to.w) / 2);
        expect(v.y).toBeGreaterThan(stop(over).top);
        // its tip reaches below the hop's apex line (the vessel crosses it), above the lower landing top (it never drapes onto a landing)
        expect(v.y + v.length).toBeGreaterThan(Math.min(prev.top, to.top) - 60);
        expect(v.y + v.length).toBeLessThan(Math.max(prev.top, to.top));
      }
    }
  });
});

// ------------------------------------------------------------------ crates

describe('the crate gate', () => {
  const f1 = stop('f1');
  const e6 = stop('e6');
  const colX = SPRING_ISLES_CRATES[0]!.x;
  const colTop = f1.top - CRATE_ROWS * CRATE;

  it('the column top is out of reach from every stop before it, and nothing past the gate is reachable around it', () => {
    const fi = idx('f1');
    const before: RouteStop[] = [...SPRING_ISLES_ROUTE.slice(0, fi), GATE_CATCH];
    for (const a of before) {
      // landing on the column: the hull centre STAND_DY over its top, the nearest a hull edge gets to its near edge
      const rise = a.top - colTop;
      const dx = Math.max(0, Math.abs(colX - a.cx) - CRATE / 2 - 12);
      const reach = springReach(tuning.spring, g, rise);
      expect(reach < 0 || reach < dx, `${a.id}: rise ${rise} dx ${dx} reach ${reach.toFixed(0)}`).toBe(true);
      for (const b of SPRING_ISLES_ROUTE.slice(fi + 1)) {
        const r = springReach(tuning.spring, g, a.top - b.top);
        const near = Math.max(0, Math.abs(b.cx - a.cx) - b.w / 2);
        expect(r < 0 || r < near, `${a.id} -> ${b.id} around the gate`).toBe(true);
      }
    }
  });

  /** Ram from e6 (standing at dx): hop, then rest (30 still ticks on the ground, max 10 s). */
  async function ram(dx: number, aim: number, power: number) {
    const r = await standOn('e6', dx);
    hop(r, aim, power);
    let still = 0;
    for (let i = 0; i < 600 && still < 30 && !r.s.outcome; i++) {
      r.s.step(emptyFrame());
      still = r.s.vessel.springState!().phase === 'ground' && Math.hypot(r.s.state.vel.x, r.s.state.vel.y) < 1 ? still + 1 : 0;
    }
    const p = r.s.state.pos;
    const feet = p.y + STAND_DY;
    // past the gate: resting over f1 (its top or the crate pile on it)
    const onF1 = Math.abs(p.x - f1.cx) <= f1.w / 2 + 18 && feet <= f1.top + 20 && feet >= f1.top - 3 * CRATE;
    const near = (q: RouteStop) => Math.abs(p.x - q.cx) <= q.w / 2 + 18 && Math.abs(feet - q.top) <= 20;
    const standing = gateStanding(r.s, f1);
    const hull = r.s.state.hull;
    const crashed = !!r.s.outcome;
    cleanup.pop()!(); // this session (the sweeps run hundreds: free each one)
    return { standing, onF1, safe: onF1 || near(e6) || near(GATE_CATCH), at: `(${p.x.toFixed(0)},${p.y.toFixed(0)})`, hull, crashed };
  }

  it('the documented ram works from the whole of e6: >= 90 % charge at aim 0.35-0.45 gets past the column from centre and +-30 px; <= 65 % never topples it', async () => {
    const fails: string[] = [];
    for (const dx of [-30, 0, 30]) {
      for (const aim of [0.35, 0.4, 0.45]) {
        for (const power of [0.9, 1]) {
          const r = await ram(dx, aim, power);
          if (r.standing && !r.onF1) fails.push(`dx ${dx} aim ${aim} power ${power}: column stands, hull at ${r.at}`);
        }
        for (const power of [0.5, 0.65]) {
          const r = await ram(dx, aim, power);
          if (!r.standing) fails.push(`dx ${dx} aim ${aim} power ${power}: a weak hop toppled it`);
          expect(r.hull).toBe(1);
        }
      }
    }
    expect(fails).toEqual([]);
  }, 120_000);

  it('whatever the ram (210 launches from anywhere on e6), the hull comes to rest on e6, the catch ledge or f1 - never a long fall', async () => {
    const lost: string[] = [];
    let n = 0;
    for (const dx of [-38, -19, 0, 19, 38]) {
      for (const aim of [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
        for (const power of [0.5, 0.6, 0.7, 0.8, 0.9, 1]) {
          const r = await ram(dx, aim, power);
          n++;
          if (!r.safe || r.crashed) lost.push(`dx ${dx} aim ${aim} power ${power}: ${r.at}`);
        }
      }
    }
    expect(n).toBe(210);
    expect(lost).toEqual([]);
  }, 240_000);

  it('cp_f1 is captured past the column only (its band starts right of the crate column)', () => {
    const cp = SPRING_ISLES_CHECKPOINTS.find((c) => c.id === 'cp_f1')!;
    expect(cp.at).toBe('enterRegion');
    const rect = (cp as { rect: { x: number; w: number } }).rect;
    const colRight = Math.max(...SPRING_ISLES_CRATES.map((c) => c.x + c.w / 2));
    expect(rect.x).toBeGreaterThan(colRight);
    expect(rect.x + rect.w).toBe(f1.cx + f1.w / 2);
    expect(cp.respawn!.x).toBeGreaterThan(rect.x);
  });

  it('ramming is a mid-air collision: the hull stays airborne through the hit and hands its momentum to the crates', async () => {
    const r = await standOn('e6');
    for (let i = 0; i < 4; i++) r.s.step(stick(0.45, 1));
    r.s.step(emptyFrame());
    const crateBodies = SPRING_ISLES_CRATES.map((c) => r.s.built.props.get(c.id)!.body);
    let hitAt = -1;
    let vBefore = 0;
    for (let i = 0; i < 120; i++) {
      const v0 = Math.hypot(r.s.state.vel.x, r.s.state.vel.y);
      r.s.step(emptyFrame());
      const touching = r.s.physics.bodyContacts(r.s.vessel.body).some((c) => crateBodies.includes(c.other));
      if (touching) {
        hitAt = i;
        vBefore = v0;
        break;
      }
    }
    expect(hitAt).toBeGreaterThan(0);
    expect(r.s.vessel.springState!().phase).toBe('air'); // not a touchdown absorb
    r.run(3);
    const crateSpeed = Math.max(...crateBodies.map((b) => Math.hypot(...Object.values(r.s.physics.getLinearVelocity(b))) * PX_PER_M));
    expect(crateSpeed).toBeGreaterThan(100);
    expect(Math.hypot(r.s.state.vel.x, r.s.state.vel.y)).toBeLessThan(vBefore);
  });

  it('no soft-lock among fallen crates: pinned under one, or wedged between two, the hull still charges and hops', async () => {
    const fb = (r: Awaited<ReturnType<typeof standOn>>, id: string) => r.s.built.props.get(id)!.body;
    // under: a crate dropped onto the standing hull
    const under = await standOn('f1', 30);
    const x = under.s.state.pos.x;
    under.s.physics.setTransform(fb(under, 'crate3'), { x: pxToM(x), y: pxToM(under.s.state.pos.y - 40) }, 0);
    under.run(60);
    const yUnder = under.s.state.pos.y;
    under.run(70, input({ thrust: true }));
    under.run(8);
    expect(under.events.some((e) => e.type === 'springJump')).toBe(true);
    expect(yUnder - under.s.state.pos.y).toBeGreaterThan(30);
    // between: two crates either side of the hull
    const between = await standOn('f1', 30);
    const bx = between.s.state.pos.x;
    const by = f1.top - CRATE / 2;
    between.s.physics.setTransform(fb(between, 'crate2'), { x: pxToM(bx - 12 - CRATE / 2 - 1), y: pxToM(by) }, 0);
    between.s.physics.setTransform(fb(between, 'crate3'), { x: pxToM(bx + 12 + CRATE / 2 + 1), y: pxToM(by) }, 0);
    between.run(60);
    const yBetween = between.s.state.pos.y;
    between.run(70, input({ thrust: true }));
    between.run(8);
    expect(between.events.some((e) => e.type === 'springJump')).toBe(true);
    expect(yBetween - between.s.state.pos.y).toBeGreaterThan(30);
  });

  it('whatever way the column falls, the climb goes on: after each topple the jumper gets past f1', async () => {
    const outcomes: string[] = [];
    for (const [aim, power] of [[0.35, 0.8], [0.35, 0.9], [0.35, 1], [0.4, 0.9], [0.45, 0.8], [0.45, 0.9], [0.45, 1], [0.55, 1]] as const) {
      const r = await standOn('e6');
      hop(r, aim, power);
      r.run(90);
      if (gateStanding(r.s, f1)) continue; // this one bounced off: not a topple outcome
      const log: JumperLog = { hops: [], misses: 0 };
      const pilot = springJumper(SPRING_ISLES_ROUTE, log);
      let past = false;
      for (let i = 0; i < 90 * 60 && !past && !r.s.outcome; i++) {
        r.s.step(pilot(r.s, i));
        const on = standingOn(SPRING_ISLES_ROUTE, r.s.state.pos);
        past = on !== null && on > idx('f1') && r.s.vessel.springState!().phase === 'ground';
      }
      outcomes.push(`${aim}/${power}`);
      expect(past, `topple ${aim}/${power}: stuck at (${r.s.state.pos.x.toFixed(0)},${r.s.state.pos.y.toFixed(0)})`).toBe(true);
    }
    expect(outcomes.length).toBeGreaterThanOrEqual(5);
  }, 120_000);

  it('a checkpoint respawn rebuilds the column (a crash after toppling it)', async () => {
    const r = await standOn('e6');
    // capture cp_e6 first (a resting spawn on e6 does not enter the band from outside: walk the jumper on)
    r.s.step(emptyFrame());
    hop(r, 0.45, 1);
    r.run(120);
    expect(gateStanding(r.s, f1)).toBe(false);
    r.s.vessel.crash('impact');
    r.run(2);
    expect(r.s.outcome?.kind).toBe('failed');
    expect(r.s.respawnState()).not.toBeNull();
    const again = await LevelSession.create(springIsles, r.s.respawnState());
    cleanup.push(() => again.destroy());
    again.start();
    again.step(emptyFrame());
    for (const c of SPRING_ISLES_CRATES) {
      const t = again.physics.getTransform(again.built.props.get(c.id)!.body);
      expect(mToPx(t.x)).toBeCloseTo(c.x, 0);
      expect(mToPx(t.y)).toBeCloseTo(c.y, 0);
    }
    expect(gateStanding(again, f1)).toBe(true);
    void e6;
  });
});

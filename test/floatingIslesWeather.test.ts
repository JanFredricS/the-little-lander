/**
 * Round 10 (playtest): floatingIsles weather - the sky ceiling (B), stronger
 * CSM crosswinds (D) and low turbulence (E), all zone data in
 * src/levels/floatingIsles.ts (WEATHER) on the generic windGustSchedule
 * mechanics (src/physics/env/wind.ts). Real LevelSessions, synthetic pilots.
 */

import { describe, expect, it } from 'vitest';
import type { GameEvent, InputFrame, LevelSpec, VesselMode, WindGustSchedule } from '../src/contracts';
import { FIXED_DT } from '../src/contracts';
import { LevelSession } from '../src/game/session';
import { floatingIsles, WEATHER } from '../src/levels/floatingIsles';
import { floatingIslesRoute } from '../src/levels/dev/routes';
import { validateLevel } from '../src/levels/validate';
import { WindSystem, windFade, windNoise } from '../src/physics/env/wind';
import { pilotFor } from './support/storyPilots';
import { levelReferenceGravity, resolveTuning } from '../src/physics/tuning';
import { mToPx } from '../src/physics/units';
import { emptyFrame } from '../src/shell/input';

/** floatingIsles without the dragon / mode switch, spawned where the test needs it. */
function isles(mode: VesselMode, x: number, y: number, over: Partial<LevelSpec> = {}): LevelSpec {
  const { modeSwitch: _m, ...rest } = floatingIsles;
  return { ...rest, vesselMode: mode, spawn: { x, y }, entities: floatingIsles.entities.filter((e) => e.id !== 'dragon'), ...over };
}

async function fly(spec: LevelSpec, pilot: (s: LevelSession) => InputFrame, seconds: number) {
  const s = await LevelSession.create(spec);
  const events: GameEvent[] = [];
  s.on((e) => events.push(e));
  s.start();
  const track: { t: number; x: number; y: number; vx: number; vy: number; wx: number; wy: number }[] = [];
  for (let i = 0; i < Math.round(seconds / FIXED_DT) && !s.outcome; i++) {
    s.step(pilot(s));
    track.push({ t: s.simTime, x: s.state.pos.x, y: s.state.pos.y, vx: s.state.vel.x, vy: s.state.vel.y, wx: s.env.windAccel.x, wy: s.env.windAccel.y });
  }
  return { s, events, track };
}

/** The round 10 weather zones (sky ceiling, low turbulence): the reference route must never feel them. */
const WEATHER_ZONE = /^(sky|lowTurbulence)/;
const LOW_IDS = ['lowTurbulence', 'lowTurbulenceI8', 'lowTurbulenceE'];
const only = (...ids: string[]) => floatingIsles.zones.filter((z) => ids.includes(z.id));
const gustEvents = (events: GameEvent[], id: string) =>
  events.filter((e): e is Extract<GameEvent, { type: 'windGust' }> => e.type === 'windGust' && e.zoneId === id);

const fullThrust = (s: LevelSession): InputFrame => (s.state.mode === 'lander' ? { ...emptyFrame(), engineLeft: true, engineRight: true } : { ...emptyFrame(), thrust: true });
const zone = (id: string) => floatingIsles.zones.find((z) => z.id === id) as WindGustSchedule;

describe('floatingIsles weather: data', () => {
  it('validates; the new zones are thrust-relative, faded and telegraphed locally; other zones / levels untouched', () => {
    expect(validateLevel(floatingIsles)).toEqual([]);
    for (const id of ['skyCsm', 'skyLander', ...LOW_IDS, 'csmCross']) {
      expect(zone(id).unit, id).toBe('vesselThrust');
      expect(zone(id).local, id).toBe(true);
    }
    for (const id of LOW_IDS) expect(zone(id).turbulence, id).toBeDefined();
    // the lander stretch gusts keep their m/s² numbers (their telegraph went local; they stop at the turbulence)
    expect(zone('windB').gusts.map((g) => g.accel.x)).toEqual([2.2, -2.2]);
    expect(zone('windB').unit).toBeUndefined();
    for (const id of ['windA', 'windB', 'windC', 'windD', 'csmCross']) expect(zone(id).rect!.y + zone(id).rect!.h, id).toBe(WEATHER.turbulence.calmY);
  });

  it('audit: every sideways schedule that can carry a drifting craft is zero-mean per cycle and speed-capped', () => {
    for (const id of [...LOW_IDS, 'csmCross']) {
      const z = zone(id);
      const net = z.gusts.reduce((a, g) => a + g.accel.x * g.durationSec, 0);
      expect(net, id).toBeCloseTo(0, 9);
      expect(z.speedCap, id).toBeGreaterThan(0);
    }
    // the turbulence: each 5 s half on its own too (the mirrored second half is a second safety)
    for (const id of LOW_IDS) {
      const half = zone(id).gusts.filter((g) => g.atSec < 5);
      expect(half.reduce((a, g) => a + g.accel.x * g.durationSec, 0), id).toBeCloseTo(0, 9);
    }
    // the wind alone never carries a craft into terrain above the damage speeds (with margin)
    const t = resolveTuning(floatingIsles.physicsOverrides);
    expect(Math.SQRT2 * WEATHER.turbulence.speedCap).toBeLessThan(0.9 * Math.min(t.lander.damageSpeed, t.csm.damageSpeed));
    expect(WEATHER.sky.speedCap).toBeLessThan(0.9 * Math.min(t.lander.damageSpeed, t.csm.damageSpeed));
  });

  it('audit: no calm lane - the sky reaches below the high CSM-stretch island tops, the turbulence above / up to the undersides', () => {
    const csmPieces = floatingIsles.terrain.pieces.filter((p) => p.points.every((q) => q.x < WEATHER.sky.csm.x1));
    const tops = csmPieces.map((p) => Math.min(...p.points.map((q) => q.y)));
    // above the highest tops but i4's: a craft skimming them (centre >= 15 px up) is at >= half force
    const skim = Math.min(...tops.filter((y) => y > 800)) - 15;
    expect(windFade(zone('skyCsm'), skim)).toBeGreaterThanOrEqual(0.5);
    // a crawl under every CSM-stretch underside (a straight lane, centre >= 20 px under the deepest, i8's)
    // is in real turbulence all the way: >= 30% force everywhere (i8 has its own carved band)
    const deepest = Math.max(...csmPieces.map((p) => Math.max(...p.points.map((q) => q.y))));
    expect(deepest).toBeGreaterThan(2330); // i8
    const low = only(...LOW_IDS) as WindGustSchedule[];
    for (let x = 0; x < WEATHER.sky.csm.x1; x += 25) {
      const z = low.find((q) => x >= q.rect!.x && x < q.rect!.x + q.rect!.w)!;
      for (const y of [deepest + 20, deepest + 100, 2900]) expect(windFade(z, y), `${x},${y}`).toBeGreaterThanOrEqual(0.3);
    }
  });

  it('B: a strong sky gust beats the engines outright - even with the brake assist and without gravity\'s help', () => {
    const t = resolveTuning(floatingIsles.physicsOverrides);
    const g = levelReferenceGravity(floatingIsles, t);
    for (const [thrust, boost] of [
      [t.csm.thrust * g, t.csm.brakeBoost],
      [2 * t.lander.thrust * g, t.lander.brakeBoost],
    ] as const) {
      expect(WEATHER.sky.strong * thrust).toBeGreaterThan(thrust); // stronger than max thrust
      expect(WEATHER.sky.strong * thrust + g).toBeGreaterThan(boost * thrust); // net down even braking a fall
      expect(WEATHER.sky.moderate * thrust + g).toBeGreaterThan(thrust); // the moderate one: no hovering up there either
    }
  });
});

describe('floatingIsles weather: thrust units', () => {
  it('audit: maxThrustAccel is what the engines really give (lander: BOTH engines = 2 x per-engine thrust; CSM: one)', async () => {
    // measured in open air from rest (no brake boost at rest), no wind: thrust = free-fall dv - burning dv
    const dv = async (mode: VesselMode, burn: boolean) => {
      const s = await LevelSession.create(isles(mode, 3350, 1500, { zones: [] }));
      s.start();
      const f = burn ? (mode === 'lander' ? { ...emptyFrame(), engineLeft: true, engineRight: true } : { ...emptyFrame(), thrust: true }) : emptyFrame();
      s.step(f);
      return { dvy: s.state.vel.y, s };
    };
    for (const mode of ['lander', 'csm'] as const) {
      const free = await dv(mode, false);
      const burn = await dv(mode, true);
      const measured = (free.dvy - burn.dvy) / FIXED_DT; // px/s²
      expect(measured, mode).toBeCloseTo(mToPx(burn.s.env.maxThrustAccel(mode)), 0);
    }
    const t = resolveTuning(floatingIsles.physicsOverrides);
    const s = await LevelSession.create(isles('lander', 3350, 1500, { zones: [] }));
    expect(s.env.maxThrustAccel('lander')).toBeCloseTo(2 * t.lander.thrust * levelReferenceGravity(floatingIsles, t), 9);
  });
});

describe('floatingIsles weather: B sky ceiling', () => {
  it('CSM at full upward thrust above the CSM-stretch ceiling is forced back down, unharmed', async () => {
    const { s, track, events } = await fly(isles('csm', 2000, 450, { zones: only('skyCsm') }), fullThrust, 21);
    expect(s.outcome).toBeNull();
    expect(s.state.hull).toBe(1);
    expect(events.some((e) => e.type === 'hullChanged')).toBe(false);
    // during each strong gust it sinks while burning flat out ...
    const strong = track.filter((p) => p.wy > 0 && (p.t % 7) > 3 && (p.t % 7) < 5);
    expect(strong.length).toBeGreaterThan(60);
    expect(strong.filter((p) => p.vy > 0).length / strong.length).toBeGreaterThan(0.6);
    // ... carried down at <= speedCap, it settles below the full-force line, never above the world
    const last = track.filter((p) => p.t > 16);
    expect(last.reduce((a, p) => a + p.y, 0) / last.length).toBeGreaterThan(WEATHER.sky.csm.fullY);
    expect(Math.min(...track.map((p) => p.y))).toBeGreaterThan(0);
    // only the strong gust telegraphs (once per 7 s cycle); the moderate ones are silent background force
    const sky = gustEvents(events, 'skyCsm');
    expect(sky.map((e) => e.phase).slice(0, 6)).toEqual(['warning', 'start', 'end', 'warning', 'start', 'end']);
    expect(sky.every((e) => e.accel.y === WEATHER.sky.strong * s.env.maxThrustAccel('csm'))).toBe(true);
  });

  it('lander at full thrust above the lander-stretch ceiling is forced down too', async () => {
    const { s, track } = await fly(isles('lander', 9000, 650, { zones: only('skyLander') }), fullThrust, 14);
    expect(s.outcome).toBeNull();
    expect(s.state.hull).toBe(1);
    expect(s.state.pos.y).toBeGreaterThan(WEATHER.sky.lander.fullY);
    const strong = track.filter((p) => p.wy > 0 && (p.t % 7) > 3 && (p.t % 7) < 5);
    expect(strong.filter((p) => p.vy > 0).length / strong.length).toBeGreaterThan(0.6);
  });

  it('gust strength comes from the vessel tuning: retuned thrust, same ratio', async () => {
    for (const thrust of [2.4, 3.2]) {
      const spec = isles('csm', 3000, 300, { physicsOverrides: { ...floatingIsles.physicsOverrides, 'csm.thrust': thrust } });
      const s = await LevelSession.create(spec);
      const g = levelReferenceGravity(spec, s.tuning);
      expect(s.env.maxThrustAccel('csm')).toBeCloseTo(thrust * g, 6);
      const wind = new WindSystem(only('skyCsm'), () => {}, s.tuning.gravity.scale);
      // t 2..5 s of each 7 s cycle: the strong gust, above the full-force line, hovering
      const a = wind.update(2.5, { x: 3000, y: 300 }, s.env.maxThrustAccel('csm'));
      expect(a.y).toBeCloseTo(WEATHER.sky.strong * thrust * g, 6);
      expect(wind.update(6, { x: 3000, y: 300 }, s.env.maxThrustAccel('csm')).y).toBeCloseTo(WEATHER.sky.moderate * thrust * g, 6);
      // already sinking at the cap: it stops pushing (carried down, not smashed)
      expect(wind.update(2.6, { x: 3000, y: 300 }, s.env.maxThrustAccel('csm'), { x: 0, y: WEATHER.sky.speedCap }).y).toBe(0);
    }
  });

  it('ramps in over the band (no hard line) and is calm below it', () => {
    const z = zone('skyCsm');
    const { calmY, fullY } = WEATHER.sky.csm;
    expect(windFade(z, calmY + 1)).toBe(0);
    expect(windFade(z, (calmY + fullY) / 2)).toBeCloseTo(0.5, 6);
    expect(windFade(z, fullY - 1)).toBe(1);
  });

  it('audit: an over-the-top cruise cannot hold altitude - a CSM fighting to stay at y 880 is forced down during every strong gust', async () => {
    for (const x of [3500, 5800]) {
      const ty = 880;
      const { s, track } = await fly(
        isles('csm', x, ty, { zones: only('skyCsm') }),
        (q) => ({ ...emptyFrame(), thrust: q.state.pos.y - ty + 0.5 * q.state.vel.y > 0 && Math.abs(q.state.angle) < 0.5 }),
        14,
      );
      expect(s.outcome).toBeNull();
      expect(track.every((p) => p.wy > 0)).toBe(true); // never calm up there
      expect(Math.max(...track.map((p) => p.y))).toBeGreaterThan(ty + 20); // pushed down below the island tops
    }
  });
});

describe('floatingIsles weather: telegraph (audit: only when force is imminent, at most once per gust)', () => {
  const { calmY, fullY, margin } = WEATHER.sky.csm;

  it('heard from the CALM side of the band: within the margin below the calm line yes, beyond it no', () => {
    const run = (y: number) => {
      const ev: GameEvent[] = [];
      const w = new WindSystem(only('skyCsm'), (e) => ev.push(e));
      for (let t = 0; t < 7; t += 1 / 60) w.update(t, { x: 3000, y }, 10);
      return gustEvents(ev, 'skyCsm').map((e) => e.phase);
    };
    expect(run(calmY + margin - 5)).toEqual(['warning', 'start', 'end']);
    expect(run(calmY + margin + 5)).toEqual([]);
    expect(run((calmY + fullY) / 2)).toEqual(['warning', 'start', 'end']);
  });

  it('a gust instance heard once runs warning -> start -> end even if the vessel leaves; bobbing across the margin never re-telegraphs it', () => {
    const ev: GameEvent[] = [];
    const w = new WindSystem(only('skyCsm'), (e) => ev.push(e));
    const near = { x: 3000, y: calmY + margin - 5 };
    const away = { x: 3000, y: calmY + margin + 30 };
    // heard during the warning (t 0.5-2), gone before the gust starts: still closed by an 'end'
    for (let t = 0; t < 1; t += 1 / 60) w.update(t, near, 10);
    for (let t = 1; t < 7; t += 1 / 60) w.update(t, away, 10);
    expect(gustEvents(ev, 'skyCsm').map((e) => e.phase)).toEqual(['warning', 'start', 'end']);
    // 3 cycles bobbing across the margin line every 0.25 s: one telegraph per strong gust
    ev.length = 0;
    let k = 0;
    for (let t = 7; t < 28; t += 1 / 60) w.update(t, Math.floor(t * 4) % 2 ? near : away, 10), k++;
    const phases = gustEvents(ev, 'skyCsm').map((e) => e.phase);
    expect(phases.filter((p) => p === 'warning')).toHaveLength(3);
    expect(phases.filter((p) => p === 'start')).toHaveLength(3);
    expect(phases.filter((p) => p === 'end')).toHaveLength(3);
    expect(k).toBeGreaterThan(1000);
  });

  it('silent gusts push but never telegraph (no events, no streaks)', () => {
    const ev: GameEvent[] = [];
    const w = new WindSystem(only('skyCsm'), (e) => ev.push(e));
    const a = w.update(0.2, { x: 3000, y: fullY - 50 }, 10); // the first moderate gust (before the strong one's warning)
    expect(a.y).toBeCloseTo(WEATHER.sky.moderate * 10, 9);
    expect(ev).toEqual([]);
    expect(w.active.filter((g) => g.phase === 'active')).toEqual([]);
  });
});

describe('floatingIsles weather: the reference flight', () => {
  it('audit: the real route pilot completes the level and never feels (or hears) the sky / turbulence weather', { timeout: 60_000 }, async () => {
    const s = await LevelSession.create(floatingIsles);
    const events: GameEvent[] = [];
    s.on((e) => events.push(e));
    s.start();
    const pilot = pilotFor('floatingIsles');
    const weather = new WindSystem(floatingIsles.zones.filter((z) => WEATHER_ZONE.test(z.id)), () => {}, s.tuning.gravity.scale);
    let maxForce = 0;
    for (let i = 0; i < 400 / FIXED_DT && !s.outcome; i++) {
      s.step(pilot(s, i));
      const a = weather.update(s.simTime, s.state.pos, s.env.maxThrustAccel(s.state.mode), s.state.vel);
      maxForce = Math.max(maxForce, Math.hypot(a.x, a.y));
    }
    expect(s.outcome?.kind).toBe('complete');
    expect(maxForce).toBe(0);
    expect(events.filter((e) => e.type === 'windGust' && WEATHER_ZONE.test(e.zoneId))).toEqual([]);
  });
});

describe('floatingIsles weather: the intended corridor stays calm', () => {
  it('no sky / turbulence force anywhere between the ceiling and the turbulence band, nor along the reference route', () => {
    const ids = new Set(['skyCsm', 'skyLander', 'lowTurbulence']);
    const wind = new WindSystem(
      floatingIsles.zones.filter((z) => ids.has(z.id)),
      () => {},
    );
    const pts = floatingIslesRoute.map((n) => ({ x: n.x, y: n.y }));
    for (let x = 100; x < 18000; x += 700) {
      const top = x < WEATHER.sky.csm.x1 ? WEATHER.sky.csm.calmY : WEATHER.sky.lander.calmY;
      for (let y = top + 1; y < WEATHER.turbulence.calmY; y += 97) pts.push({ x, y });
    }
    for (let t = 0; t < 14; t += 0.05) {
      for (const p of pts) {
        const a = wind.update(t, p, 10);
        expect(a, `${t.toFixed(2)} @ ${p.x},${p.y}`).toEqual({ x: 0, y: 0 });
      }
    }
  });
});

describe('floatingIsles weather: E low turbulence', () => {
  /** Wants to skim the floor at y 2,750: burns only to stop a fall. */
  const hugger = (s: LevelSession): InputFrame => {
    const burn = s.state.vel.y > 60 || (s.state.pos.y > 2750 && s.state.vel.y > -20);
    return { ...emptyFrame(), engineLeft: burn, engineRight: burn };
  };

  it('a lander hugging the floor is thrown up out of the turbulence core, irregularly, unharmed', async () => {
    const { s, track } = await fly(isles('lander', 12000, 2700), hugger, 30);
    expect(s.outcome).toBeNull();
    expect(s.state.hull).toBe(1);
    const later = track.filter((p) => p.t > 15);
    // thrown up above the full-force line, and kept out of it
    expect(Math.min(...later.map((p) => p.y))).toBeLessThan(WEATHER.turbulence.fullY);
    expect(later.filter((p) => p.y > WEATHER.turbulence.fullY).length / later.length).toBeLessThan(0.25);
    // not a clean bounce: the shove's sideways part swings both ways, its size varies
    const shoves = track.filter((p) => p.wy < 0);
    expect(shoves.some((p) => p.wx > 0.3)).toBe(true);
    expect(shoves.some((p) => p.wx < -0.3)).toBe(true);
    const ups = shoves.map((p) => -p.wy);
    expect(Math.max(...ups) / Math.min(...ups.filter((u) => u > 1))).toBeGreaterThan(1.5);
  });

  it('audit: a long passive drift in the band stays bounded - |vel.x| <= the cap, no outOfBounds, no hull damage', { timeout: 60_000 }, async () => {
    const cap = WEATHER.turbulence.speedCap;
    for (const [mode, x] of [['lander', 600], ['lander', 17000], ['csm', 3000], ['csm', 5800], ['lander', 12000]] as const) {
      const { s, track, events } = await fly(isles(mode, x, 2600), () => emptyFrame(), 180);
      expect(s.outcome, `${mode} @ ${x}`).toBeNull();
      expect(events.some((e) => e.type === 'hullChanged'), `${mode} @ ${x}`).toBe(false);
      const after = track.filter((p) => p.t > 1);
      expect(Math.max(...after.map((p) => Math.abs(p.vx))), `${mode} @ ${x}`).toBeLessThanOrEqual(cap + 1);
      expect(Math.max(...after.map((p) => Math.abs(p.x - x))), `${mode} @ ${x}`).toBeLessThan(1500);
    }
  });

  it('audit: under i8 a pilot climbing on purpose meets the underside slower than the damage speed (the wind adds no speed past its cap)', { timeout: 60_000 }, async () => {
    for (const mode of ['lander', 'csm'] as const) {
      const climb = (q: LevelSession): InputFrame => {
        const b = q.state.vel.y > -30 && Math.abs(q.state.angle) < 0.25;
        return q.state.mode === 'lander' ? { ...emptyFrame(), engineLeft: b, engineRight: b } : { ...emptyFrame(), thrust: b };
      };
      const { s, track, events } = await fly(isles(mode, 4900, 2600), climb, 30);
      expect(s.outcome, mode).toBeNull();
      expect(events.some((e) => e.type === 'hullChanged'), mode).toBe(false);
      // pressed up to i8's underside (~2,338: the centre within the hull's half-height of it)
      expect(Math.min(...track.map((p) => p.y)), mode).toBeLessThan(2338 + 25);
      const up = Math.max(...track.map((p) => -p.vy));
      expect(up, mode).toBeLessThan(WEATHER.turbulence.speedCap + 5);
    }
  });

  it('is deterministic (same flight, same shoves)', async () => {
    const a = await fly(isles('lander', 12000, 2700), hugger, 6);
    const b = await fly(isles('lander', 12000, 2700), hugger, 6);
    expect(b.track).toEqual(a.track);
    expect(windNoise(3.25, 7)).toBe(windNoise(3.25, 7));
    expect(windNoise(3.25, 7)).not.toBe(windNoise(3.25, 8));
    // within one shove the strength and sideways kick wander (not a flat push)
    const wind = new WindSystem([zone('lowTurbulenceE')], () => {});
    const ys: number[] = [];
    const xs: number[] = [];
    for (let t = 1.3; t < 3.3; t += 0.05) {
      const w = wind.update(t, { x: 12000, y: 2900 }, 10);
      ys.push(-w.y);
      xs.push(w.x);
    }
    expect(Math.max(...ys) / Math.min(...ys)).toBeGreaterThan(1.3);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(2);
  });

  it('the CSM gets thrown up too', async () => {
    const { s, track } = await fly(isles('csm', 3200, 2700), (q) => ({ ...emptyFrame(), thrust: q.state.vel.y > 60 }), 12);
    expect(s.outcome).toBeNull();
    expect(Math.min(...track.filter((p) => p.t > 3).map((p) => p.y))).toBeLessThan(WEATHER.turbulence.fullY);
  });
});

describe('floatingIsles weather: D CSM crosswinds', () => {
  it('the strong gust is the set fraction of the CSM\'s max engine acceleration, telegraphed first; none of it reaches the lander stretch', async () => {
    const { s, track, events } = await fly(isles('csm', 2000, 1000), () => ({ ...emptyFrame(), thrust: true }), 12);
    const maxA = s.env.maxThrustAccel('csm');
    // its strength at rest (the cap only fades it once the craft moves with it)
    const w = new WindSystem(only('csmCross'), () => {}, s.tuning.gravity.scale);
    expect(w.update(10, { x: 2000, y: 1000 }, maxA).x).toBeCloseTo(-WEATHER.csmGusts.strong * maxA, 9);
    expect(w.update(10, { x: 2000, y: 1000 }, maxA, { x: -WEATHER.csmGusts.speedCap, y: 0 }).x).toBe(0);
    expect(WEATHER.csmGusts.strong).toBeGreaterThanOrEqual(0.6);
    expect(WEATHER.csmGusts.strong).toBeLessThanOrEqual(0.8);
    // in flight: the gust pushes left, never beyond the cap
    const strong = track.filter((p) => p.t > 9.55 && p.t < 11.4);
    expect(strong.length).toBeGreaterThan(30);
    expect(strong.every((p) => p.wx < 0 || p.wx === 0)).toBe(true);
    expect(strong.some((p) => p.wx < -0.9 * WEATHER.csmGusts.strong * maxA)).toBe(true);
    // felt: well beyond the old lander gusts (3 m/s² designed)
    expect(mToPx(WEATHER.csmGusts.strong * maxA)).toBeGreaterThan(mToPx(3 * s.tuning.gravity.scale) * 3);
    const cross = gustEvents(events, 'csmCross').map((e) => e.phase);
    expect(cross.slice(0, 6)).toEqual(['warning', 'start', 'end', 'warning', 'start', 'end']);
    // the lander stretch never hears it (local telegraph)
    const far = await fly(isles('lander', 9000, 1300), () => emptyFrame(), 12);
    expect(far.events.some((e) => e.type === 'windGust' && e.zoneId === 'csmCross')).toBe(false);
  });
});

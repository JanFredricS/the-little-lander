/**
 * Round 19 (user: "reduce side winds - with a gradual increase later in the map"): the
 * sideways gusts in The Floating Isles are scaled by the vessel's world x (WindGustSchedule.xRamp,
 * WEATHER.sideRamp). The CSM crosswinds run at 0.45 -> 0.6 of their designed strength; on the
 * lander stretch one continuous felt curve (audit L2: no step at the zone boundaries) climbs from
 * 0.9 m/s² at x 8,000 to the full 3 m/s² at x 14,580; beacon 5's shaft and the outpost (windC2,
 * windD) are exactly as before. The vertical forces (sky ceiling, low turbulence) are untouched.
 */
import { describe, expect, it } from 'vitest';
import type { GameEvent, LevelSpec, WindGustSchedule } from '../src/contracts';
import { LevelSession, type RespawnState } from '../src/game/session';
import { BEACON_CHECKPOINTS, floatingIsles, WEATHER } from '../src/levels/floatingIsles';
import { floatingIslesRoute as R } from '../src/levels/dev/routes';
import { Autopilot } from '../src/levels/dev/autopilot';
import { validateLevel } from '../src/levels/validate';
import { WindSystem, windXRamp } from '../src/physics/env/wind';
import { emptyFrame } from '../src/shell/input';
import { SloppyPilot } from './support/sloppyPilot';

const RAMPED = ['csmCross', 'windA', 'windB', 'windC'];
const LANDER = ['windA', 'windB', 'windC', 'windC2', 'windD'];
const gusts = floatingIsles.zones.filter((z): z is WindGustSchedule => z.kind === 'windGustSchedule');
const zone = (id: string) => gusts.find((z) => z.id === id)!;
const landX = R.filter((n) => n.land).map((n) => n.x);
/** Designed peak |x| m/s² of a zone's gusts. */
const peakOf = (z: WindGustSchedule) => Math.max(...z.gusts.map((g) => Math.abs(g.accel.x)));
/** The felt peak side gust (designed m/s²) in lander zone `id` at world x, ramped / as before round 19. */
const felt = (id: string, x: number) => peakOf(zone(id)) * windXRamp(zone(id), x);
/** The lander-stretch zone whose x span holds x (at a shared edge: the one starting there; windC2 over the shaft). */
const zoneAt = (x: number) => LANDER.find((id) => x >= zone(id).rect!.x && x < zone(id).rect!.x + zone(id).rect!.w);

describe('round 19: windXRamp', () => {
  it('is 1 without a ramp, clamps at both ends and is linear between', () => {
    const r = { xRamp: { x0: 1000, x1: 3000, from: 0.4, to: 1 } };
    expect(windXRamp({}, 5000)).toBe(1);
    expect(windXRamp(r, 0)).toBe(0.4);
    expect(windXRamp(r, 1000)).toBe(0.4);
    expect(windXRamp(r, 2000)).toBeCloseTo(0.7, 12);
    expect(windXRamp(r, 3000)).toBe(1);
    expect(windXRamp(r, 9000)).toBe(1);
  });

  it('scales the push and the telegraphed accel together; gust timing is unchanged', () => {
    const z: WindGustSchedule = { kind: 'windGustSchedule', id: 'w', rect: { x: 0, y: 0, w: 4000, h: 1000 }, gusts: [{ atSec: 1, durationSec: 2, accel: { x: 2, y: 0 } }], repeatEverySec: 5 };
    const ramped: WindGustSchedule = { ...z, xRamp: { x0: 0, x1: 4000, from: 0.5, to: 1 } };
    const a = new WindSystem([z], () => {}, 1);
    const b = new WindSystem([ramped], () => {}, 1);
    for (const x of [0, 1000, 2000, 4000]) {
      for (const t of [0.5, 1.5, 2.5, 3.5]) {
        const pa = a.update(t, { x, y: 500 }, 10).x;
        const pb = b.update(t, { x, y: 500 }, 10).x;
        expect(pb).toBeCloseTo(pa * windXRamp(ramped, x), 12);
        expect(pb === 0).toBe(pa === 0);
        expect(b.active.map((g) => g.accel.x)).toEqual(a.active.map((g) => g.accel.x * windXRamp(ramped, x)));
      }
    }
  });

  it('audit L1: legacy m/s² gust events carry the ramped accel too (the whoosh volume); unramped zones are unchanged', () => {
    const z: WindGustSchedule = { kind: 'windGustSchedule', id: 'w', gusts: [{ atSec: 1, durationSec: 2, accel: { x: -2, y: 0.5 } }], repeatEverySec: 5 };
    const run = (zz: WindGustSchedule, x: number) => {
      const ev: GameEvent[] = [];
      const w = new WindSystem([zz], (e) => ev.push(e), 1.7);
      for (let t = 0; t < 4; t += 0.1) w.update(t, { x, y: 0 }, 10);
      return ev.map((e) => (e.type === 'windGust' ? [e.phase, e.accel.x, e.accel.y] : []));
    };
    expect(run(z, 500)).toEqual([['warning', -2, 0.5], ['start', -2, 0.5], ['end', -2, 0.5]]);
    expect(run({ ...z, xRamp: { x0: 0, x1: 1000, from: 0.5, to: 1 } }, 500)).toEqual([['warning', -1.5, 0.375], ['start', -1.5, 0.375], ['end', -1.5, 0.375]]);
  });

  it('the validator rejects a malformed ramp, and one whose span misses its zone (audit L4); a vertical zone may be ramped', () => {
    const withRamp = (id: string, xRamp: WindGustSchedule['xRamp']): LevelSpec => ({ ...floatingIsles, zones: floatingIsles.zones.map((z) => (z.id === id ? { ...z, xRamp } : z)) });
    expect(validateLevel(floatingIsles)).toEqual([]);
    for (const r of [{ x0: 5, x1: 5, from: 0.5, to: 1 }, { x0: 9, x1: 1, from: 0.5, to: 1 }, { x0: 0, x1: 1, from: -0.1, to: 1 }, { x0: 0, x1: 1, from: 0.5, to: 2.5 }, { x0: 0, x1: Number.NaN, from: 0.5, to: 1 }]) {
      expect(validateLevel(withRamp('windA', r)).join(' '), JSON.stringify(r)).toMatch(/xRamp/);
    }
    // windA spans x 8,000-10,300
    expect(validateLevel(withRamp('windA', { x0: 0, x1: 8000, from: 0.5, to: 1 })).join(' ')).toMatch(/xRamp .* does not overlap/);
    expect(validateLevel(withRamp('windA', { x0: 10300, x1: 12000, from: 0.5, to: 1 })).join(' ')).toMatch(/does not overlap/);
    expect(validateLevel(withRamp('windA', { x0: 10000, x1: 12000, from: 0.5, to: 1 }))).toEqual([]);
    expect(validateLevel(withRamp('skyLander', { x0: 8000, x1: 12000, from: 0.5, to: 1 }))).toEqual([]);
  });
});

describe('round 19: The Floating Isles side-wind ramp', () => {
  it('the CSM crosswinds and windA-C are ramped; beacon 5\'s shaft, the outpost and the vertical sky / turbulence are not', () => {
    for (const id of RAMPED) expect(zone(id).xRamp, id).toBeDefined();
    for (const z of gusts.filter((g) => !RAMPED.includes(g.id))) expect(z.xRamp, z.id).toBeUndefined();
    expect(zone('csmCross').xRamp).toEqual(WEATHER.sideRamp.csm);
    expect(WEATHER.sideRamp.csm.from).toBeGreaterThanOrEqual(0.4);
    expect(WEATHER.sideRamp.csm.from).toBeLessThanOrEqual(0.5);
    // every ramp spans exactly its own zone
    for (const id of ['windA', 'windB', 'windC']) expect([zone(id).xRamp!.x0, zone(id).xRamp!.x1], id).toEqual([zone(id).rect!.x, zone(id).rect!.x + zone(id).rect!.w]);
  });

  it('audit L2: the felt side wind is one continuous, rising curve - no step at x 10,300 or 13,900 - never above the pre-round-19 strength, full from beacon 5', () => {
    const K = WEATHER.sideRamp.landerFelt;
    // the knots: each zone's ramp is the straight piece of the curve over its span
    for (const [i, id] of ['windA', 'windB', 'windC'].entries()) {
      expect(felt(id, K[i]![0]), id).toBeCloseTo(K[i]![1], 9);
      expect(felt(id, K[i + 1]![0]), id).toBeCloseTo(K[i + 1]![1], 9);
    }
    // continuous at the boundaries (the zone ending there = the zone starting there)
    expect(felt('windA', 10300)).toBeCloseTo(felt('windB', 10300), 9);
    expect(felt('windB', 13900)).toBeCloseTo(felt('windC', 13900), 9);
    expect(felt('windC', 14580)).toBe(peakOf(zone('windD')));
    // monotone, gentle start, never stronger than before round 19 (the designed peak)
    let prev = 0;
    for (let x = 8000; x < 18000; x += 10) {
      const id = zoneAt(x)!;
      const f = felt(id, x);
      expect(f, `x ${x}`).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(f, `x ${x}`).toBeLessThanOrEqual(peakOf(zone(id)) + 1e-12);
      prev = f;
    }
    expect(felt('windA', 8000)).toBeCloseTo(0.9, 9);
    // the felt peak at each beacon (route landing x)
    expect(landX).toHaveLength(6);
    expect(felt('windA', landX[1]!)).toBeCloseTo(1.1, 1); // beacon 2 (was 1.5)
    expect(felt('windB', landX[2]!)).toBeCloseTo(1.37, 2); // beacon 3 (was 2.2)
    expect(felt('windB', landX[3]!)).toBeCloseTo(1.86, 2); // beacon 4, swaying (was 2.2)
    // beacon 5's shaft (windC2) and the outpost (windD): the same zones as before round 19
    for (const id of ['windC2', 'windD']) {
      expect(zone(id).gusts.map((g) => g.accel), id).toEqual([{ x: 3, y: 0 }, { x: -3, y: 0 }]);
      expect(zone(id).repeatEverySec).toBe(12);
    }
  });

  it('a live wind system feels the ramped gust: windB at site 3; windD at the outpost is the unramped zone', async () => {
    const s = await LevelSession.create(floatingIsles);
    const scale = s.tuning.gravity.scale;
    const w = new WindSystem([zone('windB')], () => {}, scale);
    const at = { x: 10760, y: 1300 };
    expect(w.update(6, at, 1).x).toBeCloseTo(felt('windB', at.x) * scale, 9);
    const w2 = new WindSystem([zone('windD')], () => {}, scale);
    for (const t of [1, 3, 5, 7, 9, 11]) expect(Math.abs(w2.update(t, { x: 16000, y: 1300 }, 1).x)).toBeLessThanOrEqual(3 * scale * 1.000001);
    expect(Math.abs(w2.update(5, { x: 16000, y: 1300 }, 1).x)).toBeCloseTo(3 * scale, 9);
    s.destroy();
  });
});

describe('round 19: sloppy flights under the ramped wind', () => {
  /** Checkpoint states from one clean reference run. */
  async function checkpointStates(): Promise<Record<string, RespawnState>> {
    const states: Record<string, RespawnState> = {};
    const s = await LevelSession.create(floatingIsles);
    s.start();
    const ap = new Autopilot(R);
    let want: string | null = null;
    s.on((e) => {
      if (e.type === 'checkpointReached') want = e.checkpointId;
    });
    for (let k = 0; k < 400 * 60 && !s.outcome; k++) {
      s.step(ap.frame(s));
      if (want) {
        states[want] = JSON.parse(JSON.stringify(s.respawnState()));
        want = null;
      }
    }
    expect(s.outcome?.kind).toBe('complete');
    s.destroy();
    return states;
  }

  it('a mid-skill pilot respawned at each beacon checkpoint (gust phase varied) reaches the next one', { timeout: 600_000 }, async () => {
    const states = await checkpointStates();
    expect(Object.keys(states).sort()).toEqual(['afterBeacon1', 'afterBeacon2', 'afterBeacon3', 'afterBeacon4', 'afterBeacon5', 'afterDragon']);
    const landIdx = R.map((n, i) => (n.land ? i : -1)).filter((i) => i >= 0);
    const skill = { lagFrames: 6, holdFrames: 5, speedMul: 1.1, aimErr: 12, holdRate: 0.08, dropRate: 0.04 };
    const report: string[] = [];
    for (let i = 1; i <= 4; i++) {
      const st = states[`afterBeacon${i}`]!;
      expect(Math.hypot(st.checkpoint.spawn.pos.x - BEACON_CHECKPOINTS[i - 1]!.respawn.x, st.checkpoint.spawn.pos.y - BEACON_CHECKPOINTS[i - 1]!.respawn.y)).toBeLessThan(2);
      const route = R.slice(landIdx[i - 1]! + 1).filter((n) => n.x >= st.checkpoint.spawn.pos.x - 100);
      let ok = 0;
      for (let seed = 1; seed <= 4; seed++) {
        const s = await LevelSession.create(floatingIsles, JSON.parse(JSON.stringify(st)));
        s.start();
        for (let k = 0; k < seed * 3.3 * 60; k++) s.step(emptyFrame()); // gust phase; the rest itself is safe
        expect(s.outcome, `afterBeacon${i} rest`).toBeNull();
        const p = new SloppyPilot(route, { ...skill, seed });
        let got = false;
        s.on((e) => {
          if (e.type === 'checkpointReached' && e.checkpointId === `afterBeacon${i + 1}`) got = true;
        });
        for (let k = 0; k < 150 * 60 && !s.outcome && !got; k++) s.step(p.frame(s));
        if (got) ok++;
        s.destroy();
      }
      report.push(`b${i}->b${i + 1} ${ok}/4`);
    }
    // measured round 19 (after audit L2): 4/4 on every segment; b3->b4 (the swaying site 4) is the weak one - 46/48 in the 48-seed sweep
    const got = report.map((r) => Number(r.split(' ')[1]!.split('/')[0]));
    for (const n of got) expect(n, report.join(', ')).toBeGreaterThanOrEqual(2);
    expect(got.reduce((a, b) => a + b, 0), report.join(', ')).toBeGreaterThanOrEqual(13);
  });
});

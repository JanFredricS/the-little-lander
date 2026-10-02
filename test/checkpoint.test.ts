/**
 * Round 12 (user: "on floating island can you add a checkpoint after the dragon, so I
 * don't have to restart each time I crash"): LevelSpec.checkpoints, captured at the
 * modeSwitch; LevelSession.respawnState() / LevelSession.create(spec, respawn).
 * Real floatingIsles sessions flown by the reference route pilot.
 */

import { describe, expect, it } from 'vitest';
import type { GameEvent, InputFrame, LevelSpec } from '../src/contracts';
import { FIXED_DT } from '../src/contracts';
import { CHECKPOINT_MIN_FUEL, CHECKPOINT_MIN_HULL, LevelSession, type RespawnState } from '../src/game/session';
import { Autopilot } from '../src/levels/dev/autopilot';
import { floatingIslesRoute } from '../src/levels/dev/routes';
import { BEACON_CHECKPOINTS, CHECKPOINT_RESPAWN_X, CHECKPOINT_RESPAWN_Y, floatingIsles } from '../src/levels/floatingIsles';
import { LEVELS } from '../src/levels/registry';
import { validateLevel } from '../src/levels/validate';
import { vPxToM } from '../src/physics/units';
import { emptyFrame } from '../src/shell/input';
import { BANNER_TTL, hudReduce, initHud } from '../src/ui/hud/hudState';

async function start(spec: LevelSpec, respawn: RespawnState | null = null) {
  const s = await LevelSession.create(spec, respawn);
  const events: GameEvent[] = [];
  s.on((e) => events.push(e));
  s.start();
  return { s, events };
}

/** Step `s` with `pilot` until `until` holds (or the time runs out / the level ends). */
function run(s: LevelSession, pilot: (s: LevelSession) => InputFrame, until: () => boolean, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / FIXED_DT) && !s.outcome && !until(); i++) s.step(pilot(s));
}

/** The reference route pilot from the level start; the lander part of the route from the respawn. */
const fullPilot = () => {
  const ap = new Autopilot(floatingIslesRoute);
  return (s: LevelSession) => ap.frame(s);
};
const respawnPilot = () => {
  const ap = new Autopilot(floatingIslesRoute.slice(floatingIslesRoute.findIndex((n) => n.x === 7200 && n.land)));
  return (s: LevelSession) => ap.frame(s);
};

/** One flight from the level start to beacon 1 planted and fuel1 taken (shared by the tests below). */
let flown: Promise<{ s: LevelSession; events: GameEvent[]; atSwitch: { fuel: number; hull: number; pickups: string[]; eventYet: boolean; captured: boolean; cp: LevelSession['checkpoint'] } }> | null = null;
function flyPastBeacon1() {
  flown ??= (async () => {
    const { s, events } = await start(floatingIsles);
    const pilot = fullPilot();
    run(s, pilot, () => s.state.mode === 'lander', 120);
    expect(s.state.mode).toBe('lander');
    const atSwitch = {
      fuel: s.state.fuel,
      hull: s.state.hull,
      pickups: s.env.pickups.collectedIds(),
      eventYet: events.some((e) => e.type === 'checkpointReached'),
      captured: s.checkpoint !== null,
      cp: s.checkpoint,
    };
    run(s, pilot, () => s.env.beacons.isPlanted('site1') && s.env.pickups.collectedIds().includes('fuel1'), 120);
    return { s, events, atSwitch };
  })();
  return flown;
}

describe('round 12 checkpoints: level data', () => {
  it('floatingIsles has one, captured at the modeSwitch, respawning on b1 left of beacon 1; only it, (round 14) The Throat, (round 15) Spring Isles, (round 17) The Vaults and (round 18) The Hollow have any', () => {
    expect(floatingIsles.checkpoints![0]).toEqual({ id: 'afterDragon', at: 'modeSwitch', respawn: { x: CHECKPOINT_RESPAWN_X, y: CHECKPOINT_RESPAWN_Y } });
    const site1 = floatingIsles.entities.find((e) => e.id === 'site1')!;
    expect(site1.kind === 'beaconSite' && CHECKPOINT_RESPAWN_X < site1.x - site1.w / 2 - 40).toBe(true);
    for (const spec of Object.values(LEVELS)) if (spec && spec.id !== 'floatingIsles' && spec.id !== 'throat' && spec.id !== 'springIsles' && spec.id !== 'vaults' && spec.id !== 'hollow') expect(spec.checkpoints, spec.id).toBeUndefined();
  });

  it('validator: an at-modeSwitch checkpoint needs a modeSwitch; ids unique; the respawn inside the world', () => {
    const { modeSwitch: _m, ...noSwitch } = floatingIsles;
    expect(validateLevel(floatingIsles)).toEqual([]);
    expect(validateLevel(noSwitch as LevelSpec).join(' ')).toMatch(/no modeSwitch/);
    const cp = floatingIsles.checkpoints![0]!;
    expect(validateLevel({ ...floatingIsles, checkpoints: [cp, cp] }).join(' ')).toMatch(/duplicate id/);
    expect(validateLevel({ ...floatingIsles, checkpoints: [{ ...cp, respawn: { x: -5, y: 100 } }] }).join(' ')).toMatch(/respawn outside/);
    // audit round 12 #6: a resting spot - not in rock, not a drop, not on a beacon site
    const at = (x: number, y: number) => validateLevel({ ...floatingIsles, checkpoints: [{ ...cp, respawn: { x, y } }] }).join(' ');
    expect(at(CHECKPOINT_RESPAWN_X, CHECKPOINT_RESPAWN_Y + 40)).toMatch(/respawn inside terrain 'b1'/);
    expect(at(CHECKPOINT_RESPAWN_X, CHECKPOINT_RESPAWN_Y - 200)).toMatch(/respawn has no terrain within 40 px below/);
    const site1 = floatingIsles.entities.find((e) => e.id === 'site1')!;
    expect(at(site1.x, CHECKPOINT_RESPAWN_Y)).toMatch(/respawn is in beacon site 'site1'/);
  });
});

describe('round 12 checkpoints: capture', () => {
  it('nothing before the seizure (a crash in the CSM slalom is a full restart); captured right after the switch to the lander', { timeout: 60_000 }, async () => {
    const { s, events } = await start(floatingIsles);
    const pilot = fullPilot();
    run(s, pilot, () => s.state.mode === 'lander' || s.simTime > 20, 60);
    expect(s.state.mode).toBe('csm');
    expect(s.checkpoint).toBeNull();
    expect(s.respawnState()).toBeNull();
    s.vessel.crash('impact');
    s.step(emptyFrame());
    expect(s.outcome?.kind).toBe('failed');
    expect(s.respawnState()).toBeNull();
    expect(events.some((e) => e.type === 'checkpointReached')).toBe(false);
  });

  it('the checkpoint: lander, the spec respawn spot (zero velocity), fuel / hull and pickups at the switch; checkpointReached after vesselModeChanged', { timeout: 120_000 }, async () => {
    const { s, events, atSwitch } = await flyPastBeacon1();
    const cp = atSwitch.cp!;
    expect(cp.id).toBe('afterDragon');
    expect(cp.mode).toBe('lander');
    expect(cp.resting).toBe(true);
    expect(cp.spawn.pos).toEqual({ x: CHECKPOINT_RESPAWN_X, y: CHECKPOINT_RESPAWN_Y });
    expect(cp.spawn.vel).toEqual({ x: 0, y: 0 });
    expect(cp.spawn.angle).toBe(0);
    // captured inside the switching step (before that step's remaining updates), so ~equal
    expect(cp.spawn.fuel).toBeCloseTo(atSwitch.fuel, 2);
    expect(cp.spawn.hull).toBeCloseTo(atSwitch.hull, 2);
    expect(cp.pickups).toEqual(atSwitch.pickups);
    expect(cp.pickups).not.toContain('fuel1');
    // captured in the switching step; its event (chime + banner) waits for the next step - in the
    // App that is after the csmSeized cutscene and the lander controls card (audit round 12 #4)
    expect(atSwitch.captured).toBe(true);
    expect(atSwitch.eventYet).toBe(false);
    const types = events.map((e) => e.type);
    const sw = types.indexOf('vesselModeChanged');
    expect(sw).toBeGreaterThanOrEqual(0);
    expect(types.indexOf('checkpointReached')).toBeGreaterThan(sw);
    expect(events.filter((e) => e.type === 'checkpointReached' && e.checkpointId === 'afterDragon')).toHaveLength(1);
  });
});

describe('round 12 checkpoints: respawn', () => {
  it('after a crash: the checkpoint pose / fuel / hull, beacons planted since kept, later pickups back, the clock carries on, no switch / cutscene / dragon', { timeout: 120_000 }, async () => {
    const { s } = await flyPastBeacon1();
    expect(s.env.beacons.isPlanted('site1')).toBe(true);
    // a crash with less fuel than at the checkpoint (fuel1 taken, then burnt)
    s.vessel.crash('impact');
    s.step(emptyFrame());
    expect(s.outcome?.kind).toBe('failed');
    const r = s.respawnState()!;
    expect(r.checkpoint).toBe(s.checkpoint);
    expect(r.checkpoint.id).toBe('afterBeacon1'); // round 13: beacon 1's checkpoint superseded the dragon's
    const spot = r.checkpoint.spawn.pos;
    expect(r.planted).toEqual(['site1']);
    expect(r.elapsed).toBeCloseTo(s.simTime, 6);

    const { s: b, events } = await start(floatingIsles, r);
    expect(events[0]).toMatchObject({ type: 'levelStarted', mode: 'lander' });
    expect(b.state.mode).toBe('lander');
    expect(b.state.pos.x).toBeCloseTo(spot.x, 3);
    expect(b.state.pos.y).toBeCloseTo(spot.y, 3);
    expect(b.state.fuel).toBeCloseTo(r.checkpoint.spawn.fuel!, 6);
    expect(b.state.hull).toBeCloseTo(r.checkpoint.spawn.hull!, 6);
    // beacons: planted (silently), the count continues from there
    expect(b.env.beacons.isPlanted('site1')).toBe(true);
    expect(b.env.beacons.planted).toBe(1);
    // pickups: taken before the checkpoint stay taken; fuel1 (after it) is back
    const taken = new Set(b.env.pickups.collectedIds());
    for (const id of r.checkpoint.pickups) expect(taken.has(id), id).toBe(true);
    expect(taken.has('fuel1')).toBe(false);
    expect(b.env.pickups.pickups.find((p) => p.entity.id === 'fuel1')!.collected).toBe(false);
    // the seizure is over
    expect(b.runtime.creatures.birds.every((x) => x.phase === 'gone')).toBe(true);
    expect(b.elapsed).toBeCloseTo(r.elapsed, 6);
    expect(b.checkpoint).toBe(r.checkpoint); // re-armed for the next crash

    // resting: 15 s without input - settles on b1's pad, nothing happens
    for (let i = 0; i < 15 / FIXED_DT; i++) b.step(emptyFrame());
    expect(b.outcome).toBeNull();
    expect(b.state.crashed).toBe(false);
    expect(b.state.landed).toBe(true);
    expect(b.state.hull).toBeCloseTo(r.checkpoint.spawn.hull!, 6);
    expect(Math.abs(b.state.pos.x - spot.x)).toBeLessThan(10);
    const after = events.slice(1).map((e) => e.type);
    // silent: no replays, and the settle onto the pad makes no thud / dust (audit round 12 #5)
    for (const t of ['vesselModeChanged', 'checkpointReached', 'beaconPlanted', 'objectiveComplete', 'crash', 'impact', 'softLand', 'hullChanged'] as const) expect(after, t).not.toContain(t);
    expect(b.env.beacons.isPlanted('site1')).toBe(true);
    expect(b.elapsed).toBeCloseTo(r.elapsed + 15, 3);

    // a second crash: the same checkpoint, the run's time keeps adding up
    b.vessel.crash('impact');
    b.step(emptyFrame());
    const r2 = b.respawnState()!;
    expect(r2.checkpoint).toBe(r.checkpoint);
    expect(r2.planted).toEqual(['site1']);
    expect(r2.elapsed).toBeCloseTo(r.elapsed + 15, 3);
  });

  it('the respawned run completes the level; the beacons objective counts the kept beacon once; the result time is the whole run', { timeout: 120_000 }, async () => {
    const { s } = await flyPastBeacon1();
    if (!s.outcome) {
      s.vessel.crash('impact');
      s.step(emptyFrame());
    }
    const r = s.respawnState()!;
    const { s: b, events } = await start(floatingIsles, r);
    run(b, respawnPilot(), () => false, 400);
    expect(b.outcome?.kind).toBe('complete');
    const planted = events.filter((e) => e.type === 'beaconPlanted');
    expect(planted.map((e) => e.type === 'beaconPlanted' && e.siteId)).toEqual(['site2', 'site3', 'site4', 'site5']);
    expect(planted.at(-1)).toMatchObject({ planted: 5, total: 5 });
    expect(events.filter((e) => e.type === 'objectiveComplete').map((e) => e.type === 'objectiveComplete' && e.objectiveId)).toEqual(['beacons', 'outpost']);
    const o = b.outcome!;
    expect(o.kind === 'complete' && o.timeSec).toBeCloseTo(r.elapsed + b.simTime, 3);
  });

  it('audit round 12 #1: seized on an empty tank with a wrecked hull - the checkpoint floors them, and the respawned lander reaches fuel1', { timeout: 120_000 }, async () => {
    const { s } = await start(floatingIsles);
    const pilot = fullPilot();
    run(s, pilot, () => s.runtime.creatures.birds.some((b) => b.phase === 'seizing'), 120);
    expect(s.state.mode).toBe('csm');
    s.vessel.addFuel(-1, 'burn');
    s.vessel.damage(s.state.hull - 0.03, 'impact');
    run(s, () => emptyFrame(), () => s.state.mode === 'lander', 5);
    expect(s.state.mode).toBe('lander');
    expect(s.state.fuel).toBe(0);
    const cp = s.checkpoint!;
    expect(cp.spawn.fuel).toBe(CHECKPOINT_MIN_FUEL);
    expect(cp.spawn.hull).toBe(CHECKPOINT_MIN_HULL);
    s.vessel.crash('impact');
    s.step(emptyFrame());
    const { s: b } = await start(floatingIsles, s.respawnState());
    expect(b.state.fuel).toBeCloseTo(CHECKPOINT_MIN_FUEL, 6);
    expect(b.state.hull).toBeCloseTo(CHECKPOINT_MIN_HULL, 6);
    run(b, respawnPilot(), () => b.env.pickups.collectedIds().includes('fuel1'), 120);
    expect(b.outcome).toBeNull();
    expect(b.env.beacons.isPlanted('site1')).toBe(true);
    expect(b.env.pickups.collectedIds()).toContain('fuel1');
  });

  it('all beacons kept: the objective is complete silently on respawn (no second chime)', async () => {
    const r: RespawnState = {
      checkpoint: {
        id: 'afterDragon',
        mode: 'lander',
        spawn: { pos: { x: CHECKPOINT_RESPAWN_X, y: CHECKPOINT_RESPAWN_Y }, angle: 0, vel: { x: 0, y: 0 }, fuel: 0.5, hull: 0.8 },
        resting: true,
        pickups: [],
        completed: [],
      },
      planted: ['site1', 'site2', 'site3', 'site4', 'site5'],
      elapsed: 100,
    };
    const { s, events } = await start(floatingIsles, r);
    expect(s.completedObjectives).toEqual(['beacons']);
    for (let i = 0; i < 2 / FIXED_DT; i++) s.step(emptyFrame());
    expect(events.filter((e) => e.type === 'objectiveComplete')).toEqual([]);
    expect(s.state.fuel).toBeCloseTo(0.5, 6);
    expect(s.state.hull).toBeCloseTo(0.8, 6);
  });
});

describe('round 12 checkpoints: HUD', () => {
  it('checkpointReached shows the CHECKPOINT banner', () => {
    const s = hudReduce(initHud(floatingIsles), { type: 'checkpointReached', checkpointId: 'afterDragon' });
    expect(s.banner).toEqual({ text: 'CHECKPOINT', ttl: BANNER_TTL });
  });
});

describe('round 13: a checkpoint after every beacon (floatingIsles)', () => {
  const SITES = ['site1', 'site2', 'site3', 'site4', 'site5'];
  /** A respawn at beacon checkpoint `i` (0-based) with beacons 1..i+1 planted, on the floor fuel / hull. */
  const respawnAt = (i: number): RespawnState => {
    const c = BEACON_CHECKPOINTS[i]!;
    return {
      checkpoint: {
        id: c.id,
        mode: 'lander',
        spawn: { pos: { ...c.respawn }, angle: 0, vel: { x: 0, y: 0 }, fuel: CHECKPOINT_MIN_FUEL, hull: CHECKPOINT_MIN_HULL },
        resting: true,
        pickups: [],
        completed: [],
      },
      planted: SITES.slice(0, i + 1),
      elapsed: 100,
    };
  };

  it('level data: one beaconPlanted checkpoint per site, after the dragon one; each respawn validator-clean on a static island', () => {
    const cps = floatingIsles.checkpoints!;
    expect(cps.map((c) => c.id)).toEqual(['afterDragon', 'afterBeacon1', 'afterBeacon2', 'afterBeacon3', 'afterBeacon4', 'afterBeacon5']);
    expect(cps.slice(1).map((c) => c.at === 'beaconPlanted' && c.siteId)).toEqual(SITES);
    expect(validateLevel(floatingIsles)).toEqual([]);
    // the swaying islet's beacon respawns on stepping stone s3, not on the moving island
    const sway = floatingIsles.entities.find((e) => e.id === 'sway')!;
    expect(Math.abs(BEACON_CHECKPOINTS[3].respawn.x - sway.x)).toBeGreaterThan(300);
    // validator: a beaconPlanted checkpoint needs a real site, one checkpoint per site
    const one = cps[1]!;
    expect(validateLevel({ ...floatingIsles, checkpoints: [{ ...one, siteId: 'nope' }] }).join(' ')).toMatch(/needs the siteId of a beaconSite/);
    expect(validateLevel({ ...floatingIsles, checkpoints: [one, { ...one, id: 'twin' }] }).join(' ')).toMatch(/already captures at site 'site1'/);
  });

  it('every respawn rests silently for 10 s: no crash, no plant, no thud; the kept beacons stay planted', { timeout: 60_000 }, async () => {
    for (let i = 0; i < 5; i++) {
      const { s, events } = await start(floatingIsles, respawnAt(i));
      for (let k = 0; k < 10 / FIXED_DT; k++) s.step(emptyFrame());
      const id = BEACON_CHECKPOINTS[i]!.id;
      expect(s.outcome, id).toBeNull();
      expect(s.state.landed, id).toBe(true);
      expect(Math.abs(s.state.pos.x - BEACON_CHECKPOINTS[i]!.respawn.x), id).toBeLessThan(10);
      expect(s.env.beacons.planted, id).toBe(i + 1);
      const types = events.slice(1).map((e) => e.type);
      for (const t of ['beaconPlanted', 'checkpointReached', 'impact', 'softLand', 'crash'] as const) expect(types, `${id}: ${t}`).not.toContain(t);
    }
  });

  it('from every beacon checkpoint (on the floor fuel / hull, no pickups kept) the route pilot finishes the level', { timeout: 300_000 }, async () => {
    for (let i = 0; i < 5; i++) {
      // the route's i-th landing is beacon i+1 (site 4's lands on the islet's drift, x 12,620)
      const land = floatingIslesRoute.map((n, k) => (n.land ? k : -1)).filter((k) => k >= 0)[i]!;
      expect(land, SITES[i]).toBeGreaterThan(0);
      const ap = new Autopilot(floatingIslesRoute.slice(land + 1));
      const { s, events } = await start(floatingIsles, respawnAt(i));
      run(s, (x) => ap.frame(x), () => false, 400);
      expect(s.outcome?.kind, `${BEACON_CHECKPOINTS[i]!.id}: ${JSON.stringify(s.outcome)}`).toBe('complete');
      expect(events.filter((e) => e.type === 'beaconPlanted').length, BEACON_CHECKPOINTS[i]!.id).toBe(4 - i);
    }
  });

  it('a crash on the very step after a plant still announces the checkpoint (before levelFailed), and the respawn is at it', { timeout: 120_000 }, async () => {
    const land = floatingIslesRoute.map((n, k) => (n.land ? k : -1)).filter((k) => k >= 0)[0]!;
    const ap = new Autopilot(floatingIslesRoute.slice(land + 1));
    const { s, events } = await start(floatingIsles, respawnAt(0));
    run(s, (x) => ap.frame(x), () => s.env.beacons.isPlanted('site2'), 200);
    expect(s.env.beacons.isPlanted('site2')).toBe(true);
    expect(s.checkpoint?.id).toBe('afterBeacon2');
    expect(events.some((e) => e.type === 'checkpointReached')).toBe(false); // held for the next step
    s.vessel.crash('impact');
    s.step(emptyFrame());
    const types = events.map((e) => (e.type === 'checkpointReached' ? `${e.type}:${e.checkpointId}` : e.type));
    expect(types).toContain('checkpointReached:afterBeacon2');
    expect(types.indexOf('checkpointReached:afterBeacon2')).toBeLessThan(types.indexOf('levelFailed'));
    expect(s.respawnState()?.checkpoint.id).toBe('afterBeacon2');
  });

  it('the real path: a crash inside step() after the plant (the same step, or the physics of the next) announces the checkpoint before levelFailed', { timeout: 120_000 }, async () => {
    const land = floatingIslesRoute.map((n, k) => (n.land ? k : -1)).filter((k) => k >= 0)[0]!;
    for (const how of ['sameStep', 'nextStep'] as const) {
      const ap = new Autopilot(floatingIslesRoute.slice(land + 1));
      const { s, events } = await start(floatingIsles, respawnAt(0));
      let plantedAt = -1;
      let steps = 0;
      s.on((e) => {
        if (e.type !== 'beaconPlanted' || e.siteId !== 'site2') return;
        plantedAt = steps;
        // fired from env.afterStep, mid step(): no test-side crash between steps
        const b = s.vessel.body;
        if (how === 'sameStep') {
          // the same step's out-of-bounds check (after env.afterStep) crashes the vessel
          s.physics.setTransform(b, vPxToM({ x: s.state.pos.x, y: floatingIsles.worldSize.h + 500 }), 0);
        } else {
          // slammed into the pad it sits on: the next step's contacts crash it
          s.physics.setLinearVelocity(b, { x: 0, y: 40 });
        }
      });
      for (; steps < 200 * 60 && !s.outcome; steps++) s.step(ap.frame(s));
      expect(plantedAt, how).toBeGreaterThanOrEqual(0);
      expect(s.outcome?.kind, how).toBe('failed');
      expect(steps - 1 - plantedAt, `${how}: steps from plant to crash`).toBe(how === 'sameStep' ? 0 : 1);
      const types = events.map((e) => (e.type === 'checkpointReached' ? `${e.type}:${e.checkpointId}` : e.type));
      expect(types, how).toContain('checkpointReached:afterBeacon2');
      expect(types.indexOf('checkpointReached:afterBeacon2'), how).toBeGreaterThan(types.indexOf('beaconPlanted'));
      expect(types.indexOf('checkpointReached:afterBeacon2'), how).toBeLessThan(types.indexOf('levelFailed'));
      expect(s.respawnState()?.checkpoint.id, how).toBe('afterBeacon2');
      s.destroy();
    }
  });

  it('a full flight: each plant captures its checkpoint (latest wins, floors applied), the event follows the plant quietly (withBeacon)', { timeout: 300_000 }, async () => {
    const { s, events } = await start(floatingIsles);
    const pilot = fullPilot();
    const seen: string[] = [];
    let last: string | null = null;
    run(
      s,
      (x) => {
        const id = x.checkpoint?.id ?? null;
        if (id !== last) {
          seen.push(id!);
          last = id;
          expect(x.checkpoint!.spawn.fuel!).toBeGreaterThanOrEqual(CHECKPOINT_MIN_FUEL);
          expect(x.checkpoint!.spawn.hull!).toBeGreaterThanOrEqual(CHECKPOINT_MIN_HULL);
        }
        return pilot(x);
      },
      () => false,
      400,
    );
    expect(s.outcome?.kind).toBe('complete');
    expect(seen).toEqual(['afterDragon', ...BEACON_CHECKPOINTS.map((c) => c.id)]);
    const cps = events.filter((e): e is Extract<GameEvent, { type: 'checkpointReached' }> => e.type === 'checkpointReached');
    expect(cps.map((e) => [e.checkpointId, !!e.withBeacon])).toEqual([['afterDragon', false], ...BEACON_CHECKPOINTS.map((c) => [c.id, true])]);
    // each beacon checkpoint event comes after its plant
    for (const c of BEACON_CHECKPOINTS) {
      const plant = events.findIndex((e) => e.type === 'beaconPlanted' && e.siteId === c.siteId);
      const cp = events.findIndex((e) => e.type === 'checkpointReached' && e.checkpointId === c.id);
      expect(cp, c.id).toBeGreaterThan(plant);
    }
    expect(s.respawnState()!.checkpoint.id).toBe('afterBeacon5');
  });

  it('HUD + audio: a beacon checkpoint folds into the plant banner and plays no second chime; the dragon one keeps both', async () => {
    const { EVENT_SFX } = await import('../src/audio/eventMap');
    let h = hudReduce(initHud(floatingIsles), { type: 'beaconPlanted', siteId: 'site2', planted: 2, total: 5 });
    h = hudReduce(h, { type: 'checkpointReached', checkpointId: 'afterBeacon2', withBeacon: true });
    expect(h.banner?.text).toBe('BEACON 2/5 PLANTED · CHECKPOINT');
    expect(EVENT_SFX.checkpointReached({ type: 'checkpointReached', checkpointId: 'afterBeacon2', withBeacon: true })).toEqual([]);
    expect(EVENT_SFX.checkpointReached({ type: 'checkpointReached', checkpointId: 'afterDragon' })).toEqual([{ id: 'objective' }]);
  });
});

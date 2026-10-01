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
import { CHECKPOINT_RESPAWN_X, CHECKPOINT_RESPAWN_Y, floatingIsles } from '../src/levels/floatingIsles';
import { LEVELS } from '../src/levels/registry';
import { validateLevel } from '../src/levels/validate';
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
let flown: Promise<{ s: LevelSession; events: GameEvent[]; atSwitch: { fuel: number; hull: number; pickups: string[]; eventYet: boolean; captured: boolean } }> | null = null;
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
    };
    run(s, pilot, () => s.env.beacons.isPlanted('site1') && s.env.pickups.collectedIds().includes('fuel1'), 120);
    return { s, events, atSwitch };
  })();
  return flown;
}

describe('round 12 checkpoints: level data', () => {
  it('floatingIsles has one, captured at the modeSwitch, respawning on b1 left of beacon 1; no other level has any', () => {
    expect(floatingIsles.checkpoints).toEqual([{ id: 'afterDragon', at: 'modeSwitch', respawn: { x: CHECKPOINT_RESPAWN_X, y: CHECKPOINT_RESPAWN_Y } }]);
    const site1 = floatingIsles.entities.find((e) => e.id === 'site1')!;
    expect(site1.kind === 'beaconSite' && CHECKPOINT_RESPAWN_X < site1.x - site1.w / 2 - 40).toBe(true);
    for (const spec of Object.values(LEVELS)) if (spec && spec.id !== 'floatingIsles') expect(spec.checkpoints, spec.id).toBeUndefined();
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
    const cp = s.checkpoint!;
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
    expect(types.filter((t) => t === 'checkpointReached')).toHaveLength(1);
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
    expect(r.planted).toEqual(['site1']);
    expect(r.elapsed).toBeCloseTo(s.simTime, 6);

    const { s: b, events } = await start(floatingIsles, r);
    expect(events[0]).toMatchObject({ type: 'levelStarted', mode: 'lander' });
    expect(b.state.mode).toBe('lander');
    expect(b.state.pos.x).toBeCloseTo(CHECKPOINT_RESPAWN_X, 3);
    expect(b.state.pos.y).toBeCloseTo(CHECKPOINT_RESPAWN_Y, 3);
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
    expect(Math.abs(b.state.pos.x - CHECKPOINT_RESPAWN_X)).toBeLessThan(10);
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

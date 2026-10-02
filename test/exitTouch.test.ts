/**
 * Round 8, maps 1-2 exits (user: "should be enough to just touch the square -
 * i touched it but did not progress"). hangarRun's dock used to need
 * < 45 px/s and |angle| < 0.25 (on a 44×50 box), Descent's < 120 px/s and
 * < 0.6 rad - a fast or tilted pass failed SILENTLY. Now touching the rect
 * completes; any level that keeps a gate shows why in the HUD while the
 * vessel is inside the rect (src/game/exitGate.ts).
 */

import { describe, expect, it } from 'vitest';
import { PX_PER_M, type ExitDockEntity, type LevelSpec } from '../src/contracts';
import { LevelSession } from '../src/game/session';
import { exitGate, exitHintText } from '../src/game/exitGate';
import { getLevel, LEVELS } from '../src/levels/registry';
import { EXIT_HINT_GRACE, hudReduce, hudTick, initHud, type HudState } from '../src/ui/hud/hudState';
import { frame } from './support/s7Harness';

const exitOf = (spec: LevelSpec): ExitDockEntity => {
  const o = spec.objectives.find((x) => x.kind === 'reachExit')!;
  return spec.entities.find((e): e is ExitDockEntity => e.kind === 'exitDock' && e.id === (o as { exitId: string }).exitId)!;
};

describe('maps 1-2: touching the exit square completes the level', () => {
  it.each([
    ['hangarRun', 1, 0, 450, 1.3], // fast sideways, steeply tilted
    ['hangarRun', -1, 0, 380, -2.6], // the other way, nearly upside down
    ['hangarRun', 0, 1, 300, 0.9], // straight up into it from below, tilted
    ['descent', 1, 0, 600, 1.4],
    ['descent', 0, -1, 500, 2.4], // falling into it nose-down
  ] as const)('%s: a pass at (%i, %i) × %i px/s, angle %f, completes', async (id, dx, dy, speed, angle) => {
    const spec = getLevel(id)!;
    const exit = exitOf(spec);
    expect(exit.maxSpeed).toBeUndefined();
    expect(exit.maxAngle).toBeUndefined();
    expect(exit.requireLanding).toBe(false);
    const s = await LevelSession.create(spec);
    s.start();
    // start just outside the rect on the far side of the travel direction, centred on the other axis
    const cx = exit.x - dx * (exit.w / 2 + 30);
    const cy = exit.y - exit.h / 2 + dy * (exit.h / 2 + 30);
    s.physics.setTransform(s.vessel.body, { x: cx / PX_PER_M, y: cy / PX_PER_M }, angle);
    s.physics.setLinearVelocity(s.vessel.body, { x: (dx * speed) / PX_PER_M, y: (-dy * speed) / PX_PER_M });
    for (let i = 0; i < 40 && !s.outcome; i++) s.step(frame());
    expect(s.outcome?.kind).toBe('complete');
    s.destroy();
  });

  it('the hangarRun dock is a real touch target (much bigger than the lander)', () => {
    const exit = exitOf(getLevel('hangarRun')!);
    expect(exit.w).toBeGreaterThanOrEqual(100);
    expect(exit.h).toBeGreaterThanOrEqual(90);
  });
});

describe('a gated exit is never a silent failure', () => {
  const pad: ExitDockEntity = { id: 'pad', kind: 'exitDock', x: 100, y: 200, w: 80, h: 40, requireLanding: true };
  const inside = { pos: { x: 100, y: 190 }, vel: { x: 0, y: 0 }, angle: 0, landed: false };

  it('exitGate: out / land / slow / level / ok, with a hint for every gate', () => {
    expect(exitGate(pad, { ...inside, pos: { x: 300, y: 190 } })).toBe('out');
    expect(exitGate(pad, inside)).toBe('land');
    expect(exitGate(pad, { ...inside, landed: true })).toBe('ok');
    const gated: ExitDockEntity = { ...pad, requireLanding: false, maxSpeed: 50, maxAngle: 0.3 };
    expect(exitGate(gated, { ...inside, vel: { x: 60, y: 0 } })).toBe('slow');
    expect(exitGate(gated, { ...inside, angle: 0.5 })).toBe('level');
    expect(exitGate(gated, inside)).toBe('ok');
    for (const g of ['land', 'slow', 'level'] as const) expect(exitHintText(g)).toMatch(/\S/);
    expect(exitHintText('ok')).toBeNull();
    expect(exitHintText('out')).toBeNull();
  });

  it('the exits round 8 did not touch are unchanged (snapshot: an accidental edit fails loudly)', () => {
    const docks: Record<string, unknown[]> = {};
    for (const [id, spec] of Object.entries(LEVELS)) {
      if (id === 'hangarRun' || id === 'descent') continue;
      docks[id] = spec!.entities.filter((e) => e.kind === 'exitDock');
    }
    const d = (id: string, x: number, y: number, w: number, h: number, requireLanding: boolean) => [{ id, kind: 'exitDock', x, y, w, h, requireLanding }];
    expect(docks).toEqual({
      testpad: d('exit', 2840, 780, 200, 40, true),
      physlab: d('exit', 4620, 1300, 140, 50, true),
      floatingIsles: d('exit', 17300, 1500, 120, 60, true),
      throat: d('exit', 800, 11690, 120, 60, true),
      vaults: d('camp', 13700, 620, 520, 70, true),
      hollow: d('tunnel', 15850, 1560, 200, 290, false),
      madDash: d('sky', 700, 170, 500, 150, false),
      keeper: [],
      springIsles: d('exit', 560, 600, 120, 60, true), // round 15; round 16: the taller tower's summit
    });
  });

  const hudSpec = { id: 'testpad' as const, vesselMode: 'lander' as const, startFuel: 1, objectives: [{ kind: 'reachExit' as const, id: 'goal', exitId: 'pad' }], entities: [pad] };
  const v = (o: Record<string, unknown> = {}) => ({ mode: 'lander', fuel: 1, hull: 1, attachedGoo: 0, crashed: false, landed: false, pos: inside.pos, vel: inside.vel, angle: 0, angularVel: 0, ...o }) as never;
  const ticks = (s: HudState, n: number, o: Record<string, unknown> = {}) => {
    for (let i = 0; i < n; i++) s = hudTick(s, v(o), 1 / 60);
    return s;
  };

  it('HUD: a normal landing (under EXIT_HINT_GRACE inside the pad rect) never shows the hint', () => {
    const graceTicks = Math.round(EXIT_HINT_GRACE * 60);
    let s = ticks(initHud(hudSpec), graceTicks - 2);
    expect(s.exitHint).toBeNull();
    s = hudTick(s, v({ landed: true }), 1 / 60); // touches down: completes
    s = hudReduce(s, { type: 'objectiveComplete', objectiveId: 'goal' });
    s = ticks(s, 120, { landed: true });
    expect(s.exitHint).toBeNull();
    // leaving the rect resets the timer: a second short pass shows nothing either
    s = ticks(initHud(hudSpec), graceTicks - 2);
    s = ticks(s, 1, { pos: { x: 400, y: 100 } });
    s = ticks(s, graceTicks - 2);
    expect(s.exitHint).toBeNull();
  });

  it('HUD: hovering past the grace shows the hint, steady across a bounce; leaving, crashing or completing clears it', () => {
    let s = ticks(initHud(hudSpec), Math.round(EXIT_HINT_GRACE * 60) + 1);
    expect(s.exitHint).toBe(exitHintText('land'));
    // bounce: landed flickers on / off - the hint never blinks off
    for (let i = 0; i < 20; i++) {
      s = hudTick(s, v({ landed: i % 3 === 0 }), 1 / 60);
      expect(s.exitHint, `bounce tick ${i}`).toBe(exitHintText('land'));
    }
    s = ticks(s, 1, { pos: { x: 400, y: 100 } });
    expect(s.exitHint).toBeNull();
    s = ticks(s, 60);
    s = ticks(s, 1, { crashed: true });
    expect(s.exitHint).toBeNull();
    s = ticks(s, 60);
    expect(s.exitHint).not.toBeNull();
    s = hudReduce(s, { type: 'objectiveComplete', objectiveId: 'goal' });
    s = ticks(s, 1);
    expect(s.exitHint).toBeNull();
  });

  it('HUD: TOO FAST uses the same grace', () => {
    const gated: ExitDockEntity = { ...pad, requireLanding: false, maxSpeed: 50 };
    const spec = { ...hudSpec, entities: [gated] };
    let s = ticks(initHud(spec), Math.round(EXIT_HINT_GRACE * 60) - 2, { vel: { x: 200, y: 0 } });
    expect(s.exitHint).toBeNull();
    s = ticks(s, 4, { vel: { x: 200, y: 0 } });
    expect(s.exitHint).toBe(exitHintText('slow'));
  });
});

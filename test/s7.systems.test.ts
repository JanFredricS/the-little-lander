/**
 * S7 level systems through a real LevelSession: loose rocks (rope pull
 * breaks them loose, no anchoring to falling rocks), crumbling platforms,
 * the kill front (crush + catch-up + overtaken platforms crumble).
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { EntitySpec, GameEvent, InputFrame, LevelSpec, TerrainPiece, ZoneSpec } from '../src/contracts';
import { LevelSession } from '../src/game/session';
import { validateLevel } from '../src/levels/validate';
import { aheadOfFront } from '../src/levels/systems/killFront';
import { LEVEL_SYSTEM_OPTIONS } from '../src/levels/systems';
import { emptyFrame } from '../src/shell/input';
import { pxToM, vPxToM } from '../src/physics/units';
import { castSolid } from '../src/physics/tags';

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});
const input = (f: Partial<InputFrame>): InputFrame => ({ ...emptyFrame(), ...f });

const GROUND = 1900;
const ROOF = 1500;

function lab(over: Partial<LevelSpec> & { pieces?: TerrainPiece[] } = {}): LevelSpec {
  const { pieces, ...rest } = over;
  return {
    id: 'physlab',
    title: 'test',
    themeId: 'hangar',
    vesselMode: 'lander',
    worldSize: { w: 3000, h: 2000 },
    spawn: { x: 500, y: GROUND - 20 },
    gravity: { x: 0, y: 5 },
    terrain: {
      pieces: pieces ?? [
        { id: 'ground', kind: 'ground', points: [{ x: 0, y: GROUND }, { x: 3000, y: GROUND }], style: { material: 'rock' } },
        { id: 'roof', kind: 'ceiling', points: [{ x: 0, y: ROOF }, { x: 3000, y: ROOF }], style: { material: 'rock' } },
      ],
    },
    entities: [],
    zones: [],
    objectives: [],
    ...rest,
  };
}

async function session(spec: LevelSpec) {
  expect(validateLevel(spec).filter((e) => !e.includes("objective"))).toEqual([]);
  const s = await LevelSession.create(spec);
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

const rock = (breakForce: number): EntitySpec => ({ id: 'rock1', kind: 'looseRock', x: 500, y: ROOF + 16, radius: 16, breakForce });

describe('loose rocks', () => {
  const podUnderRock = (breakForce: number) => lab({ vesselMode: 'harpoon', spawn: { x: 500, y: ROOF + 200 }, entities: [rock(breakForce)] });

  it('a rock holds a hanging pod when its breakForce is high', async () => {
    const { s, events, run } = await session(podUnderRock(1000));
    run(1, input({ fire: true, aim: { x: 0, y: -1 } }));
    run(120);
    expect(events.some((e) => e.type === 'ropeAttached')).toBe(true);
    expect(s.state.ropeState!.guns[0]!.phase).toBe('anchored');
    expect(s.systems.rocks!.isHanging('rock1')).toBe(true);
    // the rope pull is measured: about the pod's weight once it hangs still
    const weight = s.physics.getMass(s.vessel.body) * 5;
    expect(s.systems.rocks!.pullOf('rock1')).toBeGreaterThan(weight * 0.5);
    expect(s.systems.rocks!.pullOf('rock1')).toBeLessThan(weight * 3);
  });

  it('a rope pulling harder than breakForce tears the rock loose: rope drops, rock falls', async () => {
    const { s, events, run } = await session(podUnderRock(1.5));
    run(1, input({ fire: true, aim: { x: 0, y: -1 } }));
    run(90);
    expect(events.some((e) => e.type === 'ropeAttached')).toBe(true);
    expect(s.systems.rocks!.isHanging('rock1')).toBe(false);
    expect(events.some((e) => e.type === 'ropeBroken' && e.reason === 'overload')).toBe(true);
    expect(s.state.ropeState!.guns[0]!.phase).toBe('idle');
    const falling = s.systems.rocks!.fallingInfo();
    expect(falling).toHaveLength(1);
    // no anchoring to a falling rock
    const f = falling[0]!;
    expect(s.vessel.hooks.anchorAt(f.rock.body, f.pos).ok).toBe(false);
  });

  it('a pod hanging still does not break a rock, but reeling in on it (the winch) does', async () => {
    const { s, events, run } = await session(podUnderRock(1000));
    const weight = s.physics.getMass(s.vessel.body) * 5;
    // breakForce between the hanging weight and the winch pull
    (s.systems.rocks!.rocks[0]!.entity as { breakForce: number }).breakForce = weight * 1.8;
    run(1, input({ fire: true, aim: { x: 0, y: -1 } }));
    run(180);
    expect(s.systems.rocks!.isHanging('rock1')).toBe(true);
    run(30, input({ reelIn: true }));
    expect(s.systems.rocks!.isHanging('rock1')).toBe(false);
    expect(events.some((e) => e.type === 'ropeBroken')).toBe(true);
    run(30, input({ reelIn: true })); // the rig copes with its anchor body vanishing mid-reel
    expect(s.state.ropeState!.guns[0]!.phase).toBe('idle');
  });

  it('a rock with no rope on it stays put', async () => {
    const { s, run } = await session(podUnderRock(1.5));
    run(180);
    expect(s.systems.rocks!.isHanging('rock1')).toBe(true);
  });
});

describe('crumbling platforms', () => {
  const ledge: EntitySpec = { id: 'ledge', kind: 'crumblePlatform', x: 500, y: 1700, w: 120, h: 16, delaySec: 1, style: { material: 'ruin' } };

  it('collapses delaySec after the vessel first touches it; the vessel then falls', async () => {
    const { s, run } = await session(lab({ spawn: { x: 500, y: 1680 }, entities: [ledge] }));
    const c = s.systems.crumble!;
    run(30);
    expect(c.platforms[0]!.touchedAt).not.toBeNull();
    expect(c.platforms[0]!.gone).toBe(false);
    expect(s.state.pos.y).toBeLessThan(1700);
    run(60);
    expect(c.platforms[0]!.gone).toBe(true);
    run(120);
    expect(s.state.pos.y).toBeGreaterThan(1800); // fell to the ground
  });

  it('an untouched platform stays', async () => {
    const { s, run } = await session(lab({ entities: [ledge] }));
    run(300);
    expect(s.systems.crumble!.platforms[0]!.gone).toBe(false);
  });
});

describe('kill front', () => {
  const front = (over: Partial<Extract<ZoneSpec, { kind: 'killFront' }>> = {}): ZoneSpec => ({ id: 'front', kind: 'killFront', axis: 'y', start: 1995, speed: -100, ...over });

  it('aheadOfFront: the safe side is the one the front moves towards', () => {
    const rising = { id: 'f', kind: 'killFront' as const, axis: 'y' as const, start: 0, speed: -50 };
    expect(aheadOfFront(rising, 1000, { x: 0, y: 900 })).toBe(100);
    expect(aheadOfFront(rising, 1000, { x: 0, y: 1100 })).toBe(-100);
    const east = { id: 'f', kind: 'killFront' as const, axis: 'x' as const, start: 0, speed: 50 };
    expect(aheadOfFront(east, 1000, { x: 1200, y: 0 })).toBe(200);
  });

  it('a rising front crushes a vessel that stays put', async () => {
    const { s, events, run } = await session(lab({ zones: [front()] }));
    run(60);
    expect(s.state.crashed).toBe(false);
    run(60);
    expect(s.state.crashed).toBe(true);
    expect(events.find((e) => e.type === 'crash')).toMatchObject({ cause: 'crushed' });
    expect(s.systems.killFront!.fronts[0]!.pos).toBeGreaterThan(1995 - 100 * 2.1);
  });

  it('waits for its trigger', async () => {
    const { s, run } = await session(lab({ zones: [front({ activate: { kind: 'time', atSec: 3 } })] }));
    run(120);
    expect(s.systems.killFront!.fronts[0]!.active).toBe(false);
    expect(s.state.crashed).toBe(false);
    run(120);
    expect(s.systems.killFront!.fronts[0]!.active).toBe(true);
  });

  it('crumbles the platforms it overtakes', async () => {
    const ledge: EntitySpec = { id: 'ledge', kind: 'crumblePlatform', x: 1500, y: 1960, w: 120, h: 16, delaySec: 5, style: { material: 'ruin' } };
    const { s, run } = await session(lab({ spawn: { x: 500, y: 1600 }, pieces: [{ id: 'roof', kind: 'ceiling', points: [{ x: 0, y: 1500 }, { x: 3000, y: 1500 }], style: { material: 'rock' } }], entities: [ledge], zones: [front({ start: 1965, speed: -20 })] }));
    run(40);
    expect(s.systems.crumble!.platforms[0]!.gone).toBe(true);
  });

  it('catch-up (madDash option maxLag): the front never trails the vessel by more', async () => {
    const maxLag = LEVEL_SYSTEM_OPTIONS.madDash!.killFront!.maxLag!;
    const { s, run } = await session(lab({ id: 'madDash', spawn: { x: 500, y: 600 }, worldSize: { w: 3000, h: 4000 }, zones: [front({ start: 3900, speed: -10 })] }));
    run(2);
    const f = s.systems.killFront!.fronts[0]!;
    expect(f.pos - s.state.pos.y).toBeLessThanOrEqual(maxLag + 1);
  });
});

describe('self-righting assist (harpoonThrust)', () => {
  /** A harpoonThrust pod knocked onto its side on flat ground. */
  async function onItsSide() {
    const env = await session(lab({ vesselMode: 'harpoonThrust', spawn: { x: 500, y: GROUND - 30 } }));
    env.s.physics.setTransform(env.s.vessel.body, { x: pxToM(500), y: pxToM(GROUND - 9) }, -Math.PI / 2);
    env.run(90);
    expect(Math.abs(env.s.state.angle)).toBeGreaterThan(1.2);
    return env;
  }

  it('holding rotate towards upright rolls a pod on its side back onto its base', async () => {
    const { s, run } = await onItsSide();
    // hold rotate until it is (nearly) upright, like a player would
    for (let i = 0; i < 150 && s.state.angle < -0.3; i++) run(1, input({ rotateCW: true }));
    run(60);
    expect(Math.abs(Math.atan2(Math.sin(s.state.angle), Math.cos(s.state.angle)))).toBeLessThan(0.4);
    expect(s.state.crashed).toBe(false);
    expect(s.state.pos.y).toBeGreaterThan(GROUND - 30); // stayed on the ground
  });

  it('does nothing without the input, or when rotating the wrong way', async () => {
    const { s, run } = await onItsSide();
    const a0 = s.state.angle;
    run(120);
    run(120, input({ rotateCCW: true }));
    expect(s.systems.righting!.active).toBe(0);
    expect(Math.abs(s.state.angle)).toBeGreaterThan(1.0);
    expect(Math.abs(s.state.angle - a0)).toBeLessThan(Math.PI);
  });

  it('is off in flight (no contacts)', async () => {
    const { s, run } = await session(lab({ vesselMode: 'harpoonThrust', spawn: { x: 500, y: 1700 } }));
    s.physics.setTransform(s.vessel.body, { x: pxToM(500), y: pxToM(1700) }, -1);
    let max = 0;
    for (let i = 0; i < 20; i++) {
      run(1, input({ rotateCW: true }));
      max = Math.max(max, s.systems.righting!.active);
    }
    expect(max).toBe(0);
  });
});

describe('loose rock snap', () => {
  it('a rock torn loose snaps down at snapSpeed (the Keeper arena option: 160 px/s)', async () => {
    const { s, run } = await session(lab({ id: 'keeper', vesselMode: 'harpoon', spawn: { x: 500, y: ROOF + 200 }, entities: [rock(1000)] }));
    const weight = s.physics.getMass(s.vessel.body) * 5;
    (s.systems.rocks!.rocks[0]!.entity as { breakForce: number }).breakForce = weight * 1.8;
    run(1, input({ fire: true, aim: { x: 0, y: -1 } }));
    run(120);
    let vy: number | null = null;
    for (let i = 0; i < 60 && vy === null; i++) {
      run(1, input({ reelIn: true }));
      const f = s.systems.rocks!.fallingInfo();
      if (f.length) vy = f[0]!.vel.y;
    }
    expect(vy).not.toBeNull();
    expect(vy!).toBeGreaterThan(150);
    expect(vy!).toBeLessThan(175);
  });
});

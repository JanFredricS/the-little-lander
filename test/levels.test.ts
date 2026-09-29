import { describe, expect, it } from 'vitest';
import { ENTITY_KINDS } from '../src/contracts';
import type { EntitySpec, LevelSpec, ZoneSpec } from '../src/contracts';
import { LEVELS, resolveLevelParam } from '../src/levels/registry';
import { terrainChain } from '../src/levels/build';
import { assertValidLevel, validateLevel } from '../src/levels/validate';

/** A contract-shaped mock level exercising every entity kind, zone kind and objective kind. */
function mockLevel(): LevelSpec {
  const entities: EntitySpec[] = [
    { id: 'prop', kind: 'staticProp', x: 100, y: 880, w: 20, h: 20, sprite: 'prop.crate', solid: true },
    { id: 'debris', kind: 'debrisSpawner', x: 500, y: 50, area: { x: 400, y: 10, w: 200, h: 40 }, ratePerSec: 2, sizeMin: 6, sizeMax: 16, activate: { kind: 'time', atSec: 5 } },
    { id: 'goo', kind: 'gooSpawner', x: 700, y: 400, triggerRadius: 300, intervalSec: 3, maxAlive: 2, homingAccel: 4 },
    { id: 'orb1', kind: 'orb', x: 800, y: 300, points: 100, fuelRefill: 0.1 },
    { id: 'orb2', kind: 'orb', x: 850, y: 300, points: 100, fuelRefill: 0.1 },
    { id: 'site1', kind: 'beaconSite', x: 900, y: 890, w: 60, holdSec: 1 },
    { id: 'island', kind: 'movingIsland', x: 1200, y: 400, outline: [{ x: -40, y: 0 }, { x: 40, y: 0 }, { x: 0, y: 30 }], style: { material: 'organic' }, path: [{ x: 0, y: 0 }, { x: 0, y: 100 }], periodSec: 8, motion: 'pingpong' },
    { id: 'vine', kind: 'vine', x: 1300, y: 100, length: 120, segments: 8 },
    { id: 'door', kind: 'blastDoor', x: 1500, y: 800, w: 40, h: 160, from: 'top', close: { kind: 'enterRegion', rect: { x: 1300, y: 600, w: 100, h: 300 } }, closeDurationSec: 2 },
    { id: 'bird', kind: 'creature', x: 1600, y: 200, species: 'dragonBird', path: [{ x: 0, y: 0 }, { x: 300, y: 0 }], speed: 80, activate: { kind: 'objective', objectiveId: 'beacons' } },
    { id: 'boss', kind: 'bossSpawn', x: 1800, y: 400, bossId: 'keeper', arena: { x: 1600, y: 100, w: 390, h: 700 } },
    { id: 'fuel', kind: 'fuelPickup', x: 1000, y: 500, amount: 0.25 },
    { id: 'exit', kind: 'exitDock', x: 1900, y: 900, w: 80, h: 40, requireLanding: true, maxSpeed: 60 },
    { id: 'rock', kind: 'looseRock', x: 1700, y: 120, radius: 20, breakForce: 50 },
    { id: 'crumble', kind: 'crumblePlatform', x: 1100, y: 700, w: 80, h: 16, delaySec: 0.8, style: { material: 'ruin' } },
  ];
  const zones: ZoneSpec[] = [
    { kind: 'gravityZone', id: 'gz', rect: { x: 1000, y: 0, w: 200, h: 400 }, gravity: { x: 0, y: -9.8 } },
    { kind: 'windGustSchedule', id: 'wind', gusts: [{ atSec: 10, durationSec: 2, accel: { x: -3, y: 0 }, warnSec: 1 }], repeatEverySec: 20 },
    { kind: 'radiationEmitter', id: 'sun', x: 1000, y: 100, range: 800, periodSec: 12, warnSec: 2, fuelLoss: 0.3 },
    { kind: 'brittleRegion', id: 'brittle', rect: { x: 1200, y: 0, w: 200, h: 100 }, breakAfterSec: 1.5 },
    { kind: 'killFront', id: 'collapse', axis: 'y', start: 1000, speed: -40, activate: { kind: 'start' } },
  ];
  return {
    id: 'hangarRun',
    title: 'Mock',
    themeId: 'hangar',
    vesselMode: 'csm',
    modeSwitch: { to: 'lander', trigger: { kind: 'enterRegion', rect: { x: 600, y: 0, w: 50, h: 1000 } }, cutscene: 'csmSeized' },
    worldSize: { w: 2000, h: 1000 },
    spawn: { x: 50, y: 800 },
    gravity: { x: 0, y: 9.8 },
    gravityRamp: { axis: 'x', from: 0, to: 2000, gravityFrom: { x: 0, y: 1.5 }, gravityTo: { x: 0, y: 11 } },
    terrain: {
      pieces: [
        { id: 'g', kind: 'ground', points: [{ x: 0, y: 900 }, { x: 2000, y: 900 }], style: { material: 'metal' } },
        { id: 'c', kind: 'ceiling', points: [{ x: 0, y: 20 }, { x: 2000, y: 20 }], style: { material: 'rock' }, anchorable: true },
        { id: 'p', kind: 'polygon', points: [{ x: 300, y: 500 }, { x: 400, y: 500 }, { x: 350, y: 560 }], style: { material: 'rock', decorDensity: 0.5 } },
      ],
    },
    entities,
    zones,
    objectives: [
      { kind: 'plantBeacons', id: 'beacons', count: 1, siteIds: ['site1'] },
      { kind: 'collectOrbs', id: 'orbs', count: 2 },
      { kind: 'surviveBoss', id: 'boss', bossEntityId: 'boss' },
      { kind: 'reachExit', id: 'exit', exitId: 'exit' },
    ],
    cutsceneBefore: 'briefing',
    cutsceneAfter: 'meetIo',
    harpoonGuns: 2,
    physicsOverrides: { 'csm.thrust': 1.2 },
  };
}

describe('validateLevel', () => {
  it('accepts a mock level using every entity, zone and objective kind', () => {
    const spec = mockLevel();
    expect(new Set(spec.entities.map((e) => e.kind))).toEqual(new Set(ENTITY_KINDS));
    expect(validateLevel(spec)).toEqual([]);
  });

  it('accepts every registered level', () => {
    for (const spec of Object.values(LEVELS)) expect(() => assertValidLevel(spec!)).not.toThrow();
  });

  const cases: [string, (l: LevelSpec) => LevelSpec, RegExp][] = [
    ['bad theme', (l) => ({ ...l, themeId: 'moon' as never }), /unknown themeId/],
    ['bad mode', (l) => ({ ...l, vesselMode: 'jetpack' as never }), /unknown vesselMode/],
    ['spawn outside', (l) => ({ ...l, spawn: { x: -5, y: 10 } }), /spawn outside/],
    ['duplicate entity id', (l) => ({ ...l, entities: [...l.entities, { ...l.entities[0]! }] }), /duplicate id/],
    ['entity outside', (l) => ({ ...l, entities: [...l.entities, { id: 'far', kind: 'orb', x: 5000, y: 10, points: 1, fuelRefill: 0 }] }), /position outside/],
    [
      'ground x not increasing',
      (l) => ({ ...l, terrain: { pieces: [{ id: 'g', kind: 'ground', points: [{ x: 100, y: 900 }, { x: 50, y: 900 }], style: { material: 'rock' } }] } }),
      /strictly increasing x/,
    ],
    [
      'degenerate polygon',
      (l) => ({ ...l, terrain: { pieces: [{ id: 'p', kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }], style: { material: 'rock' } }] } }),
      /zero area/,
    ],
    ['no objectives', (l) => ({ ...l, objectives: [] }), /at least one objective/],
    ['exit is not an exitDock', (l) => ({ ...l, objectives: [{ kind: 'reachExit', id: 'x', exitId: 'orb1' }] }), /not an exitDock/],
    ['too many beacons', (l) => ({ ...l, objectives: [{ kind: 'plantBeacons', id: 'b', count: 3, siteIds: ['site1'] }] }), /exceeds/],
    ['too many orbs', (l) => ({ ...l, objectives: [{ kind: 'collectOrbs', id: 'o', count: 9 }] }), /needs 9 orbs/],
    ['trigger to unknown objective', (l) => ({ ...l, modeSwitch: { to: 'lander', trigger: { kind: 'objective', objectiveId: 'nope' } } }), /unknown objective/],
    ['mode switch to same mode', (l) => ({ ...l, modeSwitch: { to: 'csm', trigger: { kind: 'start' } } }), /equals the start mode/],
    ['radiation fuelLoss > 1', (l) => ({ ...l, zones: [{ kind: 'radiationEmitter', id: 'r', x: 10, y: 10, range: 10, periodSec: 5, warnSec: 1, fuelLoss: 3 }] }), /fuelLoss/],
    ['zone rect outside', (l) => ({ ...l, zones: [{ kind: 'brittleRegion', id: 'b', rect: { x: 1900, y: 0, w: 500, h: 10 }, breakAfterSec: 1 }] }), /outside the world/],
    ['startFuel > 1', (l) => ({ ...l, startFuel: 2 }), /startFuel/],
    ['non-finite override', (l) => ({ ...l, physicsOverrides: { x: Number.NaN } }), /physicsOverrides/],
  ];

  for (const [name, mutate, pattern] of cases) {
    it(`rejects: ${name}`, () => {
      const errors = validateLevel(mutate(mockLevel()));
      expect(errors.join('\n')).toMatch(pattern);
    });
  }

  it('assertValidLevel throws with all errors', () => {
    expect(() => assertValidLevel({ ...mockLevel(), startFuel: 2, spawn: { x: -1, y: -1 } })).toThrow(/startFuel[\s\S]*spawn|spawn[\s\S]*startFuel/);
  });
});

describe('level helpers', () => {
  it('resolves ?level= values', () => {
    expect(resolveLevelParam('testpad')).toBe('testpad');
    expect(resolveLevelParam('map1')).toBe('hangarRun');
    expect(resolveLevelParam('map8')).toBe('madDash');
    expect(resolveLevelParam('map9')).toBeNull();
    expect(resolveLevelParam('nope')).toBeNull();
    expect(resolveLevelParam(null)).toBeNull();
  });

  it('turns ceilings around so the solid side is above', () => {
    const c = terrainChain({ id: 'c', kind: 'ceiling', points: [{ x: 0, y: 30 }, { x: 60, y: 30 }], style: { material: 'rock' } });
    expect(c.loop).toBe(false);
    expect(c.points[0]!.x).toBeGreaterThan(c.points[1]!.x);
  });
});

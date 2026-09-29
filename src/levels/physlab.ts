/**
 * "physlab" — the S1 physics playground (debug level, ?level=physlab).
 * Left to right: spawn pad + crates, two beacon sites (ground + raised
 * platform), orbs and a fuel pickup, a low-ceiling harpoon tunnel with wind
 * gusts (brittle rock + a smooth non-anchorable metal stretch), an inverted
 * and a sideways gravity zone, a goo spawner, debris rain (plain + burning),
 * a radiation emitter with a pillar to hide behind, and the exit pad.
 *
 * Keys: 1 csm · 2 lander · 3 harpoon · 4 harpoon+thrust · M cycle modes
 * (debug levels only, see App). Flight controls per mode: src/shell/input.ts.
 */

import type { LevelSpec } from '../contracts';

const W = 4800;
const H = 1400;
const G = 1300; // ground line
const TOP = 300; // high ceiling
const TUNNEL = 1000; // harpoon tunnel ceiling

export const physlab: LevelSpec = {
  id: 'physlab',
  title: 'Physics Lab',
  themeId: 'hangar',
  vesselMode: 'lander',
  worldSize: { w: W, h: H },
  spawn: { x: 200, y: G - 40 },
  gravity: { x: 0, y: 3.2 },
  harpoonGuns: 2,
  debug: true,
  terrain: {
    pieces: [
      {
        id: 'ground',
        kind: 'ground',
        points: [
          { x: 0, y: G },
          { x: 1200, y: G },
          { x: 1250, y: G - 12 },
          { x: 1300, y: G },
          { x: W, y: G },
        ],
        style: { material: 'metal' },
      },
      {
        id: 'ceilingWest',
        kind: 'ceiling',
        points: [
          { x: 0, y: TOP },
          { x: 1350, y: TOP },
          { x: 1400, y: TUNNEL },
          { x: 1600, y: TUNNEL - 12 },
          { x: 1800, y: TUNNEL + 8 },
        ],
        style: { material: 'rock' },
      },
      {
        id: 'ceilingBrittle',
        kind: 'ceiling',
        points: [
          { x: 1800, y: TUNNEL + 8 },
          { x: 1950, y: TUNNEL - 6 },
          { x: 2100, y: TUNNEL },
        ],
        style: { material: 'crystal' },
      },
      {
        id: 'ceilingSmooth',
        kind: 'ceiling',
        points: [
          { x: 2100, y: TUNNEL },
          { x: 2300, y: TUNNEL },
        ],
        style: { material: 'metal' },
        anchorable: false,
      },
      {
        id: 'ceilingEast',
        kind: 'ceiling',
        points: [
          { x: 2300, y: TUNNEL },
          { x: 2450, y: TUNNEL },
          { x: 2500, y: TOP },
          { x: W, y: TOP },
        ],
        style: { material: 'rock' },
      },
      {
        id: 'wallWest',
        kind: 'polygon',
        points: [
          { x: 0, y: TOP },
          { x: 40, y: TOP },
          { x: 40, y: G },
          { x: 0, y: G },
        ],
        style: { material: 'metal' },
      },
      {
        id: 'wallEast',
        kind: 'polygon',
        points: [
          { x: W - 40, y: TOP },
          { x: W, y: TOP },
          { x: W, y: G },
          { x: W - 40, y: G },
        ],
        style: { material: 'metal' },
      },
      {
        id: 'beaconPlatform',
        kind: 'polygon',
        points: [
          { x: 860, y: 1160 },
          { x: 980, y: 1160 },
          { x: 980, y: G },
          { x: 860, y: G },
        ],
        style: { material: 'rock' },
      },
      {
        id: 'radiationPillar',
        kind: 'polygon',
        points: [
          { x: 4250, y: 800 },
          { x: 4320, y: 800 },
          { x: 4320, y: G },
          { x: 4250, y: G },
        ],
        style: { material: 'rock' },
      },
    ],
  },
  entities: [
    { id: 'crateA', kind: 'staticProp', x: 320, y: G - 15, w: 30, h: 30, sprite: 'prop.crate', dynamic: true, density: 0.6 },
    { id: 'crateB', kind: 'staticProp', x: 340, y: G - 45, w: 30, h: 30, sprite: 'prop.crate', dynamic: true, density: 0.6 },
    { id: 'siteA', kind: 'beaconSite', x: 520, y: G, w: 80, holdSec: 1 },
    { id: 'siteB', kind: 'beaconSite', x: 920, y: 1160, w: 100, holdSec: 1 },
    { id: 'orb1', kind: 'orb', x: 640, y: 1150, points: 100, fuelRefill: 0.1 },
    { id: 'orb2', kind: 'orb', x: 720, y: 1100, points: 100, fuelRefill: 0.1 },
    { id: 'orb3', kind: 'orb', x: 800, y: 1150, points: 100, fuelRefill: 0.1 },
    { id: 'fuel1', kind: 'fuelPickup', x: 1150, y: 1220, amount: 0.4 },
    { id: 'goo', kind: 'gooSpawner', x: 3400, y: 800, triggerRadius: 450, intervalSec: 2.5, maxAlive: 3, homingAccel: 3 },
    {
      id: 'debrisRain',
      kind: 'debrisSpawner',
      x: 3900,
      y: 320,
      area: { x: 3650, y: 310, w: 500, h: 30 },
      ratePerSec: 3,
      sizeMin: 6,
      sizeMax: 16,
      activate: { kind: 'enterRegion', rect: { x: 3550, y: TOP, w: 650, h: G - TOP } },
    },
    {
      id: 'debrisBurning',
      kind: 'debrisSpawner',
      x: 3900,
      y: 320,
      area: { x: 3700, y: 310, w: 400, h: 20 },
      ratePerSec: 0.8,
      sizeMin: 10,
      sizeMax: 18,
      velocity: { x: -30, y: 60 },
      burning: true,
      activate: { kind: 'enterRegion', rect: { x: 3550, y: TOP, w: 650, h: G - TOP } },
    },
    { id: 'exit', kind: 'exitDock', x: 4620, y: G, w: 140, h: 50, requireLanding: true },
  ],
  zones: [
    {
      kind: 'windGustSchedule',
      id: 'tunnelWind',
      rect: { x: 1350, y: TOP, w: 1200, h: G - TOP },
      gusts: [
        { atSec: 5, warnSec: 1.5, durationSec: 2.5, accel: { x: -3, y: 0 } },
        { atSec: 11, warnSec: 1.5, durationSec: 2, accel: { x: 4, y: -0.5 } },
      ],
      repeatEverySec: 14,
    },
    { kind: 'brittleRegion', id: 'brittleRock', rect: { x: 1800, y: 940, w: 300, h: 120 }, breakAfterSec: 1.5 },
    { kind: 'gravityZone', id: 'inverted', rect: { x: 2600, y: TOP, w: 250, h: G - TOP }, gravity: { x: 0, y: -3.2 } },
    { kind: 'gravityZone', id: 'sideways', rect: { x: 2900, y: TOP, w: 200, h: G - TOP }, gravity: { x: 2.5, y: 0.4 } },
    { kind: 'radiationEmitter', id: 'sun', x: 4450, y: 500, range: 800, periodSec: 7, warnSec: 2, fuelLoss: 0.3 },
  ],
  objectives: [
    { kind: 'plantBeacons', id: 'beacons', count: 2, siteIds: ['siteA', 'siteB'] },
    { kind: 'collectOrbs', id: 'orbs', count: 3 },
    { kind: 'reachExit', id: 'exit', exitId: 'exit' },
  ],
  camera: { bias: 'horizontal', lookAhead: 60 },
};

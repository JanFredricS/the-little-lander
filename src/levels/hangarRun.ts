/**
 * Map 1 — Hangar Run (lander, 8,200 × 1,500 px). Thread the VSS Halcyon's
 * hangar decks and dock with the CSM.
 *
 * Layout (left -> right):
 *   0-900      launch bay: spawn pad, crates, parked craft. Lift-off school.
 *   900-2000   beam gallery: a hanging gantry (fly under), a floating beam
 *              (over or the tight way under), a floor pillar (hop over).
 *   2000-2600  bulkhead 1: blast door closes from the top 8 s after you
 *              pass x = 2000 (≈ 3.5 s at a relaxed 90 px/s).
 *   2600-4000  maintenance tunnel: low, bumpy, a 120 px pinch; fuel canister.
 *   4000-4160  lift shaft up to the upper deck (600 px climb).
 *   4160-6040  upper deck: parked vessels, a low gantry, blast doors 2 (from
 *              the top) and 3 (rising from the floor, 460-620 slot).
 *   6040-6200  drop shaft back to the lower deck.
 *   6200-8200  final bay: crane beam, fuel, and the CSM hanging from the
 *              docking gantry at x = 7800. Dock from below: centre inside
 *              the dock box, < 45 px/s, |angle| < 0.25 rad.
 *
 * Tuning notes (map 1 = forgiving; see test/maps.test.ts for the autopilot
 * playtest numbers):
 *  - gravity 0.4 g (3.92 m/s², ship spin-grav) — slow falls, time to think.
 *  - lander.burnSeconds 110 (default 30): hovering costs ~0.6 %/s, so a
 *    careful 3-minute run ends with fuel to spare; two fuel canisters on top.
 *  - lander.crashSpeed 200 / damageSpeed 95 (defaults 150 / 75): scrapes and
 *    firm touchdowns only dent the hull while players learn differential
 *    thrust.
 *  - landAngle 0.4: forgiving touchdowns.
 *  - Doors: 8 s / 6 s / 8 s closes with 300-400 px run-ups; the door
 *    interlock re-opens a door that shut in your face (runtime/doors.ts), so
 *    a late arrival costs seconds, never the run.
 */

import type { EntitySpec, LevelSpec } from '../contracts';
import { box, ceiling, ground, P } from './kit';

const W = 8200;
const H = 1500;
const FL = 1300; // lower deck floor
const UD = 700; // upper deck floor
const HULL = 300; // upper deck ceiling

const G = 0.4 * 9.8;

const floorPts = [
  P(0, FL),
  P(1840, FL),
  P(1841, 1000), // floor pillar
  P(1880, 1000),
  P(1881, FL),
  P(3400, FL),
  P(3440, 1272), // tunnel floor hump
  P(3520, 1272),
  P(3560, FL),
  P(4160, FL),
  P(4161, UD), // lift shaft right wall
  P(5660, UD),
  P(5661, 620), // door 3 floor bulkhead
  P(5740, 620),
  P(5741, UD),
  P(6040, UD),
  P(6041, FL), // drop shaft
  P(W, FL),
];

const ceilPts = [
  P(0, 800),
  P(900, 800),
  P(960, 700),
  P(1280, 700),
  P(1281, 1050), // hanging gantry: fly under (250 px)
  P(1340, 1050),
  P(1341, 700),
  P(2280, 700),
  P(2281, 1060), // bulkhead 1 (door slot 1060-1300)
  P(2440, 1060),
  P(2441, 800),
  P(2600, 800),
  P(2700, 1120),
  P(3000, 1140),
  P(3200, 1110),
  P(3400, 1160),
  P(3480, 1152), // pinch: 1152..1272 = 120 px
  P(3560, 1160),
  P(3800, 1120),
  P(3900, 1100),
  P(4000, 900),
  P(4001, HULL), // lift shaft left wall
  P(4800, HULL),
  P(4801, 520), // low gantry on the upper deck (180 px under it)
  P(4880, 520),
  P(4881, HULL),
  P(5260, HULL),
  P(5261, 540), // bulkhead 2 (door slot 540-700)
  P(5340, 540),
  P(5341, HULL),
  P(5660, HULL),
  P(5661, 460), // bulkhead 3 (door slot 460-620)
  P(5740, 460),
  P(5741, HULL),
  P(6200, HULL),
  P(6201, 500), // final bay
  P(7700, 500),
  P(7701, 900), // docking gantry
  P(7900, 900),
  P(7901, 500),
  P(W, 500),
];

const entities: EntitySpec[] = [
  // launch bay
  { id: 'crate1', kind: 'staticProp', sprite: 'prop.crate', x: 380, y: FL - 8, w: 16, h: 16, dynamic: true, density: 0.5 },
  { id: 'crate2', kind: 'staticProp', sprite: 'prop.box', x: 396, y: FL - 8, w: 16, h: 16, dynamic: true, density: 0.5 },
  { id: 'crate3', kind: 'staticProp', sprite: 'prop.crate', x: 388, y: FL - 24, w: 16, h: 16, dynamic: true, density: 0.5 },
  { id: 'parked1', kind: 'staticProp', sprite: 'prop.parkedLander', x: 620, y: FL - 24, w: 48, h: 48, solid: true },
  { id: 'rack1', kind: 'staticProp', sprite: 'prop.rack', x: 80, y: FL - 24, w: 14, h: 48 },
  { id: 'console1', kind: 'staticProp', sprite: 'prop.console', x: 120, y: FL - 9, w: 24, h: 18 },
  { id: 'screen1', kind: 'staticProp', sprite: 'prop.screen', x: 160, y: 1180, w: 20, h: 16 },
  { id: 'gantryDecor1', kind: 'staticProp', sprite: 'prop.gantry', x: 500, y: 816, w: 64, h: 32 },
  // beam gallery
  { id: 'lightG', kind: 'staticProp', sprite: 'prop.warningLight', x: 1310, y: 1058, w: 8, h: 8 },
  { id: 'pillarDecor', kind: 'staticProp', sprite: 'prop.pillar', x: 1100, y: FL - 32, w: 16, h: 64 },
  // bulkhead 1
  { id: 'light1', kind: 'staticProp', sprite: 'prop.warningLight', x: 2270, y: 1068, w: 8, h: 8 },
  {
    id: 'door1',
    kind: 'blastDoor',
    x: 2360,
    y: 1180,
    w: 40,
    h: 240,
    from: 'top',
    close: { kind: 'enterRegion', rect: { x: 2000, y: 700, w: 100, h: FL - 700 } },
    closeDurationSec: 8,
  },
  // tunnel
  { id: 'fuel1', kind: 'fuelPickup', x: 3000, y: 1240, amount: 0.35 },
  { id: 'rack2', kind: 'staticProp', sprite: 'prop.rack', x: 2800, y: FL - 24, w: 14, h: 48 },
  // upper deck
  { id: 'parkedCsm', kind: 'staticProp', sprite: 'prop.parkedCsm', x: 4480, y: UD - 36, w: 48, h: 72, solid: true },
  { id: 'parked2', kind: 'staticProp', sprite: 'prop.parkedLander', x: 4640, y: UD - 24, w: 48, h: 48, solid: true },
  { id: 'crate4', kind: 'staticProp', sprite: 'prop.crate', x: 5000, y: UD - 8, w: 16, h: 16, dynamic: true, density: 0.5 },
  { id: 'crate5', kind: 'staticProp', sprite: 'prop.box', x: 5016, y: UD - 8, w: 16, h: 16, dynamic: true, density: 0.5 },
  { id: 'light2', kind: 'staticProp', sprite: 'prop.warningLight', x: 5250, y: 548, w: 8, h: 8 },
  {
    id: 'door2',
    kind: 'blastDoor',
    x: 5300,
    y: 620,
    w: 40,
    h: 160,
    from: 'top',
    close: { kind: 'enterRegion', rect: { x: 5000, y: HULL, w: 100, h: UD - HULL } },
    closeDurationSec: 6,
  },
  { id: 'light3', kind: 'staticProp', sprite: 'prop.warningLight', x: 5650, y: 468, w: 8, h: 8 },
  {
    id: 'door3',
    kind: 'blastDoor',
    x: 5700,
    y: 540,
    w: 40,
    h: 160,
    from: 'bottom',
    close: { kind: 'enterRegion', rect: { x: 5360, y: HULL, w: 60, h: UD - HULL } },
    closeDurationSec: 8,
  },
  { id: 'screen2', kind: 'staticProp', sprite: 'prop.screen', x: 5900, y: 600, w: 20, h: 16 },
  // final bay
  { id: 'fuel2', kind: 'fuelPickup', x: 6400, y: 1240, amount: 0.3 },
  { id: 'crane', kind: 'staticProp', sprite: 'prop.beam', x: 6900, y: 880, w: 64, h: 12, solid: true },
  { id: 'crane2', kind: 'staticProp', sprite: 'prop.beam', x: 6964, y: 880, w: 64, h: 12, solid: true },
  { id: 'parked3', kind: 'staticProp', sprite: 'prop.parkedLander', x: 7300, y: FL - 24, w: 48, h: 48, solid: true },
  { id: 'dockLightL', kind: 'staticProp', sprite: 'prop.warningLight', x: 7760, y: 906, w: 8, h: 8 },
  { id: 'dockLightR', kind: 'staticProp', sprite: 'prop.warningLight', x: 7840, y: 906, w: 8, h: 8 },
  { id: 'csm', kind: 'staticProp', sprite: 'prop.csm', x: 7800, y: 918, w: 24, h: 36, solid: true },
  { id: 'exit', kind: 'exitDock', x: 7800, y: 1000, w: 44, h: 50, requireLanding: false, maxSpeed: 45, maxAngle: 0.25 },
];

export const hangarRun: LevelSpec = {
  id: 'hangarRun',
  title: 'Hangar Run',
  themeId: 'hangar',
  vesselMode: 'lander',
  worldSize: { w: W, h: H },
  spawn: { x: 200, y: FL - 17 },
  gravity: { x: 0, y: G },
  terrain: {
    pieces: [
      ground('floor', floorPts, 'metal', { decorDensity: 0.15 }),
      ceiling('ceiling', ceilPts, 'metal', { decorDensity: 0 }),
      box('wallW', 0, 790, 40, FL - 790, 'metal'),
      box('wallE', W - 40, 490, 40, FL - 490, 'metal'),
      box('beam1', 1540, 1150, 220, 22, 'metal'),
      box('beam2', 3150, 1235, 60, 14, 'ruin', { decorDensity: 0 }),
      box('ledge1', 6060, 1000, 60, 16, 'metal'),
    ],
  },
  entities,
  zones: [],
  objectives: [{ kind: 'reachExit', id: 'dock', exitId: 'exit' }],
  camera: { bias: 'horizontal', lookAhead: 80 },
  physicsOverrides: {
    'lander.burnSeconds': 110,
    'lander.crashSpeed': 200,
    'lander.damageSpeed': 95,
    'lander.landAngle': 0.4,
  },
};

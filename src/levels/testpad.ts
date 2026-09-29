/**
 * "testpad" — the S0 debug level. Flat ground, a floating platform, a few
 * static and dynamic boxes, and an exit pad on the right. Proves loop,
 * physics, camera, input and rendering end to end. Open with ?level=testpad.
 *
 * Controls (placeholder vessel, CSM bindings): W / ↑ / Space = thrust,
 * A / D (← / →) = rotate, Esc / P = pause.
 */

import type { LevelSpec } from '../contracts';

const W = 3200;
const H = 1000;
const GROUND_Y = 900;

export const testpad: LevelSpec = {
  id: 'testpad',
  title: 'Test Pad',
  themeId: 'hangar',
  vesselMode: 'csm',
  worldSize: { w: W, h: H },
  spawn: { x: 220, y: 800 },
  gravity: { x: 0, y: 3.2 },
  debug: true,
  terrain: {
    pieces: [
      {
        id: 'ground',
        kind: 'ground',
        points: [
          { x: 0, y: GROUND_Y },
          { x: 900, y: GROUND_Y },
          { x: 1000, y: GROUND_Y - 30 },
          { x: 1100, y: GROUND_Y },
          { x: W, y: GROUND_Y },
        ],
        style: { material: 'metal' },
      },
      {
        id: 'ceiling',
        kind: 'ceiling',
        points: [
          { x: 0, y: 60 },
          { x: 1500, y: 60 },
          { x: 1600, y: 140 },
          { x: 1700, y: 60 },
          { x: W, y: 60 },
        ],
        style: { material: 'metal' },
      },
      {
        id: 'wallLeft',
        kind: 'polygon',
        points: [
          { x: 0, y: 60 },
          { x: 40, y: 60 },
          { x: 40, y: GROUND_Y },
          { x: 0, y: GROUND_Y },
        ],
        style: { material: 'metal' },
      },
      {
        id: 'wallRight',
        kind: 'polygon',
        points: [
          { x: W - 40, y: 60 },
          { x: W, y: 60 },
          { x: W, y: GROUND_Y },
          { x: W - 40, y: GROUND_Y },
        ],
        style: { material: 'metal' },
      },
      {
        id: 'platform',
        kind: 'polygon',
        points: [
          { x: 1300, y: 640 },
          { x: 1500, y: 640 },
          { x: 1480, y: 670 },
          { x: 1320, y: 670 },
        ],
        style: { material: 'rock' },
      },
      {
        id: 'exitPlatform',
        kind: 'polygon',
        points: [
          { x: 2700, y: 780 },
          { x: 2980, y: 780 },
          { x: 2980, y: GROUND_Y },
          { x: 2700, y: GROUND_Y },
        ],
        style: { material: 'metal' },
      },
    ],
  },
  entities: [
    { id: 'crateA', kind: 'staticProp', x: 600, y: GROUND_Y - 20, w: 40, h: 40, sprite: 'prop.crate', solid: true },
    { id: 'crateB', kind: 'staticProp', x: 640, y: GROUND_Y - 60, w: 40, h: 40, sprite: 'prop.crate', solid: true },
    { id: 'pillar', kind: 'staticProp', x: 1900, y: GROUND_Y - 90, w: 40, h: 180, sprite: 'prop.pillar', solid: true },
    { id: 'boxA', kind: 'staticProp', x: 1380, y: 625, w: 30, h: 30, sprite: 'prop.box', dynamic: true, density: 0.5 },
    { id: 'boxB', kind: 'staticProp', x: 1420, y: 625, w: 30, h: 30, sprite: 'prop.box', dynamic: true, density: 0.5 },
    { id: 'boxC', kind: 'staticProp', x: 2300, y: GROUND_Y - 15, w: 30, h: 30, sprite: 'prop.box', dynamic: true, density: 0.5 },
    { id: 'exit', kind: 'exitDock', x: 2840, y: 780, w: 200, h: 40, requireLanding: true },
  ],
  zones: [],
  objectives: [{ kind: 'reachExit', id: 'reachExit', exitId: 'exit' }],
  camera: { bias: 'horizontal', lookAhead: 60 },
};

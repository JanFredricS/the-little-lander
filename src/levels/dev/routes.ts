/**
 * Intended flight lines for the autopilot playtests (test/maps.test.ts and
 * the browser hook). A route is the designer's "good line" through a map;
 * the tests prove it completes within the level's fuel / hull budget.
 */

import type { LevelId } from '../../contracts';
import type { RouteNode } from './autopilot';

export const hangarRunRoute: RouteNode[] = [
  { x: 300, y: 1150, speed: 90 },
  { x: 1000, y: 1180, speed: 110 },
  { x: 1310, y: 1190, speed: 90, tol: 30 },
  { x: 1650, y: 1020, speed: 110 },
  { x: 1860, y: 930, speed: 100 },
  { x: 2200, y: 1180, speed: 110 },
  { x: 2500, y: 1180, speed: 110 },
  { x: 2750, y: 1220, speed: 90 },
  { x: 3480, y: 1215, speed: 70, tol: 25 },
  { x: 3950, y: 1220, speed: 90 },
  { x: 4080, y: 1150, speed: 80, tol: 30 },
  { x: 4080, y: 600, speed: 110, tol: 30 },
  { x: 4300, y: 560, speed: 100 },
  { x: 4840, y: 620, speed: 90, tol: 30 },
  { x: 5100, y: 620, speed: 120 },
  { x: 5400, y: 600, speed: 120 },
  { x: 5700, y: 500, speed: 120, tol: 25 },
  { x: 6120, y: 500, speed: 90, tol: 30 },
  { x: 6120, y: 1150, speed: 110, tol: 30 },
  { x: 6800, y: 1100, speed: 120 },
  { x: 7600, y: 1080, speed: 110 },
  { x: 7800, y: 1060, speed: 40, tol: 12, stop: true },
  { x: 7800, y: 985, speed: 25, tol: 10, stop: true },
];

export const ROUTES: Partial<Record<LevelId, readonly RouteNode[]>> = {
  hangarRun: hangarRunRoute,
};

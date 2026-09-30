/**
 * Intended flight lines for the autopilot playtests (test/maps.test.ts and
 * the browser hook). A route is the designer's "good line" through a map;
 * the tests prove it completes within the level's fuel / hull budget.
 */

import type { LevelId } from '../../contracts';
import type { RouteNode } from './autopilot';
import { DESCENT_LINE } from '../descent';
import { THROAT_TUBE } from '../theThroat';

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
  // feel pass (lighter gravity): hold the line low under door 2 (closes from the top), the old line sagged into it
  { x: 5400, y: 640, speed: 120 },
  { x: 5700, y: 500, speed: 120, tol: 25 },
  { x: 6120, y: 500, speed: 90, tol: 30 },
  { x: 6120, y: 1150, speed: 110, tol: 30 },
  // S10: grab the final-bay canister on purpose (the pre-assist pilot only sagged into it)
  { x: 6400, y: 1225, speed: 110, tol: 25 },
  { x: 6800, y: 1100, speed: 120 },
  { x: 7600, y: 1080, speed: 110 },
  { x: 7800, y: 1060, speed: 40, tol: 12, stop: true },
  { x: 7800, y: 985, speed: 25, tol: 10, stop: true },
];

/** Map 2: the designed line; slower through the boulder field and the embers. */
export const descentRoute: RouteNode[] = DESCENT_LINE.slice(1).map((p, i, a) => {
  const last = i === a.length - 1;
  const speed = p.y < 3300 ? 170 : p.y < 6500 ? 120 : p.y < 9400 ? 140 : 160;
  return last ? { x: p.x, y: p.y, speed: 90, tol: 30, stop: true } : { x: p.x, y: p.y, speed, tol: 50 };
});

/** Map 3: CSM slalom until the dragon-bird strikes, then the five beacons. */
export const floatingIslesRoute: RouteNode[] = [
  { x: 600, y: 1150, speed: 120 },
  { x: 1100, y: 1450, speed: 130 },
  { x: 1650, y: 1050, speed: 130 },
  { x: 2000, y: 1000, speed: 140 },
  { x: 2350, y: 1080, speed: 140 },
  { x: 2800, y: 1350, speed: 140 },
  { x: 3000, y: 1350, speed: 140 },
  { x: 3450, y: 1150, speed: 140 },
  { x: 3900, y: 1150, speed: 140 },
  { x: 4400, y: 1250, speed: 140 },
  { x: 4800, y: 1450, speed: 140 },
  { x: 5300, y: 1400, speed: 140 },
  { x: 5900, y: 1350, speed: 140 },
  // lander from here on (the bird takes the CSM somewhere above)
  { x: 6600, y: 1350, speed: 120 },
  { x: 7200, y: 1500, land: true, hold: 1.8, speed: 100 },
  { x: 7700, y: 1350, speed: 110 },
  { x: 7800, y: 1150, speed: 90 },
  { x: 8150, y: 1150, speed: 110 },
  { x: 8800, y: 1250, speed: 110 },
  { x: 9300, y: 1250, speed: 80, tol: 20 },
  { x: 9300, y: 1400, land: true, hold: 2.3, speed: 60 },
  { x: 9300, y: 1250, speed: 60, tol: 25 },
  { x: 10000, y: 1200, speed: 110 },
  { x: 10300, y: 1150, speed: 110 },
  { x: 11100, y: 1150, speed: 110 },
  { x: 11350, y: 1450, speed: 90 },
  { x: 11200, y: 1552, speed: 50, tol: 15, stop: true },
  { x: 10760, y: 1600, land: true, hold: 2.3, speed: 45 },
  { x: 11150, y: 1552, speed: 50, tol: 20 },
  { x: 11380, y: 1450, speed: 80 },
  { x: 11900, y: 1380, speed: 110 },
  { x: 12500, y: 1250, speed: 100 },
  { x: 12620, y: 1355, land: true, hold: 2.3, speed: 60 },
  { x: 13300, y: 1330, speed: 110 },
  { x: 14000, y: 1100, speed: 110 },
  { x: 14655, y: 1100, speed: 80, tol: 15, stop: true },
  { x: 14655, y: 1700, land: true, hold: 2.3, speed: 40 },
  { x: 14655, y: 1100, speed: 60, tol: 25 },
  { x: 15300, y: 1150, speed: 110 },
  { x: 15650, y: 1250, speed: 110 },
  { x: 16200, y: 1350, speed: 120 },
  { x: 17300, y: 1500, land: true, hold: 1, speed: 110 },
];

/** Map 4: down the tube's centre line, around the pillars, slow in squeezes. */
export const theThroatRoute: RouteNode[] = (() => {
  const lanes = [
    { x: 740, y: 2030, w: 110 },
    { x: 720, y: 2150, w: 110 },
    { x: 740, y: 2280, w: 110 },
    { x: 785, y: 4430, w: 100 },
    { x: 785, y: 4550, w: 100 },
    { x: 830, y: 4690, w: 100 },
    { x: 610, y: 6950, w: 120 },
    { x: 610, y: 7050, w: 120 },
    { x: 640, y: 7180, w: 120 },
  ];
  // centre-line nodes, minus those the pillars sit on (the lanes replace them)
  const clear = THROAT_TUBE.slice(1, -2).filter((n) => !((n.y > 1950 && n.y < 2350) || (n.y > 4350 && n.y < 4750) || (n.y > 6900 && n.y < 7200)));
  const pts = [...clear, ...lanes].sort((a, b) => a.y - b.y);
  const route: RouteNode[] = pts.map((p) => ({ x: p.x, y: p.y, speed: Math.min(110, Math.round(p.w * 0.45)), tol: Math.min(40, Math.round(p.w / 4)) }));
  route.push({ x: 800, y: 11500, speed: 80 });
  route.push({ x: 800, y: 11690, land: true, hold: 1, speed: 60 });
  return route;
})();

export const ROUTES: Partial<Record<LevelId, readonly RouteNode[]>> = {
  hangarRun: hangarRunRoute,
  descent: descentRoute,
  floatingIsles: floatingIslesRoute,
  throat: theThroatRoute,
};

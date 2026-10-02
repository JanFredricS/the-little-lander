/**
 * Reference pilots for the story maps (maps 1-4: src/levels/dev autopilot
 * routes; maps 5-8: the S7 pilots; map 9: the round-15 spring jumper) and the completion fuel floors the story
 * tests assert (S8 difficulty pass).
 */

import type { InputFrame, LevelId } from '../../src/contracts';
import type { LevelSession } from '../../src/game/session';
import { Autopilot } from '../../src/levels/dev/autopilot';
import { ROUTES } from '../../src/levels/dev/routes';
import { MADDASH_ROUTE } from '../../src/levels/madDash';
import { SPRING_ISLES_ROUTE } from '../../src/levels/springIsles';
import { springJumper } from './springJumper';
import { harpoonPilot, hollowPilot, keeperPilot, landerDashPilot } from './s7Pilots';

export type Pilot = (s: LevelSession, tick: number) => InputFrame;

export function pilotFor(id: LevelId): Pilot {
  switch (id) {
    case 'vaults':
      return harpoonPilot({ landX: 13480 });
    case 'hollow':
      return hollowPilot();
    case 'keeper':
      return keeperPilot({ attempts: 0, drops: 0 }, { offset: 125, below: 175 });
    case 'madDash':
      return landerDashPilot({ route: MADDASH_ROUTE, vclimb: 110 });
    case 'springIsles':
      return springJumper(SPRING_ISLES_ROUTE);
    default: {
      const ap = new Autopilot(ROUTES[id]!);
      return (s) => ap.frame(s);
    }
  }
}

/**
 * Minimum fuel (0..1) the reference pilot must still have when the map
 * completes. S8 measured 0.22-0.71 (keeper 0.35+ after its burnSeconds
 * override); a tuning change that erases a map's margin fails the story
 * tests. Vaults is the unpowered harpoon pod (fuel never moves).
 */
export const MIN_COMPLETION_FUEL: Readonly<Partial<Record<LevelId, number>>> = {
  hangarRun: 0.15,
  descent: 0.15,
  floatingIsles: 0.15,
  throat: 0.15,
  vaults: 0.99,
  hollow: 0.15,
  keeper: 0.1,
  madDash: 0.15,
  springIsles: 0.99, // spring legs: no fuel at all
};

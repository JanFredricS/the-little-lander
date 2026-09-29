/**
 * The 18 cutscene stills (426×240, own limited palette each). Pure data:
 * generate in Node or the browser; the ArtApi converts to canvases.
 */

import type { StillId } from '../../contracts';
import { commanderPortrait, halcyonBriefingDeck, ioPortrait, wrenPortrait } from './people';
import { asterFromOrbit, csmCockpitRough, hangarLaunch, landerCockpit } from './space';
import type { Still } from './types';
import {
  beaconRoadDawn,
  caveMouthPodTransfer,
  collapseEscape,
  dragonBirdAttack,
  emptyOutpost,
  floatingIslandsVista,
  hollowSunKeeper,
  keeperDefeated,
  researchTeamFound,
  reunionAboveClouds,
} from './world';

export type { Still } from './types';

const GENERATORS: Record<StillId, () => Still> = {
  asterFromOrbit,
  halcyonBriefingDeck,
  commanderPortrait,
  wrenPortrait,
  ioPortrait,
  hangarLaunch,
  landerCockpit,
  csmCockpitRough,
  floatingIslandsVista,
  dragonBirdAttack,
  emptyOutpost,
  caveMouthPodTransfer,
  researchTeamFound,
  hollowSunKeeper,
  keeperDefeated,
  collapseEscape,
  reunionAboveClouds,
  beaconRoadDawn,
};

/** Every StillId, in story order. */
export const STILL_IDS = Object.keys(GENERATORS) as readonly StillId[];

const cache = new Map<StillId, Still>();

/** Generate (memoised) a still. Throws only for ids outside StillId; callers guard with STILL_IDS. */
export function generateStill(id: StillId): Still {
  let s = cache.get(id);
  if (!s) {
    s = GENERATORS[id]();
    cache.set(id, s);
  }
  return s;
}

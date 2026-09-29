/**
 * FROZEN (S0). Cutscene scripts (S3 writes them, S2 draws the stills).
 *
 * The id lists below are closed on purpose: S2 (stills) and S3 (scripts)
 * run concurrently, so both build against exactly these names. A script may
 * reuse any still in several shots.
 */

/** One cutscene per story beat (PLAN.md "Story arc"). */
export type CutsceneId =
  | 'briefing' // before Map 1: Halcyon briefing deck, Commander assigns the survey
  | 'meetIo' // after Map 1: inside the lander, Wren meets Io
  | 'descentAwe' // after Map 2: rough ride, then awe at the floating islands
  | 'csmSeized' // mid Map 3: dragon-bird seizes the CSM, emergency detach
  | 'emptyOutpost' // after Map 3: the abandoned science outpost
  | 'podTransfer' // after Map 4: lander can't fit, Wren takes the harpoon pod
  | 'teamFound' // after Map 5: the research team and their discovery
  | 'keeperWakes' // after Map 6 / before Map 7: the sun's keeper wakes
  | 'keeperFalls' // after Map 7: the keeper defeated, the hollow starts to collapse
  | 'finale'; // after Map 8: reunion above the clouds, Halcyon pickup, beacon road

/** Pre-composed full-screen stills (STILL_WIDTH×STILL_HEIGHT native). */
export type StillId =
  | 'asterFromOrbit' // Halcyon approaching the shattered planet
  | 'halcyonBriefingDeck' // wide shot of the briefing deck
  | 'commanderPortrait'
  | 'wrenPortrait'
  | 'ioPortrait'
  | 'hangarLaunch' // lander leaving the Halcyon hangar
  | 'landerCockpit' // interior, two seats, instrument glow
  | 'csmCockpitRough' // shaking cockpit, debris outside
  | 'floatingIslandsVista' // first view of the isles and sky-creatures
  | 'dragonBirdAttack' // the dragon-bird seizing the CSM
  | 'emptyOutpost' // deserted science base
  | 'caveMouthPodTransfer' // lander parked at a narrow shaft, pod detaching
  | 'researchTeamFound' // the team in a glowing vault
  | 'hollowSunKeeper' // the artificial sun and the waking keeper
  | 'keeperDefeated'
  | 'collapseEscape' // the hollow crumbling, lander racing upward
  | 'reunionAboveClouds'
  | 'beaconRoadDawn'; // beacons lighting the colony's safe road

/** Who is talking (drives the name plate / portrait tint). */
export type Speaker = 'wren' | 'io' | 'commander' | 'team' | 'keeper' | 'narrator';

/** How a shot ends. */
export type ShotAdvance =
  /** Auto-advance after this many seconds (any key skips ahead). */
  | { kind: 'duration'; seconds: number }
  /** Wait for a key/tap after the text has finished typing. */
  | { kind: 'key' };

export interface CutsceneShot {
  still: StillId;
  /** Lines typed out in order (typewriter). Empty = picture only. */
  textLines: readonly string[];
  speaker?: Speaker;
  advance: ShotAdvance;
}

export interface CutsceneScript {
  id: CutsceneId;
  shots: readonly CutsceneShot[];
}

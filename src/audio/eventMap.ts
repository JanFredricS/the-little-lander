/**
 * GameEvent -> one-shot SFX cues. A Record over EVERY GameEventType, so a new
 * event kind in the contract fails the type-check here until it is mapped
 * (to cues, or explicitly to [] with the reason in STATEFUL_EVENTS /
 * SILENT_EVENTS). Stateful reactions (music mood, thrusters, tension) are in
 * engine.ts.
 */

import type { GameEvent, GameEventOf, GameEventType } from '../contracts';
import type { SfxId, SfxOpts } from './sfx';
import { clamp01 } from './util';

export interface SfxCue {
  id: SfxId;
  opts?: SfxOpts;
}

type Mapper<T extends GameEventType> = (e: GameEventOf<T>) => SfxCue[];

/** Impact speed (px/s) that counts as "full intensity". */
const HARD_SPEED = 300;
/** Hull loss (VesselState.hull is 0..1) that counts as "full intensity". */
const HARD_HULL_LOSS = 0.3;

export const EVENT_SFX: { [T in GameEventType]: Mapper<T> } = {
  levelStarted: () => [],
  crash: () => [{ id: 'crash' }],
  softLand: () => [{ id: 'softLand' }],
  beaconPlanted: (e) => [{ id: 'beaconChime', opts: { variant: Math.max(0, e.planted - 1) } }],
  orbCollected: (e) => [{ id: 'orbArp', opts: { variant: e.points } }],
  fuelChanged: (e) => (e.reason === 'pickup' || e.reason === 'refill' ? [{ id: 'fuelPickup' }] : []),
  hullChanged: (e) => {
    if (e.reason === 'repair') return [{ id: 'repair' }];
    if (e.reason === 'goo') return []; // gooAttached already voiced
    if (e.delta >= 0) return [];
    const opts = { intensity: clamp01(-e.delta / HARD_HULL_LOSS) };
    return e.reason === 'debris' ? [{ id: 'debris', opts }, { id: 'hullHit', opts }] : [{ id: 'hullHit', opts }];
  },
  radiationCharging: (e) => [{ id: 'radiationCharge', opts: { dur: e.inSec } }],
  radiationHit: () => [{ id: 'radiationBlast' }],
  windGust: (e) =>
    e.phase === 'warning'
      ? [{ id: 'windWarning' }]
      : e.phase === 'start'
        ? [{ id: 'windWhoosh', opts: { intensity: clamp01(Math.hypot(e.accel.x, e.accel.y) / 15), variant: Math.sign(e.accel.x) } }]
        : [],
  gravityChanged: (e) => (e.rampProgress === undefined ? [{ id: 'gravityShift' }] : []),
  enginesChanged: () => [],
  impact: (e) => (e.with.startsWith('debris') ? [{ id: 'debris', opts: { intensity: clamp01(e.speed / HARD_SPEED) } }] : [{ id: 'bump', opts: { intensity: clamp01(e.speed / HARD_SPEED) } }]),
  gooAttached: () => [{ id: 'gooAttach' }],
  gooBurned: () => [{ id: 'gooBurn' }],
  harpoonFired: (e) => [{ id: 'harpoonFire', opts: { variant: e.gun } }],
  harpoonMissed: () => [{ id: 'harpoonMiss' }],
  ropeAttached: (e) => [{ id: e.brittle ? 'harpoonHitBrittle' : 'harpoonHit' }],
  ropeBroken: () => [{ id: 'harpoonBreak' }],
  ropeReleased: () => [{ id: 'harpoonRelease' }],
  ropeReeling: (e) => (e.dir === null ? [] : [{ id: 'harpoonReel', opts: { variant: e.dir === 'in' ? 0 : 1 } }]),
  vesselModeChanged: () => [{ id: 'modeChange' }],
  objectiveComplete: () => [{ id: 'objective' }],
  checkpointReached: (e) => (e.withBeacon ? [] : [{ id: 'objective' }]),
  levelComplete: () => [{ id: 'levelComplete' }],
  levelFailed: () => [{ id: 'levelFailed' }],
  bossPhase: (e) => [{ id: 'bossRoar', opts: { variant: e.phase - 1 } }],
  bossHit: (e) => [{ id: 'bossHurt', opts: { intensity: clamp01(e.damage * 4) } }],
  bossDefeated: () => [{ id: 'bossDefeated' }],
  cutsceneDone: () => [],
  springCharging: (e) => (e.charging ? [{ id: 'springCompress' }] : []),
  springJump: (e) => [{ id: 'springBoing', opts: { intensity: e.power === 0 ? clamp01(Math.hypot(e.vel.x, e.vel.y) / 380) * 0.6 : e.power } }],
  platformCrumbling: (e) => [{ id: 'crumbleShake', opts: { dur: e.inSec } }],
  platformCrumbled: () => [{ id: 'crumbleBreak' }],
};

/** Events handled by engine state (music / thrusters), not one-shots. */
export const STATEFUL_EVENTS: readonly GameEventType[] = ['levelStarted', 'enginesChanged', 'gravityChanged', 'vesselModeChanged', 'crash', 'levelComplete', 'levelFailed', 'bossPhase', 'bossDefeated', 'cutsceneDone'];

export function cuesFor(e: GameEvent): SfxCue[] {
  return (EVENT_SFX[e.type] as Mapper<GameEventType>)(e as never);
}

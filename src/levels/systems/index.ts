/**
 * Builds the level-owned systems a LevelSpec needs (see types.ts). Level
 * options that the frozen LevelSpec has no field for (rock regrowth, the
 * collapse front's catch-up) live in LEVEL_SYSTEM_OPTIONS by level id.
 */

import type { BossSpawnEntity, LevelId } from '../../contracts';
import { KeeperSystem } from '../boss/keeperSystem';
import { CrumbleSystem } from './crumble';
import { KillFrontSystem, type KillFrontOptions } from './killFront';
import { LooseRockSystem, type LooseRockOptions } from './looseRocks';
import { RightingSystem } from './righting';
import type { LevelSystem, LevelSystemHost } from './types';

export type { LevelSystem, LevelSystemHost } from './types';
export { CrumbleSystem } from './crumble';
export { KillFrontSystem } from './killFront';
export { LooseRockSystem } from './looseRocks';
export { RightingSystem } from './righting';
export { KeeperSystem } from '../boss/keeperSystem';

export interface LevelSystemOptions {
  looseRocks?: LooseRockOptions;
  killFront?: KillFrontOptions;
}

/** Per-level system options (tuned in the S7 playtest pass). */
export const LEVEL_SYSTEM_OPTIONS: Partial<Record<LevelId, LevelSystemOptions>> = {
  keeper: { looseRocks: { respawnSec: 14, snapSpeed: 160 } },
  madDash: { killFront: { maxLag: 600 } },
};

/** The systems a level uses, in update order (rocks before the boss that reads them). */
export interface LevelSystems {
  list: LevelSystem[];
  rocks: LooseRockSystem | null;
  crumble: CrumbleSystem | null;
  killFront: KillFrontSystem | null;
  keeper: KeeperSystem | null;
  righting: RightingSystem | null;
}

export function createLevelSystems(host: LevelSystemHost, options: LevelSystemOptions = LEVEL_SYSTEM_OPTIONS[host.spec.id] ?? {}): LevelSystems {
  const spec = host.spec;
  const has = (k: string) => spec.entities.some((e) => e.kind === k);
  const rocks = has('looseRock') ? new LooseRockSystem(host, options.looseRocks) : null;
  const crumble = has('crumblePlatform') ? new CrumbleSystem(host) : null;
  const killFront = spec.zones.some((z) => z.kind === 'killFront') ? new KillFrontSystem(host, options.killFront, crumble) : null;
  const boss = spec.entities.find((e): e is BossSpawnEntity => e.kind === 'bossSpawn');
  const keeper = boss ? new KeeperSystem(host, boss, rocks) : null;
  // every level: it serves the reaction-wheel modes (csm, harpoonThrust) whatever the level switches to, idle otherwise
  const righting = new RightingSystem(host);
  const list = [rocks, crumble, killFront, keeper, righting].filter((s): s is NonNullable<typeof s> => s !== null);
  return { list, rocks, crumble, killFront, keeper, righting };
}

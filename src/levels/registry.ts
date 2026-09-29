/**
 * Level registry: LevelId -> LevelSpec. Slices add their levels here (one
 * line each). `?level=<id>` (or `?level=map1`..`map8`) opens a level directly.
 */

import { STORY_LEVELS } from '../contracts';
import type { LevelId, LevelSpec } from '../contracts';
import { testpad } from './testpad';

export const LEVELS: Partial<Record<LevelId, LevelSpec>> = {
  testpad,
};

export function getLevel(id: LevelId): LevelSpec | undefined {
  return LEVELS[id];
}

export function isLevelId(v: string): v is LevelId {
  return v === 'testpad' || v === 'physlab' || (STORY_LEVELS as readonly string[]).includes(v);
}

/** Resolve a ?level= value: a LevelId or 'map1'..'map8' (story order). */
export function resolveLevelParam(v: string | null): LevelId | null {
  if (!v) return null;
  const m = /^map([1-8])$/.exec(v);
  if (m) return STORY_LEVELS[Number(m[1]) - 1] ?? null;
  return isLevelId(v) ? v : null;
}

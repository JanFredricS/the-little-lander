/**
 * Level-select model (pure): which levels are listed, their lock state and
 * best results. Consumes SaveState (S3 owns writing it).
 *
 *  - Story levels are always listed, in STORY_LEVELS order.
 *    'hangarRun' is always unlocked; others need SaveState.unlocked.
 *    A story level that is unlocked but not registered yet shows "SOON".
 *  - Registered non-story levels are listed only when NOT `debug`, unless
 *    `showDebug` (the `?debug` query flag) is set.
 */

import { SAVE_STORAGE_KEY, STORY_LEVELS } from '../contracts';
import type { LevelBest, LevelId, LevelSpec, SaveState } from '../contracts';
import type { MenuItem } from './menu';

export type LevelLock = 'open' | 'locked' | 'unbuilt';

export interface LevelEntry {
  id: LevelId;
  /** 1-based story number, or null for extra/debug levels. */
  number: number | null;
  title: string;
  lock: LevelLock;
  debug: boolean;
  best: LevelBest | null;
}

/** Fallback titles for story levels not registered yet. */
export const STORY_TITLES: Record<LevelId, string> = {
  testpad: 'Test Pad',
  physlab: 'Physics Lab',
  hangarRun: 'Hangar Run',
  descent: 'Descent',
  floatingIsles: 'The Floating Isles',
  throat: 'The Throat',
  vaults: 'The Vaults',
  hollow: 'The Hollow',
  keeper: 'The Keeper',
  madDash: 'The Mad Dash',
  springIsles: 'Spring Isles',
};

export type SaveView = Pick<SaveState, 'unlocked' | 'best'>;

export function levelEntries(save: SaveView | null, levels: Partial<Record<LevelId, LevelSpec>>, showDebug = false): LevelEntry[] {
  const unlocked = new Set<LevelId>(save?.unlocked ?? []);
  unlocked.add('hangarRun');
  const out: LevelEntry[] = STORY_LEVELS.map((id, i) => {
    const spec = levels[id];
    const lock: LevelLock = !unlocked.has(id) ? 'locked' : spec ? 'open' : 'unbuilt';
    return { id, number: i + 1, title: spec?.title ?? STORY_TITLES[id], lock, debug: false, best: save?.best?.[id] ?? null };
  });
  for (const id of Object.keys(levels) as LevelId[]) {
    if ((STORY_LEVELS as readonly string[]).includes(id)) continue;
    const spec = levels[id];
    if (!spec) continue;
    if (spec.debug && !showDebug) continue;
    out.push({ id, number: null, title: spec.title, lock: 'open', debug: !!spec.debug, best: save?.best?.[id] ?? null });
  }
  return out;
}

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '--:--.-';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export function entryDetail(e: LevelEntry): string {
  if (e.lock === 'locked') return 'LOCKED';
  if (e.lock === 'unbuilt') return 'SOON';
  if (e.debug) return 'DEBUG';
  if (e.best) return `${formatTime(e.best.timeSec)}  ★${e.best.orbs}`;
  return 'NEW';
}

export function entryLabel(e: LevelEntry): string {
  return `${e.number !== null ? `${e.number}` : '·'} ${e.title.toUpperCase()}`;
}

export function levelMenuItems(entries: readonly LevelEntry[]): MenuItem[] {
  return entries.map((e) => ({ id: e.id, label: entryLabel(e), detail: entryDetail(e), enabled: e.lock === 'open' }));
}

/** Next story level after `id` (null at the end / for non-story levels). */
export function nextStoryLevel(id: LevelId): LevelId | null {
  const i = (STORY_LEVELS as readonly LevelId[]).indexOf(id);
  return i >= 0 && i + 1 < STORY_LEVELS.length ? STORY_LEVELS[i + 1]! : null;
}

/**
 * Tolerant read-only view of the saved progress (S3 owns the save format and
 * writing it). Missing / corrupt data -> null (defaults apply).
 */
export function readSaveView(storage: Pick<Storage, 'getItem'> | null = safeLocalStorage()): SaveView | null {
  try {
    const raw = storage?.getItem(SAVE_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SaveState>;
    const unlocked = Array.isArray(v.unlocked) ? (v.unlocked.filter((x) => typeof x === 'string') as LevelId[]) : [];
    const best: SaveState['best'] = {};
    if (v.best && typeof v.best === 'object') {
      for (const [k, b] of Object.entries(v.best)) {
        if (b && typeof b.timeSec === 'number' && typeof b.orbs === 'number' && typeof b.score === 'number') best[k as LevelId] = b;
      }
    }
    return { unlocked, best };
  } catch {
    return null;
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

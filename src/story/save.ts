/**
 * SaveState persistence (contracts/save.ts) in localStorage.
 *
 * - Every storage access is try/catch-guarded: private mode, quota errors or
 *   a missing localStorage fall back to an in-memory save for the session.
 * - Loading VALIDATES and fills defaults: unknown ids are dropped, numbers
 *   are clamped, missing fields get defaults. Anything unparsable is a
 *   corrupted save: the raw text is kept under `<key>.corrupt` for
 *   debugging and play continues from a fresh save.
 */

import { SAVE_STORAGE_KEY, SAVE_VERSION, STORY_LEVELS } from '../contracts';
import type { CutsceneId, LevelBest, LevelId, LevelOutcome, SaveState, Settings } from '../contracts';
import { nextStoryLevel } from './flow';
import { CUTSCENE_IDS } from './scripts';

/** The subset of the Web Storage API we use (injectable for tests). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const CORRUPT_SUFFIX = '.corrupt';

const ALL_LEVEL_IDS: readonly LevelId[] = ['testpad', 'physlab', ...STORY_LEVELS];
const FIRST_LEVEL: LevelId = STORY_LEVELS[0]!;

export const DEFAULT_SETTINGS: Settings = {
  musicVolume: 0.7,
  sfxVolume: 0.8,
  reducedMotion: false,
  touchControls: 'auto',
  debugOverlay: false,
  swapEngineButtons: true,
  showFps: false,
  lowRes: null,
  steering: 'engines',
  showMinimap: true,
};

export function defaultSave(): SaveState {
  return { version: SAVE_VERSION, unlocked: [FIRST_LEVEL], best: {}, seenCutscenes: [], settings: { ...DEFAULT_SETTINGS } };
}

// ------------------------------------------------------------ validation

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, min: number, max: number, dflt: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : dflt;

function idList<T extends string>(v: unknown, allowed: readonly T[]): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const x of v) if (typeof x === 'string' && (allowed as readonly string[]).includes(x) && !out.includes(x as T)) out.push(x as T);
  return out;
}

function parseBest(v: unknown): LevelBest | null {
  if (!isObj(v)) return null;
  const timeSec = num(v.timeSec, 0, Number.MAX_SAFE_INTEGER, NaN);
  if (!Number.isFinite(timeSec)) return null;
  return { timeSec, orbs: Math.floor(num(v.orbs, 0, 1e6, 0)), score: Math.floor(num(v.score, 0, Number.MAX_SAFE_INTEGER, 0)) };
}

function parseSettings(v: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  if (!isObj(v)) return { ...d };
  const tc = v.touchControls;
  return {
    musicVolume: num(v.musicVolume, 0, 1, d.musicVolume),
    sfxVolume: num(v.sfxVolume, 0, 1, d.sfxVolume),
    reducedMotion: typeof v.reducedMotion === 'boolean' ? v.reducedMotion : d.reducedMotion,
    touchControls: tc === 'auto' || tc === 'on' || tc === 'off' ? tc : d.touchControls,
    debugOverlay: typeof v.debugOverlay === 'boolean' ? v.debugOverlay : d.debugOverlay,
    swapEngineButtons: typeof v.swapEngineButtons === 'boolean' ? v.swapEngineButtons : d.swapEngineButtons,
    showFps: typeof v.showFps === 'boolean' ? v.showFps : d.showFps,
    lowRes: typeof v.lowRes === 'boolean' ? v.lowRes : d.lowRes,
    steering: v.steering === 'direct' || v.steering === 'engines' || v.steering === 'joystick' ? v.steering : d.steering,
    showMinimap: typeof v.showMinimap === 'boolean' ? v.showMinimap : d.showMinimap,
  };
}

/**
 * Validate arbitrary (older / partial / hand-edited) data into a SaveState.
 * Returns null when `raw` isn't a save object at all.
 */
export function parseSave(raw: unknown): SaveState | null {
  if (!isObj(raw)) return null;
  const unlocked = idList(raw.unlocked, ALL_LEVEL_IDS);
  if (!unlocked.includes(FIRST_LEVEL)) unlocked.unshift(FIRST_LEVEL);
  const best: SaveState['best'] = {};
  if (isObj(raw.best)) {
    for (const id of ALL_LEVEL_IDS) {
      const b = parseBest(raw.best[id]);
      if (b) best[id] = b;
    }
  }
  // A completed level always unlocks its successor (repairs partial saves).
  for (const id of Object.keys(best) as LevelId[]) {
    const n = nextStoryLevel(id);
    if (n && !unlocked.includes(n)) unlocked.push(n);
  }
  return {
    version: SAVE_VERSION,
    unlocked,
    best,
    seenCutscenes: idList(raw.seenCutscenes, CUTSCENE_IDS),
    settings: parseSettings(raw.settings),
  };
}

// ------------------------------------------------------------ pure updates

/** Record a level result: bests (per field) + unlock the next story level. */
export function recordResult(save: SaveState, levelId: LevelId, outcome: LevelOutcome): SaveState {
  if (outcome.kind !== 'complete') return save;
  const prev = save.best[levelId];
  const best: LevelBest = prev
    ? { timeSec: Math.min(prev.timeSec, outcome.timeSec), orbs: Math.max(prev.orbs, outcome.orbs), score: Math.max(prev.score, outcome.score) }
    : { timeSec: outcome.timeSec, orbs: outcome.orbs, score: outcome.score };
  const next = nextStoryLevel(levelId);
  const unlocked = next && !save.unlocked.includes(next) ? [...save.unlocked, next] : save.unlocked;
  return { ...save, unlocked, best: { ...save.best, [levelId]: best } };
}

export function markCutsceneSeen(save: SaveState, id: CutsceneId): SaveState {
  return save.seenCutscenes.includes(id) ? save : { ...save, seenCutscenes: [...save.seenCutscenes, id] };
}

// ------------------------------------------------------------ storage

function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // e.g. SecurityError when storage is disabled
  }
}

export interface LoadResult {
  save: SaveState;
  /** 'ok' = read fine, 'empty' = no save yet, 'corrupt' = recovered with defaults, 'unavailable' = storage threw. */
  status: 'ok' | 'empty' | 'corrupt' | 'unavailable';
}

export function loadSave(storage: StorageLike | null, key = SAVE_STORAGE_KEY): LoadResult {
  if (!storage) return { save: defaultSave(), status: 'unavailable' };
  let text: string | null;
  try {
    text = storage.getItem(key);
  } catch {
    return { save: defaultSave(), status: 'unavailable' };
  }
  if (text === null) return { save: defaultSave(), status: 'empty' };
  let parsed: SaveState | null = null;
  try {
    parsed = parseSave(JSON.parse(text));
  } catch {
    parsed = null;
  }
  if (parsed) return { save: parsed, status: 'ok' };
  try {
    storage.setItem(key + CORRUPT_SUFFIX, text);
  } catch {
    /* best effort */
  }
  return { save: defaultSave(), status: 'corrupt' };
}

/** Returns false when the write failed (the in-memory save stays valid). */
export function writeSave(storage: StorageLike | null, save: SaveState, key = SAVE_STORAGE_KEY): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

/** The game's save: in memory, written through to storage on every change. */
export class SaveStore {
  private _state: SaveState;
  readonly loadStatus: LoadResult['status'];
  private readonly listeners = new Set<(s: SaveState) => void>();

  constructor(
    private readonly storage: StorageLike | null = browserStorage(),
    private readonly key = SAVE_STORAGE_KEY,
  ) {
    const r = loadSave(storage, key);
    this._state = r.save;
    this.loadStatus = r.status;
  }

  get state(): SaveState {
    return this._state;
  }

  /** Apply a pure update, persist, notify. */
  update(fn: (s: SaveState) => SaveState): SaveState {
    const next = fn(this._state);
    if (next === this._state) return next;
    this._state = next;
    writeSave(this.storage, next, this.key);
    this.listeners.forEach((l) => l(next));
    return next;
  }

  recordResult(levelId: LevelId, outcome: LevelOutcome): SaveState {
    return this.update((s) => recordResult(s, levelId, outcome));
  }

  markCutsceneSeen(id: CutsceneId): SaveState {
    return this.update((s) => markCutsceneSeen(s, id));
  }

  setSettings(patch: Partial<Settings>): SaveState {
    return this.update((s) => ({ ...s, settings: parseSettings({ ...s.settings, ...patch }) }));
  }

  /** Wipe progress (keeps settings). */
  resetProgress(): SaveState {
    return this.update((s) => ({ ...defaultSave(), settings: s.settings }));
  }

  onChange(fn: (s: SaveState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

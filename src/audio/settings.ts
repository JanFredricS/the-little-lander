/** Mute + volume settings, persisted to localStorage (every access guarded). */

export interface AudioSettings {
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
}

export const DEFAULT_SETTINGS: Readonly<AudioSettings> = { master: 0.8, music: 0.55, sfx: 0.85, muted: false };

export const SETTINGS_KEY = 'littleLander.audio.v1';

/** The subset of Storage we use (tests pass a Map-backed fake). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function vol(v: unknown, dflt: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : dflt;
}

/** Browser localStorage or null (private mode / blocked / SSR). */
export function defaultStorage(): StorageLike | null {
  try {
    const s = (globalThis as { localStorage?: Storage }).localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

export function loadSettings(storage: StorageLike | null): AudioSettings {
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const p = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      master: vol(p.master, DEFAULT_SETTINGS.master),
      music: vol(p.music, DEFAULT_SETTINGS.music),
      sfx: vol(p.sfx, DEFAULT_SETTINGS.sfx),
      muted: typeof p.muted === 'boolean' ? p.muted : DEFAULT_SETTINGS.muted,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(storage: StorageLike | null, s: AudioSettings): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // quota / blocked storage: settings just don't persist
  }
}

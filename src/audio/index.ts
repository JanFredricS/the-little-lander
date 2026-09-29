/**
 * S5 audio public surface. `getAudio()` returns the app-wide engine
 * (WebAudio driver, localStorage settings); it is inert until the first
 * user gesture unlocks the context.
 */

import { AudioEngine } from './engine';
import { defaultStorage } from './settings';
import { WebAudioDriver } from './webDriver';

export { AudioEngine, type VolumeChannel } from './engine';
export type { AudioSettings } from './settings';
export { SFX_IDS, type SfxId, type SfxOpts } from './sfx';
export { MOOD_IDS, MOODS, type MoodId } from './music';

let engine: AudioEngine | null = null;

/** The shared engine; binds gesture unlock + visibility suspend on first call (browser only). */
export function getAudio(): AudioEngine {
  if (!engine) {
    engine = new AudioEngine(new WebAudioDriver(), { storage: defaultStorage() });
    if (typeof window !== 'undefined') engine.bindGestures(window);
    if (typeof document !== 'undefined') engine.bindVisibility(document);
  }
  return engine;
}

/**
 * AudioEngine: mixer (master/music/sfx), persisted settings, autoplay
 * unlock on first gesture, visibility suspend, GameEvent wiring, thruster
 * loops and the music sequencer with crossfades.
 *
 * Other slices talk to it through:
 *   engine.handle(event)      — the GameEvent stream (app wiring)
 *   engine.onScreen(state)    — title / cutscene underscore, pause ducking
 *   engine.play('uiMove')     — UI / dialogue blips (S3, S4)
 *   engine.setVolume / setMuted / toggleMute / settings — options menu (S4)
 */

import type { GameEvent, ScreenState } from '../contracts';
import type { AudioDriver } from './driver';
import { cuesFor } from './eventMap';
import { MOODS, type MoodId, Sequencer } from './music';
import { type AudioSettings, loadSettings, saveSettings, type StorageLike } from './settings';
import { playSfx, SFX_MIN_GAP, type SfxId, type SfxOpts } from './sfx';
import { Thrusters } from './thrusters';
import { clamp01, hashString } from './util';

export type VolumeChannel = 'master' | 'music' | 'sfx';

export interface AudioEngineOptions {
  storage?: StorageLike | null;
  /** Base seed for music (combined with mood / level). */
  musicSeed?: number;
  /** Crossfade seconds between moods. */
  crossfade?: number;
  /** Scheduler timer; tests pass false and call tick() by hand. */
  autoTick?: boolean;
}

/** Music lookahead horizon (s) and timer period (ms). */
const LOOKAHEAD = 0.15;
const TICK_MS = 25;
const DUCK = 0.35;

/** DOM events that count as a user gesture for the autoplay policy. */
export const GESTURE_EVENTS = ['pointerdown', 'mousedown', 'touchstart', 'touchend', 'keydown'] as const;

export class AudioEngine {
  private _settings: AudioSettings;
  private readonly storage: StorageLike | null;
  readonly thrusters: Thrusters;
  private seqs: Sequencer[] = [];
  private mood: MoodId | null = null;
  private moodSeed = 0;
  private tension = 0;
  private ducked = false;
  private hidden = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly lastPlayed = new Map<SfxId, number>();
  private readonly cleanups: (() => void)[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly driver: AudioDriver,
    private readonly opts: AudioEngineOptions = {},
  ) {
    this.storage = opts.storage ?? null;
    this._settings = loadSettings(this.storage);
    this.thrusters = new Thrusters(driver);
    this.applyGains(0);
  }

  // ------------------------------------------------------------ lifecycle

  get running(): boolean {
    return this.driver.state === 'running';
  }

  /** Start / resume audio. Must run inside a user gesture the first time. */
  async unlock(): Promise<void> {
    if (this.hidden) return;
    try {
      await this.driver.resume();
    } catch {
      return; // not allowed yet; the next gesture retries
    }
    if (!this.running) return;
    this.applyGains(0);
    if (this.opts.autoTick !== false && !this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    if (this.mood && this.seqs.length === 0) this.startSeq(this.mood, this.moodSeed, 0.6);
    this.tick();
    this.emitChange();
  }

  /** Unlock on the first pointer / touch / key gesture on `target` (window). */
  bindGestures(target: EventTarget): void {
    const handler = () => {
      void this.unlock().then(() => {
        if (this.running) off();
      });
    };
    const off = () => GESTURE_EVENTS.forEach((t) => target.removeEventListener(t, handler, true));
    GESTURE_EVENTS.forEach((t) => target.addEventListener(t, handler, { capture: true, passive: true }));
    this.cleanups.push(off);
  }

  /** Suspend the context while the tab is hidden; resume when visible again. */
  bindVisibility(doc: Document): void {
    const onVis = () => this.setHidden(doc.visibilityState === 'hidden');
    doc.addEventListener('visibilitychange', onVis);
    this.cleanups.push(() => doc.removeEventListener('visibilitychange', onVis));
  }

  setHidden(hidden: boolean): void {
    if (hidden === this.hidden) return;
    const wasRunning = this.running || this.driver.state === 'suspended';
    this.hidden = hidden;
    if (hidden) {
      this.thrusters.stopAll();
      void this.driver.suspend();
    } else if (wasRunning && this.driver.state !== 'uninit') {
      void this.unlock();
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.thrusters.stopAll();
    this.cleanups.splice(0).forEach((c) => c());
  }

  /** Scheduler tick: render music up to the lookahead horizon. */
  tick(): void {
    if (!this.running) return;
    const now = this.driver.now();
    for (const s of this.seqs) {
      s.tension = this.tension;
      s.schedule(now + LOOKAHEAD, now);
    }
    this.seqs = this.seqs.filter((s) => !s.isSilentAfter(now));
  }

  // ------------------------------------------------------------ settings

  get settings(): Readonly<AudioSettings> {
    return this._settings;
  }

  setVolume(ch: VolumeChannel, v: number): void {
    this._settings = { ...this._settings, [ch]: clamp01(v) };
    this.persist();
  }

  setMuted(muted: boolean): void {
    this._settings = { ...this._settings, muted };
    this.persist();
  }

  toggleMute(): boolean {
    this.setMuted(!this._settings.muted);
    return this._settings.muted;
  }

  /** Called on any settings / state change (options UI, audiolab). */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emitChange(): void {
    this.listeners.forEach((l) => l());
  }

  private persist(): void {
    saveSettings(this.storage, this._settings);
    this.applyGains();
    this.emitChange();
  }

  private applyGains(ramp = 0.05): void {
    const s = this._settings;
    this.driver.setGain('master', s.muted ? 0 : s.master, ramp);
    this.driver.setGain('music', s.music * (this.ducked ? DUCK : 1), ramp);
    this.driver.setGain('sfx', s.sfx, ramp);
  }

  // ------------------------------------------------------------ music

  get currentMood(): MoodId | null {
    return this.mood;
  }

  get currentTension(): number {
    return this.tension;
  }

  /** Switch music mood with a crossfade. seed defaults to a per-mood seed. */
  setMood(mood: MoodId | null, seed?: number): void {
    const s = seed ?? hashString(mood ?? '') ^ (this.opts.musicSeed ?? 1);
    if (mood === this.mood && s === this.moodSeed) return;
    this.mood = mood;
    this.moodSeed = s;
    if (mood !== 'asteroid') this.tension = 0;
    const fade = this.opts.crossfade ?? 1.2;
    if (!this.running) {
      this.seqs = [];
      this.emitChange();
      return;
    }
    const now = this.driver.now();
    for (const q of this.seqs) q.fadeTo(0, now, fade);
    if (mood) this.startSeq(mood, s, fade);
    this.tick();
    this.emitChange();
  }

  private startSeq(mood: MoodId, seed: number, fadeIn: number): void {
    const q = new Sequencer(this.driver, mood, seed, this.driver.now() + 0.05, fadeIn);
    q.tension = this.tension;
    this.seqs.push(q);
  }

  /** Asteroid accelerando: 0..1 (fed from gravityChanged.rampProgress). */
  setTension(t: number): void {
    this.tension = clamp01(t);
  }

  /** Active sequencers (audiolab readout / tests). */
  get sequencers(): readonly Sequencer[] {
    return this.seqs;
  }

  // ------------------------------------------------------------ screens

  /** Screen-state hook: title / cutscene underscore and pause ducking. */
  onScreen(state: ScreenState): void {
    const duck = state.id === 'paused';
    if (duck !== this.ducked) {
      this.ducked = duck;
      this.applyGains(0.25);
    }
    switch (state.id) {
      case 'title':
      case 'levelSelect':
        this.thrusters.stopAll();
        this.setMood('title');
        break;
      case 'cutscene':
        this.thrusters.stopAll();
        this.setMood('cutscene', hashString(state.cutsceneId));
        break;
      case 'paused':
      case 'results':
        this.thrusters.stopAll();
        break;
      default:
        break; // playing: mood comes from levelStarted
    }
  }

  // ------------------------------------------------------------ events

  handle(e: GameEvent): void {
    switch (e.type) {
      case 'levelStarted':
        this.thrusters.stopAll();
        this.thrusters.setMode(e.mode);
        this.tension = 0;
        this.setMood(e.themeId, hashString(e.levelId) ^ (this.opts.musicSeed ?? 1));
        break;
      case 'vesselModeChanged':
        this.thrusters.setMode(e.to);
        break;
      case 'enginesChanged':
        this.thrusters.update(e); // muted = master gain 0, so loops resume audibly on unmute
        break;
      case 'gravityChanged':
        if (e.rampProgress !== undefined) this.setTension(e.rampProgress);
        break;
      case 'crash':
      case 'levelComplete':
      case 'levelFailed':
        this.thrusters.stopAll();
        break;
      default:
        break;
    }
    for (const c of cuesFor(e)) this.play(c.id, c.opts);
  }

  /** Fire a one-shot SFX now. Returns false when dropped (locked, muted, throttled). */
  play(id: SfxId, opts?: SfxOpts): boolean {
    if (!this.running || this._settings.muted) return false;
    const now = this.driver.now();
    const gap = SFX_MIN_GAP[id];
    const last = this.lastPlayed.get(id);
    if (gap !== undefined && last !== undefined && now - last < gap) return false;
    this.lastPlayed.set(id, now);
    playSfx(this.driver, id, now + 0.005, opts);
    return true;
  }
}

export { MOODS };

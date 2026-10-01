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
/** Seconds a fully faded sequencer is kept after its fade ends (release / echo tails). */
const TAIL = 0.5;

/**
 * DOM events that count as a user gesture for the autoplay policy. iOS Safari only
 * treats the END of a touch (touchend / pointerup / click) as an activation, so
 * those must be here; the down events let desktop unlock a little earlier.
 */
export const GESTURE_EVENTS = ['pointerdown', 'mousedown', 'touchstart', 'touchend', 'pointerup', 'mouseup', 'click', 'keydown'] as const;
/** Context state transitions kept for the debug readout. */
const LOG_SIZE = 3;
/** The audio debug line stays within this many characters (the FPS corner; 640 px view). */
export const AUDIO_DIAG_MAX = 70;
const SHORT_STATE: Record<string, string> = { running: 'run', suspended: 'susp', uninit: 'none' };

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
  private unlocked = false;
  private queue: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly lastPlayed = new Map<SfxId, number>();
  private readonly cleanups: (() => void)[] = [];
  private readonly listeners = new Set<() => void>();
  /** A gesture's unlock is queued and has not run yet (one at a time, however many events arrive). */
  private gestureQueued = false;
  /** Recent context state transitions (debug readout: engine.diag). */
  private readonly stateLog: string[] = [];
  private lastState = '';

  constructor(
    readonly driver: AudioDriver,
    private readonly opts: AudioEngineOptions = {},
  ) {
    this.storage = opts.storage ?? null;
    this._settings = loadSettings(this.storage);
    this.thrusters = new Thrusters(driver);
    this.applyGains(0);
    this.driver.setPlayback?.(!this._settings.muted);
    const offState = driver.onStateChange?.(() => this.onDriverState());
    if (offState) this.cleanups.push(offState);
  }

  /** One line for the FPS / debug readout: driver state + recent transitions. */
  get diag(): string {
    const d = this.driver.diag ?? `ctx:${this.driver.state}`;
    const line = `AUDIO ${d}${this.unlocked ? '' : ' TAP'}${this.stateLog.length ? ` | ${this.stateLog.join('>')}` : ''}`;
    return line.length > AUDIO_DIAG_MAX ? line.slice(0, AUDIO_DIAG_MAX) : line;
  }

  private noteState(): void {
    const s = this.driver.state;
    if (s === this.lastState) return;
    this.lastState = s;
    this.stateLog.push(SHORT_STATE[s] ?? s);
    if (this.stateLog.length > LOG_SIZE) this.stateLog.shift();
  }

  /**
   * The context changed state by itself: a pending resume() landed late, or iOS
   * interrupted / restored it (call, Siri, ring switch, backgrounding).
   */
  private onDriverState(): void {
    this.noteState();
    this.emitChange();
    if (this.running && this.hidden) {
      // a gesture's resume() landed after the hide path ran: suspend again
      void this.enqueue(() => this.reconcile(false));
    } else if (this.running && this.unlocked) {
      // came back running on its own while visible (iOS interruption ended): held engines sound again
      this.applyGains(0);
      this.thrusters.relight();
      if (!this.timer && this.opts.autoTick !== false) void this.enqueue(() => this.reconcile(false));
    } else if (!this.running && !this.hidden) {
      // dropped out while visible (interrupted): engines go quiet; the next gesture unlocks again
      this.thrusters.silence();
    }
  }

  // ------------------------------------------------------------ lifecycle

  get running(): boolean {
    return this.driver.state === 'running';
  }

  /**
   * Start / resume audio. Must run inside a user gesture the first time.
   * All context state changes (unlock, hide, show) run through one serial
   * queue and act on the LATEST desired visibility, so a fast
   * hide -> show can never end with a late suspend() silencing a visible page.
   */
  unlock(): Promise<void> {
    return this.enqueue(() => this.reconcile(true));
  }

  private enqueue(op: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(op, op);
    return this.queue;
  }

  /** Bring the context in line with `hidden`. `gesture` = allowed to create/unlock it. */
  private async reconcile(gesture: boolean): Promise<void> {
    if (this.hidden) {
      this.thrusters.silence(); // keeps the engine flags so the show path can relight them
      // always (once created): the state may still read 'suspended' while a gesture's resume() lands
      if (this.driver.state !== 'uninit') await this.driver.suspend();
      return;
    }
    if (!gesture && !this.unlocked) return; // never unlocked: wait for a gesture
    try {
      await this.driver.resume();
    } catch {
      return; // not allowed yet; the next gesture retries
    }
    // resume() resolved: the gesture unlock succeeded. Record it before any
    // bail-out so a later visibility restore may resume without a new gesture.
    this.unlocked = true;
    this.noteState();
    if (this.hidden || !this.running) return; // hidden again meanwhile: the queued hide handles it
    this.applyGains(0);
    if (this.opts.autoTick !== false && !this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    this.thrusters.relight(); // engines that were lit when the tab was hidden
    if (this.mood && this.seqs.length === 0) this.startSeq(this.mood, this.moodSeed, 0.6);
    this.tick();
    this.emitChange();
  }

  /**
   * Unlock on pointer / touch / key gestures on `target` (window). The listeners
   * stay bound for the page's life: after an iOS interruption (call, Siri,
   * backgrounding) the context needs a NEW gesture, so every gesture checks
   * (cheaply) and re-unlocks while the driver still needs one. The driver's
   * gestureUnlock() runs synchronously in the handler (iOS only honours
   * resume() / play() inside the gesture's own call stack); the engine's
   * bookkeeping follows through the serial queue.
   */
  bindGestures(target: EventTarget): void {
    const handler = () => this.gesture();
    const off = () => GESTURE_EVENTS.forEach((t) => target.removeEventListener(t, handler, true));
    GESTURE_EVENTS.forEach((t) => target.addEventListener(t, handler, { capture: true, passive: true }));
    this.cleanups.push(off);
  }

  /** One user gesture (also callable directly from the input layer). No-op while fully unlocked. */
  gesture(): void {
    if (this.hidden) return;
    if (this.unlocked && this.running && !(this.driver.needsGesture ?? false)) return;
    this.driver.gestureUnlock?.(); // synchronous: still inside the gesture
    // context already running (only the iOS keep-alive needed a retry): no engine bookkeeping to redo
    if (this.unlocked && this.running) return;
    if (this.gestureQueued) return;
    this.gestureQueued = true;
    void this.enqueue(async () => {
      this.gestureQueued = false;
      await this.reconcile(true);
    });
  }

  /**
   * Suspend the context while the tab is hidden; resume when visible again.
   * iOS: pagehide / pageshow (bfcache) too, since visibilitychange is not always sent.
   */
  bindVisibility(doc: Document, win?: EventTarget): void {
    const onVis = () => this.setHidden(doc.visibilityState === 'hidden');
    const onHide = () => this.setHidden(true);
    doc.addEventListener('visibilitychange', onVis);
    win?.addEventListener('pagehide', onHide);
    win?.addEventListener('pageshow', onVis);
    this.cleanups.push(() => {
      doc.removeEventListener('visibilitychange', onVis);
      win?.removeEventListener('pagehide', onHide);
      win?.removeEventListener('pageshow', onVis);
    });
  }

  setHidden(hidden: boolean): Promise<void> {
    if (hidden === this.hidden) return this.queue;
    this.hidden = hidden;
    if (hidden) this.thrusters.silence(); // immediately, not after queued ops
    return this.enqueue(() => this.reconcile(false));
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.thrusters.stopAll();
    this.cleanups.splice(0).forEach((c) => c());
    this.driver.dispose?.();
  }

  /** Scheduler tick: render music up to the lookahead horizon. */
  tick(): void {
    if (!this.running) return;
    const now = this.driver.now();
    for (const s of this.seqs) {
      s.tension = this.tension;
      s.schedule(now + LOOKAHEAD, now);
    }
    this.seqs = this.seqs.filter((s) => {
      if (!s.isSilentAfter(now - TAIL)) return true; // alive until fade end + release/echo tail
      s.dispose();
      return false;
    });
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
    // muted: give the media session back (the player's own music keeps playing); unmute (a gesture) claims it again
    this.driver.setPlayback?.(!this._settings.muted);
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
      this.seqs.forEach((q) => q.dispose());
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

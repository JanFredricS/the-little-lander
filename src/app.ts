/**
 * Game shell: owns the Pixi host, the fixed-step frame loop, input sources,
 * the screen state machine (src/shell/state.ts) and the active level
 * session. Menus, HUD, touch controls and the rotate hint live in the UI
 * layer (src/ui/gameUi.ts); story flow (cutscenes, unlocks, save) comes from
 * src/story (S3). UI actions pass through uiDispatch(), which routes the
 * story-relevant ones (level pick, results NEXT, title CONTINUE) via
 * src/story/flow.ts so the default cutscene hooks and chains apply.
 */

import { FIXED_DT, VESSEL_MODES } from './contracts';
import type { ArtApi, CutsceneId, CutsceneScript, GameEvent, InputSampleContext, LevelId, ScreenAction, ScreenState, StillId } from './contracts';
import { createArt, hasPreload } from './art/art';
import { STILL_IDS } from './art/stills';
import { LevelSession } from './game/session';
import { getLevel, LEVELS } from './levels/registry';
import { loadPhysics } from './physics/engine';
import { createPixiHost, type PixiHost } from './render/pixiApp';
import { LevelView } from './render/levelView';
import { FrameLoop, type PauseCause } from './shell/clock';
import { emptyFrame, InputMapper, KeyboardSource, PointerSource, VirtualControlsSource } from './shell/input';
import { INITIAL_STATE, isResume, transition } from './shell/state';
import { playCutscene, type CutscenePlayerHandle } from './story/cutscenePlayer';
import { continuePlan, continueTarget, isUnlocked, modeSwitchCutscene, selectLevelAction } from './story/flow';
import { SaveStore } from './story/save';
import { getCutscene } from './story/scripts';
import { GameUi, type GameUiOptions } from './ui/gameUi';
import type { StoryContext } from './ui/screens';

export interface AppOptions {
  art?: ArtApi;
  /** Game events (HUD/audio hooks, debugging). */
  onEvent?: (e: GameEvent) => void;
  /** Screen-state changes (audio mood / ducking, analytics). */
  onScreen?: (s: ScreenState) => void;
  /** Progress store (default: localStorage-backed). */
  save?: SaveStore;
  /**
   * UI options (debug levels in level select, touch preference override).
   * Save access and touch-preference persistence default to `save`.
   */
  ui?: Pick<GameUiOptions, 'showDebugLevels' | 'touchPref' | 'onTouchPrefChange' | 'swapEngineButtons' | 'onSwapEngineButtonsChange' | 'save'>;
}

/**
 * Seconds a failed level (crash, hull destroyed, ...) stays on screen before
 * the results panel covers it, so the explosion and smoke play out.
 * Completions go to results on the same tick.
 */
export const CRASH_RESULTS_DELAY_SEC = 0.9;

/** Unique stills of a cutscene in shot order (current shot first). */
export function cutsceneStills(script: CutsceneScript, fromShot = 0): StillId[] {
  const shots = [...script.shots.slice(fromShot), ...script.shots.slice(0, fromShot)];
  return [...new Set(shots.map((s) => s.still))];
}

export class App {
  state: ScreenState = INITIAL_STATE;
  readonly input = new InputMapper();
  /** On-screen touch controls feed this (UI slice). */
  readonly virtual = new VirtualControlsSource('touch');
  private pixi!: PixiHost;
  private loop!: FrameLoop;
  private readonly art: ArtApi;
  readonly save: SaveStore;
  /** Full-screen cutscene overlay (screen `cutscene`, or a mid-level one). */
  private cutscene: CutscenePlayerHandle | null = null;
  /** True while a mid-level (mode switch) cutscene pauses the level. */
  private inlineCutscene = false;
  /** Extra scripts to play inside the next `cutscene` screen (after the one it names). */
  private cutsceneChain: CutsceneId[] = [];
  private session: LevelSession | null = null;
  private view: LevelView | null = null;
  /** HUD, menus, touch controls (created in start()). */
  ui!: GameUi;
  private levelToken = 0;
  /** Bumped by stopCutscene(): cancels a cutscene still waiting for its first still. */
  private cutsceneToken = 0;
  /** Level art warmup (aborted by endSession). */
  private levelWarm: AbortController | null = null;
  /** Cutscene still warmup (aborted by stopCutscene). */
  private stillWarm: AbortController | null = null;
  private clearInputOnNextStep = false;
  /** Fixed steps left before the ended session's results show (null = not ended yet). */
  private endHoldSteps: number | null = null;
  private readonly unbind: (() => void)[] = [];

  constructor(
    private readonly host: HTMLElement,
    private readonly options: AppOptions = {},
  ) {
    this.art = options.art ?? createArt();
    this.save = options.save ?? new SaveStore();
  }

  async start(initialActions: ScreenAction[] = []): Promise<void> {
    this.pixi = await createPixiHost(this.host);
    this.pixi.app.ticker.stop(); // we render from our own loop

    // Input: keyboard FIRST so its listeners run before the menu handler below.
    this.input.add(new KeyboardSource(window));
    this.input.add(this.virtual);
    this.input.add(new PointerSource(this.pixi.canvas));
    window.addEventListener('keydown', this.onDebugKey);
    this.unbind.push(() => window.removeEventListener('keydown', this.onDebugKey));

    // Explicit options win, but an `undefined` (e.g. no ?touch=) must not mask the saved preference.
    const uiOpts = Object.fromEntries(Object.entries(this.options.ui ?? {}).filter(([, v]) => v !== undefined));
    this.ui = new GameUi({
      host: this.host,
      pixi: this.pixi,
      art: this.art,
      virtual: this.virtual,
      dispatch: (a) => this.uiDispatch(a),
      levels: () => LEVELS,
      save: () => this.save.state,
      touchPref: this.save.state.settings.touchControls,
      onTouchPrefChange: (p) => this.save.setSettings({ touchControls: p }),
      swapEngineButtons: this.save.state.settings.swapEngineButtons,
      onSwapEngineButtonsChange: (swap) => this.save.setSettings({ swapEngineButtons: swap }),
      story: () => this.storyContext(),
      onContinueStory: () => this.titleContinue(),
      ...uiOpts,
    });

    this.loop = new FrameLoop({
      step: () => this.step(),
      render: (alpha) => this.render(alpha),
      onPauseChange: (paused, cause) => this.onPauseChange(paused, cause),
    });
    this.loop.bindVisibility();
    this.loop.start();

    this.ui.setLoading(true);
    await loadPhysics();
    for (const a of [{ type: 'booted' } as const, ...initialActions]) this.dispatch(a);
  }

  dispatch(action: ScreenAction): void {
    const prev = this.state;
    const next = transition(prev, action);
    if (next === prev) return;
    this.state = next;
    this.options.onScreen?.(next);
    this.enter(prev, action, next);
  }

  destroy(): void {
    this.loop.stop();
    this.unbind.forEach((u) => u());
    this.stopCutscene();
    this.input.dispose();
    this.endSession();
    this.ui.destroy();
    this.pixi.destroy();
  }

  // ------------------------------------------------------------ screens

  private enter(prev: ScreenState, action: ScreenAction, next: ScreenState): void {
    this.stopCutscene();
    const chain = this.cutsceneChain;
    this.cutsceneChain = [];
    if (next.id !== 'playing' && next.id !== 'paused' && next.id !== 'results') this.endSession();
    if (next.id === 'paused') this.loop.setPaused(true);
    // Record before the UI reads the save (results / level select show best + unlocks).
    if (next.id === 'results' && action.type === 'levelEnded') this.save.recordResult(next.levelId, next.outcome);
    if (next.id === 'playing' && isResume(prev, action, next) && this.session) {
      this.ui.enter(next);
      this.clearInputOnNextStep = true;
      this.loop.setPaused(false);
      return;
    }
    if (next.id === 'playing') this.ui.setLoading(true);
    this.ui.enter(next);
    if (next.id === 'cutscene') this.playCutsceneChain([next.cutsceneId, ...chain]);
    else if (next.id === 'playing') void this.startLevel(next.levelId);
  }

  private async startLevel(levelId: LevelId): Promise<void> {
    this.endSession(); // bumps levelToken + aborts warmups, cancelling any in-flight load
    const token = this.levelToken;
    const warm = (this.levelWarm = new AbortController());
    const spec = getLevel(levelId);
    if (!spec) {
      this.ui.setLoading(false);
      this.dispatch({ type: 'levelEnded', outcome: { kind: 'failed', cause: 'outOfBounds' } });
      return;
    }
    // Pre-generate the theme's art during the loading screen, not mid-flight.
    if (hasPreload(this.art)) await this.art.warmup(spec.themeId, { signal: warm.signal });
    if (token !== this.levelToken || warm.signal.aborted) return;
    const session = await LevelSession.create(spec);
    if (token !== this.levelToken || this.state.id !== 'playing') {
      session.destroy();
      return;
    }
    this.session = session;
    session.on((e) => this.ui.onEvent(e));
    if (this.options.onEvent) session.on(this.options.onEvent);
    const midCutscene = modeSwitchCutscene(levelId, spec);
    if (midCutscene) {
      // warm the mid-level cutscene's stills in background so the switch doesn't hitch
      if (hasPreload(this.art)) void this.art.warmupStills(cutsceneStills(getCutscene(midCutscene)), { signal: warm.signal });
      let played = false;
      session.on((e) => {
        if (e.type !== 'vesselModeChanged' || played) return;
        played = true;
        this.playInlineCutscene(midCutscene, session);
      });
    }
    this.view = new LevelView(session, this.art, { reducedMotion: this.save.state.settings.reducedMotion });
    this.pixi.app.stage.addChildAt(this.view.root, 0);
    this.ui.levelStarted(spec);
    session.start();
    this.clearInputOnNextStep = true;
    this.loop.setPaused(false);
  }

  private endSession(): void {
    this.levelToken++;
    this.endHoldSteps = null;
    this.levelWarm?.abort();
    this.levelWarm = null;
    if (this.inlineCutscene) this.stopCutscene();
    this.view?.destroy();
    this.view = null;
    this.session?.destroy();
    this.session = null;
  }

  // ------------------------------------------------------------ loop

  private step(): void {
    const s = this.session;
    if (!s || this.state.id !== 'playing') return;
    if (s.outcome) return this.holdThenEnd(s); // the wreck plays out; no more input
    if (this.clearInputOnNextStep) {
      this.input.clear();
      this.clearInputOnNextStep = false;
    }
    const ctx: InputSampleContext = {
      mode: s.state.mode,
      vesselWorldPos: s.state.pos,
      clientToWorld: (cx, cy) => s.camera.viewToWorld(s.camera.position, this.pixi.clientToView(cx, cy)),
    };
    const frame = this.input.sample(ctx);
    if (frame.pause) {
      this.dispatch({ type: 'pause' });
      return;
    }
    this.ui.noteFrame(frame);
    if (this.ui.holdSimulation) return; // level-start controls card: wait for the first input
    s.step(frame);
    this.ui.tick(s.state, FIXED_DT);
    if (s.outcome) this.holdThenEnd(s);
  }

  /** After the session ends: count down CRASH_RESULTS_DELAY_SEC on failure (0 on completion), then results. */
  private holdThenEnd(s: LevelSession): void {
    const outcome = s.outcome!;
    this.endHoldSteps ??= outcome.kind === 'complete' ? 0 : Math.round(CRASH_RESULTS_DELAY_SEC / FIXED_DT);
    if (this.endHoldSteps-- > 0) {
      s.step(emptyFrame()); // ended session: only the camera settles
      return;
    }
    this.endHoldSteps = null;
    this.dispatch({ type: 'levelEnded', outcome });
  }

  private render(alpha: number): void {
    const now = performance.now();
    this.view?.render(alpha, now, this.loop.paused);
    this.ui.render(now);
    this.pixi.app.render();
  }

  private onPauseChange(paused: boolean, cause: PauseCause): void {
    this.input.clear();
    if (paused && cause !== 'manual' && this.state.id === 'playing' && !this.inlineCutscene) this.dispatch({ type: 'pause' });
  }

  /** Debug levels (physlab, testpad): 1-4 pick a vessel mode, M cycles (S1 LevelSession.requestModeSwitch). */
  private readonly onDebugKey = (e: KeyboardEvent): void => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const s = this.session;
    if (!s?.spec.debug || this.state.id !== 'playing' || this.inlineCutscene) return;
    const n = /^Digit([1-4])$/.exec(e.code);
    const next = n
      ? VESSEL_MODES[Number(n[1]) - 1]
      : e.code === 'KeyM'
        ? VESSEL_MODES[(VESSEL_MODES.indexOf(s.state.mode) + 1) % VESSEL_MODES.length]
        : undefined;
    if (next) s.requestModeSwitch(next);
  };

  // ------------------------------------------------------------ cutscenes

  /**
   * Play one script. Its first still (shot order) is generated before the
   * player appears — the cutscene screen shows LOADING until then — and the
   * rest of its stills, then all other stills, keep warming in background
   * time slices (aborted by the next stopCutscene()).
   */
  private playCutscene(id: CutsceneId, then: () => void, showLoading = false): void {
    this.stopCutscene();
    const token = this.cutsceneToken;
    const script = getCutscene(id);
    const ready = this.warmCutsceneStills(script);
    if (!ready) return this.startCutscenePlayer(id, script, then);
    if (showLoading) this.ui.setLoading(true);
    void ready.then(() => {
      if (token !== this.cutsceneToken) return;
      if (showLoading) this.ui.setLoading(false);
      this.startCutscenePlayer(id, script, then);
    });
  }

  /** Await the first still of `script`; warm the rest in background. Null when the art has no preload. */
  private warmCutsceneStills(script: CutsceneScript): Promise<void> | null {
    if (!hasPreload(this.art)) return null;
    const art = this.art;
    const ac = (this.stillWarm = new AbortController());
    const own = cutsceneStills(script);
    const rest = STILL_IDS.filter((s) => !own.includes(s));
    return art.warmupStills(own.slice(0, 1), { signal: ac.signal }).then(() => {
      if (!ac.signal.aborted) void art.warmupStills([...own.slice(1), ...rest], { signal: ac.signal });
    });
  }

  private startCutscenePlayer(id: CutsceneId, script: CutsceneScript, then: () => void): void {
    this.cutscene = playCutscene(this.host, script, {
      art: this.art,
      onDone: (skipped) => {
        this.cutscene = null;
        this.save.markCutsceneSeen(id);
        this.options.onEvent?.({ type: 'cutsceneDone', cutsceneId: id, skipped });
        then();
      },
    });
  }

  /** Play scripts back to back inside one `cutscene` screen, then leave it. */
  private playCutsceneChain(ids: CutsceneId[]): void {
    const [id, ...rest] = ids;
    if (!id) return this.dispatch({ type: 'cutsceneDone' });
    this.playCutscene(id, () => this.playCutsceneChain(rest), true);
  }

  private stopCutscene(): void {
    this.cutsceneToken++;
    this.stillWarm?.abort();
    this.stillWarm = null;
    this.cutscene?.destroy();
    this.cutscene = null;
    this.inlineCutscene = false;
  }

  /** Mid-level cutscene (LevelSpec.modeSwitch): the level pauses underneath, then resumes. */
  private playInlineCutscene(id: CutsceneId, session: LevelSession): void {
    this.loop.setPaused(true);
    this.playCutscene(id, () => {
      this.inlineCutscene = false;
      if (this.session !== session || this.state.id !== 'playing') return;
      this.clearInputOnNextStep = true;
      this.loop.setPaused(false);
    });
    this.inlineCutscene = true;
  }

  // ------------------------------------------------------------ story flow (UI actions)

  /** UI actions: story-relevant ones go through src/story/flow.ts, the rest straight to the state machine. */
  private uiDispatch(a: ScreenAction): void {
    if (a.type === 'selectLevel') return this.selectLevel(a.levelId);
    if (a.type === 'continue') return this.resultsContinue();
    this.dispatch(a);
  }

  private storyContext(): StoryContext {
    return {
      continueLevel: continueTarget(this.save.state, getLevel),
      after: (id) => {
        const plan = continuePlan(id, getLevel);
        return { next: plan.action.next, cutscenes: plan.cutscenes.length > 0 };
      },
    };
  }

  private selectLevel(id: LevelId): void {
    if (isUnlocked(this.save.state, id)) this.dispatch(selectLevelAction(id, getLevel));
  }

  /** Title CONTINUE: the story where the save left off, else level select. */
  private titleContinue(): void {
    const cont = continueTarget(this.save.state, getLevel);
    this.dispatch({ type: 'start' });
    if (cont) this.selectLevel(cont);
  }

  /** Results NEXT after a completed level: after/before cutscene chain, then the next level (or level select). */
  private resultsContinue(): void {
    if (this.state.id !== 'results' || this.state.outcome.kind !== 'complete') return;
    const plan = continuePlan(this.state.levelId, getLevel);
    this.cutsceneChain = plan.cutscenes.slice(1);
    this.dispatch(plan.action);
  }
}

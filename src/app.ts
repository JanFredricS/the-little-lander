/**
 * Game shell: owns the Pixi host, the fixed-step frame loop, input sources,
 * the screen state machine (src/shell/state.ts) and the active level
 * session. Menus, HUD, touch controls and the rotate hint live in the UI
 * layer (src/ui/gameUi.ts); cutscenes are a UI placeholder until S3 lands.
 */

import { FIXED_DT } from './contracts';
import type { ArtApi, GameEvent, InputSampleContext, LevelId, ScreenAction, ScreenState } from './contracts';
import { createStubArt } from './art/stubArt';
import { LevelSession } from './game/session';
import { getLevel, LEVELS } from './levels/registry';
import { loadPhysics } from './physics/engine';
import { createPixiHost, type PixiHost } from './render/pixiApp';
import { LevelView } from './render/levelView';
import { FrameLoop, type PauseCause } from './shell/clock';
import { InputMapper, KeyboardSource, PointerSource, VirtualControlsSource } from './shell/input';
import { INITIAL_STATE, isResume, transition } from './shell/state';
import { GameUi, type GameUiOptions } from './ui/gameUi';

export interface AppOptions {
  art?: ArtApi;
  /** Game events (HUD/audio hooks, debugging). */
  onEvent?: (e: GameEvent) => void;
  /** UI options (debug levels in level select, touch preference, save access). */
  ui?: Pick<GameUiOptions, 'showDebugLevels' | 'touchPref' | 'onTouchPrefChange' | 'save'>;
}

export class App {
  state: ScreenState = INITIAL_STATE;
  readonly input = new InputMapper();
  /** On-screen touch controls feed this (UI slice). */
  readonly virtual = new VirtualControlsSource('touch');
  private pixi!: PixiHost;
  private loop!: FrameLoop;
  private readonly art: ArtApi;
  private session: LevelSession | null = null;
  private view: LevelView | null = null;
  /** HUD, menus, touch controls (created in start()). */
  ui!: GameUi;
  private levelToken = 0;
  private clearInputOnNextStep = false;
  private readonly unbind: (() => void)[] = [];

  constructor(
    private readonly host: HTMLElement,
    private readonly options: AppOptions = {},
  ) {
    this.art = options.art ?? createStubArt();
  }

  async start(initialActions: ScreenAction[] = []): Promise<void> {
    this.pixi = await createPixiHost(this.host);
    this.pixi.app.ticker.stop(); // we render from our own loop

    // Input: keyboard FIRST so its listeners run before the menu handler below.
    this.input.add(new KeyboardSource(window));
    this.input.add(this.virtual);
    this.input.add(new PointerSource(this.pixi.canvas));

    this.ui = new GameUi({
      host: this.host,
      pixi: this.pixi,
      art: this.art,
      virtual: this.virtual,
      dispatch: (a) => this.dispatch(a),
      levels: () => LEVELS,
      ...this.options.ui,
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
    this.enter(prev, action, next);
  }

  destroy(): void {
    this.loop.stop();
    this.unbind.forEach((u) => u());
    this.input.dispose();
    this.endSession();
    this.ui.destroy();
    this.pixi.destroy();
  }

  // ------------------------------------------------------------ screens

  private enter(prev: ScreenState, action: ScreenAction, next: ScreenState): void {
    if (next.id !== 'playing' && next.id !== 'paused' && next.id !== 'results') this.endSession();
    if (next.id === 'paused') this.loop.setPaused(true);
    if (next.id === 'playing' && isResume(prev, action, next) && this.session) {
      this.ui.enter(next);
      this.clearInputOnNextStep = true;
      this.loop.setPaused(false);
      return;
    }
    if (next.id === 'playing') this.ui.setLoading(true);
    this.ui.enter(next);
    if (next.id === 'playing') void this.startLevel(next.levelId);
  }

  private async startLevel(levelId: LevelId): Promise<void> {
    this.endSession(); // bumps levelToken, cancelling any in-flight load
    const token = this.levelToken;
    const spec = getLevel(levelId);
    if (!spec) {
      this.ui.setLoading(false);
      this.dispatch({ type: 'levelEnded', outcome: { kind: 'failed', cause: 'outOfBounds' } });
      return;
    }
    const session = await LevelSession.create(spec);
    if (token !== this.levelToken || this.state.id !== 'playing') {
      session.destroy();
      return;
    }
    this.session = session;
    session.on((e) => this.ui.onEvent(e));
    if (this.options.onEvent) session.on(this.options.onEvent);
    this.view = new LevelView(session, this.art);
    this.pixi.app.stage.addChildAt(this.view.root, 0);
    this.ui.levelStarted(spec);
    session.start();
    this.clearInputOnNextStep = true;
    this.loop.setPaused(false);
  }

  private endSession(): void {
    this.levelToken++;
    this.view?.destroy();
    this.view = null;
    this.session?.destroy();
    this.session = null;
  }

  // ------------------------------------------------------------ loop

  private step(): void {
    const s = this.session;
    if (!s || this.state.id !== 'playing') return;
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
    if (s.outcome) this.dispatch({ type: 'levelEnded', outcome: s.outcome });
  }

  private render(alpha: number): void {
    const now = performance.now();
    this.view?.render(alpha, now, this.loop.paused);
    this.ui.render(now);
    this.pixi.app.render();
  }

  private onPauseChange(paused: boolean, cause: PauseCause): void {
    this.input.clear();
    if (paused && cause !== 'manual' && this.state.id === 'playing') this.dispatch({ type: 'pause' });
  }
}

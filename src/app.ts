/**
 * Game shell: owns the Pixi host, the fixed-step frame loop, input sources,
 * the screen state machine (src/shell/state.ts) and the active level
 * session. Menu screens are text placeholders until the UI slice (S4)
 * lands; story flow (cutscenes, unlocks, save) comes from src/story (S3).
 */

import { Container, Graphics, Text } from 'pixi.js';
import { VIEW_HEIGHT, VIEW_WIDTH } from './contracts';
import type { ArtApi, CutsceneId, GameEvent, InputSampleContext, LevelId, ScreenAction, ScreenState } from './contracts';
import { createStubArt } from './art/stubArt';
import { LevelSession } from './game/session';
import { getLevel, playableLevelIds } from './levels/registry';
import { loadPhysics } from './physics/engine';
import { createPixiHost, type PixiHost } from './render/pixiApp';
import { LevelView } from './render/levelView';
import { FrameLoop, type PauseCause } from './shell/clock';
import { InputMapper, KeyboardSource, PointerSource, VirtualControlsSource } from './shell/input';
import { INITIAL_STATE, isResume, transition } from './shell/state';
import { playCutscene, type CutscenePlayerHandle } from './story/cutscenePlayer';
import { continuePlan, continueTarget, isUnlocked, modeSwitchCutscene, selectLevelAction } from './story/flow';
import { SaveStore } from './story/save';
import { getCutscene } from './story/scripts';

export interface AppOptions {
  art?: ArtApi;
  /** Game events (HUD/audio hooks, debugging). */
  onEvent?: (e: GameEvent) => void;
  /** Progress store (default: localStorage-backed). */
  save?: SaveStore;
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
  private readonly overlay = new Container();
  private readonly overlayText = new Text({
    text: '',
    style: { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, fill: 0xd8dce8, align: 'center', lineHeight: 18 },
  });
  private levelToken = 0;
  private clearInputOnNextStep = false;
  private readonly unbind: (() => void)[] = [];

  constructor(
    private readonly host: HTMLElement,
    private readonly options: AppOptions = {},
  ) {
    this.art = options.art ?? createStubArt();
    this.save = options.save ?? new SaveStore();
  }

  async start(initialActions: ScreenAction[] = []): Promise<void> {
    this.pixi = await createPixiHost(this.host);
    this.pixi.app.ticker.stop(); // we render from our own loop

    // Input: keyboard FIRST so its listeners run before the menu handler below.
    this.input.add(new KeyboardSource(window));
    this.input.add(this.virtual);
    this.input.add(new PointerSource(this.pixi.canvas));

    const bg = new Graphics().rect(0, 0, VIEW_WIDTH, VIEW_HEIGHT).fill({ color: 0x000000, alpha: 0.55 });
    this.overlayText.anchor.set(0.5);
    this.overlayText.position.set(VIEW_WIDTH / 2, VIEW_HEIGHT / 2);
    this.overlay.addChild(bg, this.overlayText);
    this.pixi.app.stage.addChild(this.overlay);

    this.loop = new FrameLoop({
      step: () => this.step(),
      render: (alpha) => this.render(alpha),
      onPauseChange: (paused, cause) => this.onPauseChange(paused, cause),
    });
    this.loop.bindVisibility();
    this.loop.start();

    const onKey = (e: KeyboardEvent) => this.onMenuKey(e);
    const onTap = (e: PointerEvent) => this.onMenuTap(e);
    window.addEventListener('keydown', onKey);
    this.pixi.canvas.addEventListener('pointerdown', onTap);
    this.unbind.push(
      () => window.removeEventListener('keydown', onKey),
      () => this.pixi.canvas.removeEventListener('pointerdown', onTap),
    );

    this.showOverlay('Loading…');
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
    this.stopCutscene();
    this.input.dispose();
    this.endSession();
    this.pixi.destroy();
  }

  // ------------------------------------------------------------ screens

  private enter(prev: ScreenState, action: ScreenAction, next: ScreenState): void {
    this.stopCutscene();
    const chain = this.cutsceneChain;
    this.cutsceneChain = [];
    switch (next.id) {
      case 'boot':
        return this.showOverlay('Loading…');
      case 'title': {
        this.endSession();
        const cont = continueTarget(this.save.state, getLevel);
        const line = cont ? `Enter / tap: continue — ${getLevel(cont)?.title ?? cont}\nL: level select` : 'Enter / tap to start';
        return this.showOverlay(`THE LITTLE LANDER\n\n${line}`);
      }
      case 'levelSelect': {
        this.endSession();
        const save = this.save.state;
        const lines = this.levelIds().map((id, i) => {
          const best = save.best[id];
          const tag = !isUnlocked(save, id) ? '  [locked]' : best ? `  best ${best.timeSec.toFixed(1)}s · ${best.orbs} orbs` : '';
          return `${i + 1}  ${getLevel(id)?.title ?? id}${tag}`;
        });
        if (!lines.length) lines.push('(no levels yet — try ?level=testpad)');
        return this.showOverlay(`SELECT LEVEL\n\n${lines.join('\n')}\n\nnumber / Enter / tap · Esc back`);
      }
      case 'cutscene':
        this.endSession();
        this.hideOverlay();
        return this.playCutsceneChain([next.cutsceneId, ...chain]);
      case 'paused':
        this.loop.setPaused(true);
        return this.showOverlay('PAUSED\n\nEsc / tap resume · R retry · Q quit');
      case 'results': {
        const o = next.outcome;
        if (action.type === 'levelEnded') this.save.recordResult(next.levelId, o);
        if (o.kind === 'complete') {
          return this.showOverlay(`COMPLETE  ${o.timeSec.toFixed(1)}s  score ${o.score}\n\nEnter / tap continue · R retry · Esc levels`);
        }
        return this.showOverlay(`CRASHED (${o.cause})\n\nEnter / tap retry · Esc levels`);
      }
      case 'playing':
        if (isResume(prev, action, next) && this.session) {
          this.hideOverlay();
          this.clearInputOnNextStep = true;
          this.loop.setPaused(false);
          return;
        }
        void this.startLevel(next.levelId);
        return;
    }
  }

  private async startLevel(levelId: LevelId): Promise<void> {
    this.endSession(); // bumps levelToken, cancelling any in-flight load
    const token = this.levelToken;
    const spec = getLevel(levelId);
    if (!spec) {
      this.dispatch({ type: 'levelEnded', outcome: { kind: 'failed', cause: 'outOfBounds' } });
      this.showOverlay(`Level '${levelId}' is not built yet.\n\nEsc back`);
      return;
    }
    this.showOverlay('Loading…');
    const session = await LevelSession.create(spec);
    if (token !== this.levelToken || this.state.id !== 'playing') {
      session.destroy();
      return;
    }
    this.session = session;
    if (this.options.onEvent) session.on(this.options.onEvent);
    const midCutscene = modeSwitchCutscene(levelId, spec);
    if (midCutscene) {
      let played = false;
      session.on((e) => {
        if (e.type !== 'vesselModeChanged' || played) return;
        played = true;
        this.playInlineCutscene(midCutscene, session);
      });
    }
    this.view = new LevelView(session, this.art);
    this.pixi.app.stage.addChildAt(this.view.root, 0);
    session.start();
    this.hideOverlay();
    this.clearInputOnNextStep = true;
    this.loop.setPaused(false);
  }

  private endSession(): void {
    this.levelToken++;
    if (this.inlineCutscene) this.stopCutscene();
    this.view?.destroy();
    this.view = null;
    this.session?.destroy();
    this.session = null;
  }

  /** Player-facing levels only (debug levels are reached via ?level=). */
  private levelIds(): LevelId[] {
    return playableLevelIds();
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
    s.step(frame);
    if (s.outcome) this.dispatch({ type: 'levelEnded', outcome: s.outcome });
  }

  private render(alpha: number): void {
    this.view?.render(alpha, performance.now(), this.loop.paused);
    this.pixi.app.render();
  }

  private onPauseChange(paused: boolean, cause: PauseCause): void {
    this.input.clear();
    if (paused && cause !== 'manual' && this.state.id === 'playing' && !this.inlineCutscene) this.dispatch({ type: 'pause' });
  }

  // ------------------------------------------------------------ cutscenes

  private playCutscene(id: CutsceneId, then: () => void): void {
    this.stopCutscene();
    this.cutscene = playCutscene(this.host, getCutscene(id), {
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
    this.playCutscene(id, () => this.playCutsceneChain(rest));
  }

  private stopCutscene(): void {
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

  private selectLevel(id: LevelId): void {
    if (isUnlocked(this.save.state, id)) this.dispatch(selectLevelAction(id, getLevel));
  }

  /** Title: continue the story where the save left off, else level select. */
  private titleConfirm(): void {
    const cont = continueTarget(this.save.state, getLevel);
    this.dispatch({ type: 'start' });
    if (cont) this.selectLevel(cont);
  }

  private resultsConfirm(): void {
    if (this.state.id !== 'results') return;
    if (this.state.outcome.kind === 'complete') {
      const plan = continuePlan(this.state.levelId, getLevel);
      this.cutsceneChain = plan.cutscenes.slice(1);
      this.dispatch(plan.action);
    }
    else this.dispatch({ type: 'retry' });
  }

  // ------------------------------------------------------------ menus

  private onMenuKey(e: KeyboardEvent): void {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.code;
    const confirm = k === 'Enter' || k === 'Space' || k === 'NumpadEnter';
    switch (this.state.id) {
      case 'title':
        if (confirm) this.titleConfirm();
        else if (k === 'KeyL') this.dispatch({ type: 'start' });
        break;
      case 'levelSelect': {
        const ids = this.levelIds();
        const n = /^Digit([1-9])$/.exec(k);
        const pick = n ? ids[Number(n[1]) - 1] : confirm ? ids[0] : undefined;
        if (pick) this.selectLevel(pick);
        else if (k === 'Escape') this.dispatch({ type: 'back' });
        break;
      }
      case 'paused':
        if (k === 'Escape' || k === 'KeyP' || confirm) this.dispatch({ type: 'resume' });
        else if (k === 'KeyR') this.dispatch({ type: 'retry' });
        else if (k === 'KeyQ') this.dispatch({ type: 'quit' });
        break;
      case 'results':
        if (confirm) this.resultsConfirm();
        else if (k === 'KeyR') this.dispatch({ type: 'retry' });
        else if (k === 'Escape') this.dispatch({ type: 'back' });
        break;
      default:
        break;
    }
  }

  private onMenuTap(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    switch (this.state.id) {
      case 'title':
        return this.titleConfirm();
      case 'levelSelect': {
        const first = this.levelIds()[0];
        if (first) this.selectLevel(first);
        return;
      }
      case 'paused':
        return this.dispatch({ type: 'resume' });
      case 'results':
        return this.resultsConfirm();
      default:
        return;
    }
  }

  private showOverlay(text: string): void {
    this.overlayText.text = text;
    this.overlay.visible = true;
  }

  private hideOverlay(): void {
    this.overlay.visible = false;
  }
}

/**
 * GameUi: everything the player sees and touches outside the world view.
 *  - Pixi layers (on the 640×360 stage): HUD + help card, menu screens.
 *  - DOM layers (in the host box = safe area): on-screen touch controls
 *    (feeding App.virtual), portrait rotate hint.
 *  - Menu input: keyboard (window keydown), mouse + touch on the canvas.
 *
 * The App owns the state machine and the level session; it calls enter()
 * on every screen change, levelStarted()/onEvent()/tick() while playing,
 * noteFrame() with each sampled InputFrame (help-card dismissal), render()
 * every animation frame. UI actions go back through `dispatch`.
 */

import { Container } from 'pixi.js';
import { resolveSteering, VIEW_HEIGHT, VIEW_WIDTH } from '../contracts';
import type { ArtApi, GameEvent, InputFrame, LevelId, LevelSpec, ScreenAction, ScreenState, SteeringScheme, StickSide, VesselMode, VesselState } from '../contracts';
import type { PixiHost } from '../render/pixiApp';
import type { VirtualControlsSource } from '../shell/input';
import { frameHasInput, missionLines, missionTips } from './controlsHelp';
import { FpsMeter, fpsText, TerrainDiagMeter, terrainText, type TerrainDiag } from './fpsMeter';
import { PixelText } from './pixelText';
import { hudReduce, hudTick, initHud, initHudResume, type HudState } from './hud/hudState';
import type { ResumeInfo } from '../game/session';
import { HudView } from './hud/hudView';
import { MINIMAP_BORDER, MINIMAP_H, MINIMAP_W, MinimapView, minimapPlacement, minimapSide } from './minimap';
import { readSaveView, type SaveView } from './levelSelect';
import { createMenu, gridMove, type GridDir, keyToCommand, menuCommand, menuFocus, scrollBy, scrollToFocus, type MenuResult, type MenuState } from './menu';
import { enterFullscreen } from './fullscreen';
import { RotateHint } from './rotateHint';
import { backAction, isUiCommand, itemAction, nextSteering, screenModel, type ScreenContext, type ScreenModel, type StoryContext } from './screens';
import { isStickMode } from '../shell/directSteering';
import { ScreenView } from './screenView';
import { detectTouch, TouchLayer } from './touch/touchLayer';
import { nextTouchPref, touchVisible, type TouchPref } from './touch/touchModel';
import { themeTint, UI } from './uiTheme';

export interface GameUiOptions {
  host: HTMLElement;
  pixi: PixiHost;
  art: ArtApi;
  virtual: VirtualControlsSource;
  dispatch(action: ScreenAction): void;
  levels(): Partial<Record<LevelId, LevelSpec>>;
  /** Saved progress (S3). Default: tolerant read of localStorage. */
  save?(): SaveView | null;
  /** List debug levels in level select (the `?debug` flag). */
  showDebugLevels?: boolean;
  /** Initial touch-controls preference (SaveState.settings.touchControls). */
  touchPref?: TouchPref;
  /** Persist a changed preference (the App writes SaveState.settings.touchControls). */
  onTouchPrefChange?(p: TouchPref): void;
  /** S9: initial swapped-engine-buttons setting (SaveState.settings.swapEngineButtons; default true). */
  swapEngineButtons?: boolean;
  /** Persist a changed swap setting. */
  onSwapEngineButtonsChange?(swap: boolean): void;
  /** Initial FPS-counter setting (SaveState.settings.showFps; default false). */
  showFps?: boolean;
  /** Persist a changed FPS-counter setting. */
  onShowFpsChange?(on: boolean): void;
  /** Initial low-res render mode (the App resolves Settings.lowRes = null to the device default). */
  lowRes?: boolean;
  /** Low-res mode toggled in the pause menu (the App re-renders the canvas + persists). */
  onLowResChange?(on: boolean): void;
  /** Initial minimap setting (SaveState.settings.showMinimap; default true). */
  showMinimap?: boolean;
  /** The pause-menu MINIMAP toggle changed (persist it). */
  onShowMinimapChange?(on: boolean): void;
  /** Round 11: SaveState.settings.stickSide (default 'left': stick lower-left, minimap lower-right). */
  stickSide?: StickSide;
  /** The pause-menu LAYOUT toggle changed (persist it). */
  onStickSideChange?(side: StickSide): void;
  /** SaveState.settings.steering: the explicit choice, or null / unset = never chosen (resolved per level: resolveSteering). */
  steering?: SteeringScheme | null;
  /** STEERING toggled in the pause menu (the App switches the input layer + persists). */
  /** The new Settings.steering (null = AUTO: back to the per-level default). */
  onSteeringChange?(s: SteeringScheme | null): void;
  /** Audio state line for the FPS readout (round 9: iPhone audio reports), e.g. getAudio().diag. */
  audioDiag?(): string;
  /** The first real touch of the page (a device the startup detection took for desktop). */
  onTouchDetected?(): void;
  /** Story flow hooks for the title CONTINUE / results NEXT items (S3). */
  story?(): StoryContext;
  /** Title CONTINUE activated: the App resumes the story (cutscene + level). */
  onContinueStory?(): void;
  /**
   * Round 12 (ScreenContext.checkpoint): on GAME OVER, a plain retry would resume at a
   * checkpoint (RETRY FROM CHECKPOINT + RESTART LEVEL); paused, the run has a checkpoint
   * that RESTART would drop (labelled RESTART LEVEL).
   */
  checkpoint?(): boolean;
}

const TAP_SLOP_CSS = 10;

/** Arrow / WASD key -> grid direction (Tab keeps walking the flat order). */
function gridDirFor(code: string): GridDir | null {
  switch (code) {
    case 'ArrowUp':
    case 'KeyW':
      return 'up';
    case 'ArrowDown':
    case 'KeyS':
      return 'down';
    case 'ArrowLeft':
    case 'KeyA':
      return 'left';
    case 'ArrowRight':
    case 'KeyD':
      return 'right';
    default:
      return null;
  }
}

export class GameUi {
  private readonly hudView = new HudView();
  private readonly screenView: ScreenView;
  private readonly layer = new Container();
  private readonly touch: TouchLayer;
  private readonly rotate: RotateHint;
  private state: ScreenState = { id: 'boot' };
  private model: ScreenModel | null = null;
  private menu: MenuState = createMenu([]);
  private hud: HudState = initHud();
  private spec: LevelSpec | null = null;
  private helpMode: VesselMode | null = null;
  /** The help card is the level-start card: the simulation waits for the first input. */
  private helpBlocks = false;
  /** Sim seconds left before a mid-level (mode change) card hides itself. */
  private helpTtl = 0;
  /** The shown card is the level-start one (it states the mission, round 10 G). */
  private helpIsStart = false;
  /** This level's mission line(s), built once per level start. */
  private mission = '';
  private pauseHelp = false;
  private loading = false;
  private touchDetected: boolean;
  private touchPref: TouchPref;
  private swapEngines: boolean;
  private showFps: boolean;
  private lowRes: boolean;
  /** The scheme in use on the current level (what the pause menu shows). */
  private steering: SteeringScheme;
  /** The player's explicit choice, or null = never chosen (per-level default). */
  private steeringSetting: SteeringScheme | null;
  private showMinimap: boolean;
  /** Round 11 LAYOUT: 'right' = stick lower-right + minimap lower-left. */
  private stickSide: StickSide;
  private readonly minimap = new MinimapView();
  /** Vessel pose for the minimap (copied from the last tick: no per-frame allocation). */
  private readonly mmPose = new Float64Array(3);
  /** Minimap frame position (virtual px), re-placed with the HUD inset (4 Hz: it reads DOM layout). */
  private mmAt: { x: number; y: number } | null = { x: 0, y: 0 };
  private readonly fpsMeter = new FpsMeter();
  private readonly fpsLabel = new PixelText('', { color: UI.ink, outline: UI.outline });
  /** Second FPS-counter line: terrain streaming diagnostics (in a level). */
  private readonly terrainLabel = new PixelText('', { color: UI.ink, outline: UI.outline });
  private readonly terrainMeter = new TerrainDiagMeter();
  /** Third FPS-counter line: audio context state (when the App passes audioDiag). */
  private readonly audioLabel = new PixelText('', { color: UI.ink, outline: UI.outline });
  private terrainLine = false;
  /** Cached HUD left inset (virtual px) + when it was measured: measuring reads DOM layout, so not every frame. */
  private insetCache = { at: -Infinity, value: 0 };
  private lastHull: number | null = null;
  private press: { id: number; x: number; y: number; index: number; dragged: boolean; scrollAnchor: number } | null = null;
  private readonly unbind: (() => void)[] = [];
  /** A first touch tap already asked for fullscreen (once per page; never re-forced after the player leaves it). */
  private fsTouchTried = false;

  constructor(private readonly o: GameUiOptions) {
    this.screenView = new ScreenView(o.art);
    this.layer.addChild(this.minimap.root, this.hudView.root, this.screenView.root, this.fpsLabel, this.terrainLabel, this.audioLabel);
    o.pixi.app.stage.addChild(this.layer);
    this.hudView.root.visible = false;
    this.touchDetected = detectTouch();
    this.touchPref = o.touchPref ?? 'auto';
    this.swapEngines = o.swapEngineButtons ?? true;
    this.showFps = o.showFps ?? false;
    this.lowRes = o.lowRes ?? false;
    this.steeringSetting = o.steering ?? null;
    this.steering = resolveSteering(this.steeringSetting, null);
    this.showMinimap = o.showMinimap ?? true;
    this.stickSide = o.stickSide ?? 'left';
    this.fpsLabel.visible = this.showFps;
    this.terrainLabel.visible = this.showFps;
    this.audioLabel.visible = this.showFps;
    this.touch = new TouchLayer(o.host, o.virtual);
    this.touch.setSwapEngines(this.swapEngines);
    this.touch.setSteering(this.steering);
    this.touch.setStickRight(this.stickSide === 'right');
    this.rotate = new RotateHint(o.host, () => this.touchDetected);

    const onKey = (e: KeyboardEvent) => this.onKey(e);
    const onAnyPointer = (e: PointerEvent) => this.onAnyPointer(e);
    const onAnyPointerUp = (e: PointerEvent) => this.onAnyPointerUp(e);
    const cv = o.pixi.canvas;
    const onDown = (e: PointerEvent) => this.onCanvasDown(e);
    const onMove = (e: PointerEvent) => this.onCanvasMove(e);
    const onUp = (e: PointerEvent) => this.onCanvasUp(e);
    const onCancel = () => (this.press = null);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onAnyPointer, true);
    window.addEventListener('pointerup', onAnyPointerUp, true);
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onCancel);
    this.unbind.push(
      () => window.removeEventListener('keydown', onKey),
      () => window.removeEventListener('pointerdown', onAnyPointer, true),
      () => window.removeEventListener('pointerup', onAnyPointerUp, true),
      () => cv.removeEventListener('pointerdown', onDown),
      () => cv.removeEventListener('pointermove', onMove),
      () => cv.removeEventListener('pointerup', onUp),
      () => cv.removeEventListener('pointercancel', onCancel),
    );
  }

  /** Top-most Pixi container (the App keeps it above the level view). */
  get root(): Container {
    return this.layer;
  }

  get hudState(): HudState {
    return this.hud;
  }

  get touchLayer(): TouchLayer {
    return this.touch;
  }

  get currentMenu(): MenuState {
    return this.menu;
  }

  get currentModel(): ScreenModel | null {
    return this.model;
  }

  /** The mission text on the shown controls card ('' when none). */
  get helpMission(): string {
    return this.hudView.helpMissionText;
  }

  get helpVisible(): boolean {
    return this.hudView.helpVisible;
  }

  destroy(): void {
    this.unbind.forEach((u) => u());
    this.touch.dispose();
    this.rotate.dispose();
    this.minimap.destroy(); // its baked texture too
    this.layer.destroy({ children: true });
  }

  // --------------------------------------------------------------- screens

  /** New level view (start / restart): drop the terrain ms history so the load frame's synchronous prepare does not dominate MAX / UP. */
  resetTerrainHistory(): void {
    this.terrainMeter.reset();
  }

  enter(next: ScreenState): void {
    this.state = next;
    if (next.id !== 'playing') this.loading = false;
    this.pauseHelp = false;
    this.press = null;
    if (next.id !== 'playing' && next.id !== 'paused' && next.id !== 'results') {
      this.spec = null;
      this.minimap.clear(); // out of the level: free its baked minimap texture (retry / next level bakes again)
    }
    if (next.id === 'results') this.lastHull = this.hud.hull;
    this.refreshModel(true);
    this.syncLayers();
  }

  /** Loading screen: level load (playing, no session yet) or a cutscene generating its first still. */
  setLoading(loading: boolean): void {
    this.loading = loading;
    this.refreshModel(true);
    this.syncLayers();
  }

  private ctx(): ScreenContext {
    return {
      levels: this.o.levels(),
      save: (this.o.save ?? readSaveView)(),
      showDebug: !!this.o.showDebugLevels,
      touchPref: this.touchPref,
      swapEngines: this.swapEngines,
      showFps: this.showFps,
      lowRes: this.lowRes,
      steering: this.steeringSetting,
      vesselMode: this.spec ? this.hud.mode : null,
      showMinimap: this.showMinimap,
      stickSide: this.stickSide,
      lastHull: this.lastHull,
      checkpoint: this.o.checkpoint?.() ?? false,
      ...(this.o.story ? { story: this.o.story() } : {}),
    };
  }

  private refreshModel(resetFocus: boolean): void {
    const s = this.state;
    // Cutscenes are drawn by the story player (src/story/cutscenePlayer.ts), which owns their input.
    const needsModel = (s.id !== 'playing' && s.id !== 'cutscene') || this.loading;
    if (!needsModel) {
      this.model = null;
      this.screenView.setModel(null);
      return;
    }
    // A cutscene waiting for its first still (App.playCutscene) shows the loading screen.
    const m = this.loading && s.id === 'cutscene' ? screenModel({ id: 'boot' }, this.ctx()) : screenModel(s, this.ctx());
    this.model = m;
    const focus = resetFocus ? m.focus : Math.min(this.menu.focus, Math.max(0, m.items.length - 1));
    this.menu = { ...createMenu(m.items, focus), scroll: resetFocus ? 0 : this.menu.scroll };
    this.screenView.setModel(m);
  }

  private syncLayers(): void {
    const playing = this.state.id === 'playing' && !this.loading;
    const inLevel = playing || this.state.id === 'paused' || this.state.id === 'results';
    this.hudView.root.visible = inLevel && !!this.spec;
    this.screenView.root.visible = !!this.model && !(this.state.id === 'paused' && this.pauseHelp);
    const touchOn = touchVisible(this.touchPref, this.touchDetected);
    // JOYSTICK in the modes it drives: the stick shows even without touch controls (a desktop mouse drags it),
    // then alone - no pause / restart buttons (Esc / Backspace)
    const stickOnly = !touchOn && this.steering === 'joystick' && isStickMode(this.hud.mode);
    this.touch.setSystemButtons(!stickOnly);
    const showTouch = playing && (touchOn || stickOnly);
    this.touch.show(showTouch ? this.hud.mode : null);
    this.insetCache.at = -Infinity; // touch layout may have changed: re-measure the HUD inset
    // Tint first: the help card below is drawn (and cached) with the current theme border.
    const tint = themeTint(this.o.art, this.spec?.themeId ?? null);
    this.hudView.border = tint;
    this.screenView.border = this.spec ? tint : UI.accent;
    const helpTouch = touchVisible(this.touchPref, this.touchDetected);
    const direct = this.steering === 'direct';
    const joystick = this.steering === 'joystick';
    if (this.state.id === 'paused' && this.pauseHelp) this.hudView.setHelp(this.hud.mode, helpTouch, false, this.swapEngines, direct, joystick, '', this.stickSide === 'right');
    else if (playing && this.helpMode) this.hudView.setHelp(this.helpMode, helpTouch, this.helpBlocks, this.swapEngines, direct, joystick, this.helpIsStart ? this.mission : '', this.stickSide === 'right');
    else this.hudView.setHelp(null, false);
  }

  // ------------------------------------------------------------ gameplay

  /**
   * A level session started. `resume` (round 12, LevelSession.resumeInfo): it is a checkpoint
   * respawn - the HUD, minimap markers and steering start from the checkpoint's state (its
   * vessel mode, so the HUD's mode-change check in tick() never sees a "switch" and shows no
   * card), there is no start card / mission line, and a controls card holds the simulation only
   * when the respawn is not a resting spot (the vessel would fall while the player reads it).
   */
  levelStarted(spec: LevelSpec, resume: ResumeInfo | null = null): void {
    this.spec = spec;
    this.hud = resume ? initHudResume(spec, resume) : initHud(spec);
    const mode = resume ? resume.mode : spec.vesselMode;
    // never-chosen steering: per level / phase (ENGINES on Descent and floatingIsles' CSM - touch buttons too - else JOYSTICK)
    this.steering = resolveSteering(this.steeringSetting, spec.id, mode);
    this.touch.setSteering(this.steering);
    // the minimap's terrain is baked ONCE here (load frame) and uploaded to the GPU right away
    this.minimap.setLevel(spec, (src) => this.o.pixi.uploadTexture(src));
    for (const id of resume?.planted ?? []) this.minimap.setPlanted(id);
    this.mmPose[0] = resume ? resume.pose.x : spec.spawn.x;
    this.mmPose[1] = resume ? resume.pose.y : spec.spawn.y;
    this.mmPose[2] = resume ? resume.pose.angle : (spec.spawn.angle ?? 0);
    // round 10 (G): the start card states the mission, readable while it holds the level
    // round 21: plus how-to lines where the objective needs them (the Keeper: drop the roof rocks on it)
    this.mission = [...missionLines(spec.objectives), ...missionTips(spec.objectives)].join('\n');
    if (!resume) {
      this.helpMode = spec.vesselMode;
      this.helpBlocks = true;
      this.helpIsStart = true;
    } else if (!resume.resting) {
      this.helpMode = mode;
      this.helpBlocks = true;
      this.helpIsStart = false;
      this.helpTtl = 6;
    } else {
      this.helpMode = null;
      this.helpBlocks = false;
      this.helpIsStart = false;
    }
    this.loading = false;
    this.refreshModel(true);
    this.syncLayers();
  }

  onEvent(e: GameEvent): void {
    const prevMode = this.hud.mode;
    this.hud = hudReduce(this.hud, e);
    if (e.type === 'beaconPlanted') this.minimap.setPlanted(e.siteId);
    if (e.type === 'vesselModeChanged' && e.to !== prevMode) this.showModeHelp(e.to);
    else if (e.type === 'vesselModeChanged') this.syncSteering(e.to);
  }

  tick(v: VesselState | null, dt: number): void {
    const prevMode = this.hud.mode;
    this.hud = hudTick(this.hud, v, dt);
    if (v) {
      this.mmPose[0] = v.pos.x;
      this.mmPose[1] = v.pos.y;
      this.mmPose[2] = v.angle;
    }
    if (this.hud.mode !== prevMode) this.showModeHelp(this.hud.mode);
    if (this.helpMode && !this.helpBlocks) {
      this.helpTtl -= dt;
      if (this.helpTtl <= 0) this.dismissHelp();
    }
  }

  /**
   * New controls mid-level (floatingIsles' detach): show the card again and, like the
   * level-start card, HOLD the simulation until the first input (round 10: the lander
   * kept falling under a non-blocking card and crashed while the player read it).
   */
  private showModeHelp(mode: VesselMode): void {
    this.syncSteering(mode); // AUTO steering is per phase (floatingIsles: ENGINES for the CSM, JOYSTICK after the detach)
    this.helpMode = mode;
    this.helpBlocks = true;
    this.helpIsStart = false;
    this.helpTtl = 6;
    this.syncLayers();
  }

  /** The scheme in use for `mode` on this level (a never-chosen setting resolves per phase). */
  private syncSteering(mode: VesselMode): void {
    const s = resolveSteering(this.steeringSetting, this.spec?.id ?? null, mode);
    if (s === this.steering) return;
    this.steering = s;
    this.touch.setSteering(s);
  }

  /** True while a blocking controls card (level start, or a mid-level vessel switch) holds the simulation. */
  get holdSimulation(): boolean {
    return this.helpBlocks && this.helpMode !== null;
  }

  /** Every sampled InputFrame while playing: the first real input dismisses the help card. */
  noteFrame(f: InputFrame): void {
    if (this.helpMode && frameHasInput(f)) this.dismissHelp();
  }

  dismissHelp(): void {
    if (!this.helpMode) return;
    this.helpMode = null;
    this.helpBlocks = false;
    this.syncLayers();
  }

  /** The App changed low-res mode itself (device default after a first touch): keep the menu label in step. */
  setLowResState(on: boolean): void {
    if (on === this.lowRes) return;
    this.lowRes = on;
    this.refreshModel(false);
  }

  /** FPS counter visible (pause-menu toggle). */
  get fpsVisible(): boolean {
    return this.showFps;
  }

  /**
   * One animation frame's timing for the FPS counter: rAF time + CPU ms of the
   * frame's work (the App measures steps + render). Cheap when the counter is off.
   */
  noteFrameTiming(nowMs: number, workMs: number, phases?: ArrayLike<number>, terrain?: TerrainDiag | null): void {
    if (!this.showFps) return;
    if (terrain) this.terrainMeter.note(terrain);
    const published = this.fpsMeter.frame(nowMs, workMs, phases);
    this.fpsLabel.setText(fpsText(this.fpsMeter.reading)); // no-op unless a new reading was published
    if (published) {
      // terrain line (in a level): which streaming path fired - for player reports from the deployed build
      this.terrainLine = !!terrain;
      this.terrainLabel.setText(terrain ? terrainText(this.terrainMeter.publish()) : '');
      this.audioLabel.setText(this.o.audioDiag?.() ?? '');
    }
  }

  render(nowMs: number): void {
    this.screenView.cssPerVirtual = this.cssPerVirtual();
    if (this.hudView.root.visible) {
      // DOM layout reads are cached (4 Hz): per-frame getBoundingClientRect can force a synchronous layout on iOS
      if (nowMs - this.insetCache.at > 250 || nowMs < this.insetCache.at) {
        this.insetCache = { at: nowMs, value: this.restartInset() };
        const aim = this.touch.isVisible && !!this.touch.getLayout()?.aimZone;
        // null = no overlap-free spot (tiny screens): hidden
        this.mmAt = minimapPlacement(this.touchRectsInView(), MINIMAP_W + 2 * MINIMAP_BORDER, MINIMAP_H + 2 * MINIMAP_BORDER, VIEW_WIDTH, VIEW_HEIGHT, 4, 80, minimapSide(this.stickSide === 'right', aim));
      }
      this.hudView.leftInset = this.insetCache.value;
      this.hudView.render(this.hud, nowMs);
    }
    const mmAt = this.mmAt;
    this.minimap.root.visible = this.hudView.root.visible && this.showMinimap && !!this.spec && !!mmAt;
    if (mmAt && this.minimap.root.visible) this.minimap.render(this.mmPose[0]!, this.mmPose[1]!, this.mmPose[2]!, mmAt.x, mmAt.y, this.hudView.border);
    if (this.showFps) {
      // top-right corner; left of the mode badge while the HUD is up
      const right = this.hudView.root.visible ? this.hudView.badgeLeft - 4 : VIEW_WIDTH - 4;
      this.fpsLabel.position.set(Math.round(right - this.fpsLabel.width), 5);
      this.terrainLabel.position.set(Math.round(right - this.terrainLabel.width), 5 + Math.ceil(this.fpsLabel.height) + 2);
      const ay = this.terrainLine ? this.terrainLabel.y + Math.ceil(this.terrainLabel.height) + 2 : this.terrainLabel.y;
      this.audioLabel.position.set(Math.round(right - this.audioLabel.width), ay);
    }
    if (this.screenView.root.visible && this.model) {
      this.screenView.render(this.menu, nowMs);
      const scrolled = scrollToFocus(this.menu, this.screenView.visibleRows());
      if (scrolled !== this.menu) {
        this.menu = scrolled; // redraw now so what is hit-testable is what is on screen
        this.screenView.render(this.menu, nowMs);
      }
    }
  }

  /** Virtual px the HUD fuel panel must shift right to clear the touch RESTART button (top-left), 0 when hidden. */
  private restartInset(): number {
    const b = this.touch.isVisible ? this.touch.getLayout()?.buttons.find((x) => x.control === 'restart') : undefined;
    if (!b) return 0;
    try {
      const host = this.o.host.getBoundingClientRect();
      const v = this.o.pixi.clientToView(host.left + b.rect.x + b.rect.w, host.top + b.rect.y + b.rect.h);
      if (v.y <= 0 || v.x <= 0) return 0; // the button sits in the letterbox, clear of the view
      return Math.max(0, Math.min(200, Math.ceil(v.x) + 2));
    } catch {
      return 0;
    }
  }

  /** The on-screen touch controls the minimap must not cover (virtual px): flight buttons, aim zone, stick base. */
  private touchRectsInView(): { x: number; y: number; w: number; h: number }[] {
    const layout = this.touch.isVisible ? this.touch.getLayout() : null;
    if (!layout) return [];
    const css: { x: number; y: number; w: number; h: number }[] = layout.buttons.filter((b) => !b.system).map((b) => b.rect);
    if (layout.aimZone) css.push(layout.aimZone);
    if (layout.stick) css.push({ x: layout.stick.cx - layout.stick.r, y: layout.stick.cy - layout.stick.r, w: 2 * layout.stick.r, h: 2 * layout.stick.r });
    try {
      const host = this.o.host.getBoundingClientRect();
      return css.map((r) => {
        const a = this.o.pixi.clientToView(host.left + r.x, host.top + r.y);
        const b = this.o.pixi.clientToView(host.left + r.x + r.w, host.top + r.y + r.h);
        return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
      });
    } catch {
      return [];
    }
  }

  private cssPerVirtual(): number {
    try {
      return this.o.pixi.scale.cssPerVirtual;
    } catch {
      return 1;
    }
  }

  // ---------------------------------------------------------------- input

  /** Apply a menu result: activation -> action / UI command. */
  private apply(r: MenuResult): void {
    this.menu = r.state;
    if (r.rejected) {
      const item = this.menu.items.find((i) => i.id === r.rejected);
      this.screenView.flash(item?.detail === 'SOON' ? 'NOT BUILT YET' : 'LOCKED', performance.now());
      return;
    }
    if (r.back) {
      const a = backAction(this.state);
      if (a) this.o.dispatch(a);
      return;
    }
    if (r.activate) this.activate(r.activate);
  }

  private activate(id: string): void {
    // Title START / CONTINUE is a user gesture (key / tap / click): go fullscreen where the API exists.
    if (this.state.id === 'title') enterFullscreen();
    const a = itemAction(this.state, id, this.ctx());
    if (!isUiCommand(a)) {
      this.o.dispatch(a);
      return;
    }
    if (a.ui === 'controls') {
      this.pauseHelp = true;
      this.syncLayers();
    } else if (a.ui === 'continueStory') {
      this.o.onContinueStory?.();
    } else if (a.ui === 'toggleTouch') {
      this.touchPref = nextTouchPref(this.touchPref);
      this.o.onTouchPrefChange?.(this.touchPref);
      this.refreshModel(false);
      this.syncLayers();
    } else if (a.ui === 'toggleSwap') {
      this.swapEngines = !this.swapEngines;
      this.touch.setSwapEngines(this.swapEngines);
      this.o.onSwapEngineButtonsChange?.(this.swapEngines);
      this.refreshModel(false);
      this.syncLayers();
    } else if (a.ui === 'toggleSteering') {
      // ENGINES -> DIRECT -> JOYSTICK -> AUTO (null: the per-level default again) -> ENGINES
      this.steeringSetting = nextSteering(this.steeringSetting);
      this.steering = resolveSteering(this.steeringSetting, this.spec?.id ?? null, this.spec ? this.hud.mode : null);
      this.touch.setSteering(this.steering);
      this.o.onSteeringChange?.(this.steeringSetting);
      this.refreshModel(false);
      this.syncLayers();
    } else if (a.ui === 'toggleFps') {
      this.showFps = !this.showFps;
      this.fpsLabel.visible = this.showFps;
      this.terrainLabel.visible = this.showFps;
      this.audioLabel.visible = this.showFps;
      // no stale reading (or a first window spanning the time it was off) when it comes back
      this.fpsMeter.reset();
      this.terrainMeter.reset();
      this.fpsLabel.setText(this.showFps ? fpsText(null) : '');
      this.terrainLabel.setText('');
      this.o.onShowFpsChange?.(this.showFps);
      this.refreshModel(false);
    } else if (a.ui === 'toggleMinimap') {
      this.showMinimap = !this.showMinimap;
      this.o.onShowMinimapChange?.(this.showMinimap);
      this.refreshModel(false);
    } else if (a.ui === 'toggleStickSide') {
      // the layer is hidden while paused: it rebuilds now and shows on resume (a carried stick
      // finger across the swap is released by TouchModel.relayout - no ghost stick)
      this.stickSide = this.stickSide === 'right' ? 'left' : 'right';
      this.touch.setStickRight(this.stickSide === 'right');
      this.o.onStickSideChange?.(this.stickSide);
      this.insetCache = { ...this.insetCache, at: -Infinity }; // re-place the minimap on the next frame
      this.refreshModel(false);
    } else if (a.ui === 'toggleLowRes') {
      this.lowRes = !this.lowRes;
      this.o.onLowResChange?.(this.lowRes);
      this.refreshModel(false);
    }
  }

  private closePauseHelp(): boolean {
    if (this.state.id === 'paused' && this.pauseHelp) {
      this.pauseHelp = false;
      this.syncLayers();
      return true;
    }
    return false;
  }

  private onKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (this.state.id === 'playing') {
      // Any key dismisses the help card (game keys also do via noteFrame).
      if (!e.repeat && e.code !== 'Escape' && e.code !== 'KeyP') this.dismissHelp();
      return;
    }
    if (this.closePauseHelp()) return;
    if (!this.model || this.loading) return;
    if (!e.repeat && this.shortcut(e.code)) {
      e.preventDefault();
      return;
    }
    const cmd = keyToCommand(e.code);
    if (!cmd) return;
    if (e.repeat && (cmd === 'activate' || cmd === 'back' || typeof cmd === 'object')) return;
    e.preventDefault();
    if (typeof cmd === 'object' && this.state.id !== 'levelSelect') return; // digits only pick levels
    // two-column panel: arrows move spatially (up / down inside a column, left / right across)
    const grid = this.screenView.grid();
    const dir = gridDirFor(e.code);
    if (grid.cols > 1 && dir) {
      this.menu = menuFocus(this.menu, gridMove(this.menu.focus, this.menu.items.length, grid.perCol, dir));
      return;
    }
    this.apply(menuCommand(this.menu, cmd));
  }

  /**
   * Letter shortcuts: pause P resume · R retry · Q quit; results R retry.
   * Backspace = RESTART everywhere in a level (flight, pause, results) - the
   * same key as in flight (src/shell/input.ts), so it is not menu "back" here.
   */
  private shortcut(code: string): boolean {
    const id = this.state.id;
    if (id === 'paused' && code === 'KeyP') this.o.dispatch({ type: 'resume' });
    else if ((id === 'paused' || id === 'results') && (code === 'KeyR' || code === 'Backspace')) this.o.dispatch(id === 'paused' ? { type: 'retry', fromStart: true } : { type: 'retry' });
    else if (id === 'paused' && code === 'KeyQ') this.o.dispatch({ type: 'quit' });
    else return false;
    return true;
  }

  private onAnyPointer(e: PointerEvent): void {
    if (e.pointerType === 'touch' && !this.touchDetected) {
      this.touchDetected = true;
      this.rotate.update();
      this.syncLayers();
      this.o.onTouchDetected?.();
    }
  }

  /** The first touch tap of the page (pointerup is a user-activation event for touch) asks for fullscreen. */
  private onAnyPointerUp(e: PointerEvent): void {
    if (e.pointerType !== 'touch' || this.fsTouchTried) return;
    this.fsTouchTried = true;
    enterFullscreen();
  }

  private toView(e: PointerEvent): { x: number; y: number } {
    return this.o.pixi.clientToView(e.clientX, e.clientY);
  }

  private onCanvasDown(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.state.id === 'playing') {
      this.dismissHelp();
      return;
    }
    if (this.closePauseHelp()) return;
    if (!this.model || this.loading || this.press) return;
    const v = this.toView(e);
    this.press = { id: e.pointerId, x: e.clientX, y: e.clientY, index: this.screenView.hitTest(v.x, v.y), dragged: false, scrollAnchor: this.menu.scroll };
    if (this.press.index >= 0) this.menu = menuFocus(this.menu, this.press.index);
  }

  private onCanvasMove(e: PointerEvent): void {
    if (!this.model || this.state.id === 'playing') return;
    const p = this.press;
    if (p && p.id === e.pointerId) {
      const dy = e.clientY - p.y;
      if (!p.dragged && Math.hypot(e.clientX - p.x, dy) > TAP_SLOP_CSS) p.dragged = true;
      const g = this.screenView.rows();
      if (p.dragged && g && this.model.kind === 'list') {
        const rowCss = (g.layout.rowH + 4) * this.cssPerVirtual();
        const rows = Math.round(-dy / Math.max(1, rowCss));
        const target = p.scrollAnchor + rows;
        this.menu = scrollBy({ ...this.menu, scroll: p.scrollAnchor }, target - p.scrollAnchor, this.screenView.visibleRows());
        // keep focus visible so scrollToFocus does not snap back
        const vis = this.screenView.visibleRows();
        const f = Math.min(Math.max(this.menu.focus, this.menu.scroll), this.menu.scroll + vis - 1);
        this.menu = { ...this.menu, focus: f };
      }
      return;
    }
    if (e.pointerType === 'mouse') {
      const v = this.toView(e);
      const i = this.screenView.hitTest(v.x, v.y);
      if (i >= 0) this.menu = menuFocus(this.menu, i);
    }
  }

  private onCanvasUp(e: PointerEvent): void {
    const p = this.press;
    if (!p || p.id !== e.pointerId) return;
    this.press = null;
    if (!this.model || p.dragged) return;
    const v = this.toView(e);
    const i = this.screenView.hitTest(v.x, v.y);
    // Title: a tap on an item picks it; a tap anywhere else picks the first (CONTINUE / START).
    if (this.state.id === 'title' && i < 0) {
      this.activate(this.model.items[0]?.id ?? '');
      return;
    }
    if (i >= 0 && i === p.index) this.apply(menuCommand(this.menu, { jump: i }));
  }
}

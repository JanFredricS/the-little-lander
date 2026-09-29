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
import type { ArtApi, GameEvent, InputFrame, LevelId, LevelSpec, ScreenAction, ScreenState, VesselMode, VesselState } from '../contracts';
import type { PixiHost } from '../render/pixiApp';
import type { VirtualControlsSource } from '../shell/input';
import { frameHasInput } from './controlsHelp';
import { hudReduce, hudTick, initHud, type HudState } from './hud/hudState';
import { HudView } from './hud/hudView';
import { readSaveView, type SaveView } from './levelSelect';
import { createMenu, keyToCommand, menuCommand, menuFocus, scrollBy, scrollToFocus, type MenuResult, type MenuState } from './menu';
import { RotateHint } from './rotateHint';
import { backAction, isUiCommand, itemAction, screenModel, type ScreenContext, type ScreenModel } from './screens';
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
  /** Persist a changed preference (S3/S8 wire this into SaveState). */
  onTouchPrefChange?(p: TouchPref): void;
}

const TAP_SLOP_CSS = 10;

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
  private pauseHelp = false;
  private loading = false;
  private touchDetected: boolean;
  private touchPref: TouchPref;
  private lastHull: number | null = null;
  private press: { id: number; x: number; y: number; index: number; dragged: boolean; scrollAnchor: number } | null = null;
  private readonly unbind: (() => void)[] = [];

  constructor(private readonly o: GameUiOptions) {
    this.screenView = new ScreenView(o.art);
    this.layer.addChild(this.hudView.root, this.screenView.root);
    o.pixi.app.stage.addChild(this.layer);
    this.hudView.root.visible = false;
    this.touchDetected = detectTouch();
    this.touchPref = o.touchPref ?? 'auto';
    this.touch = new TouchLayer(o.host, o.virtual);
    this.rotate = new RotateHint(o.host, () => this.touchDetected);

    const onKey = (e: KeyboardEvent) => this.onKey(e);
    const onAnyPointer = (e: PointerEvent) => this.onAnyPointer(e);
    const cv = o.pixi.canvas;
    const onDown = (e: PointerEvent) => this.onCanvasDown(e);
    const onMove = (e: PointerEvent) => this.onCanvasMove(e);
    const onUp = (e: PointerEvent) => this.onCanvasUp(e);
    const onCancel = () => (this.press = null);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onAnyPointer, true);
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onCancel);
    this.unbind.push(
      () => window.removeEventListener('keydown', onKey),
      () => window.removeEventListener('pointerdown', onAnyPointer, true),
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

  get helpVisible(): boolean {
    return this.hudView.helpVisible;
  }

  destroy(): void {
    this.unbind.forEach((u) => u());
    this.touch.dispose();
    this.rotate.dispose();
    this.layer.destroy({ children: true });
  }

  // --------------------------------------------------------------- screens

  enter(next: ScreenState): void {
    this.state = next;
    if (next.id !== 'playing') this.loading = false;
    this.pauseHelp = false;
    this.press = null;
    if (next.id !== 'playing' && next.id !== 'paused' && next.id !== 'results') this.spec = null;
    if (next.id === 'results') this.lastHull = this.hud.hull;
    this.refreshModel(true);
    this.syncLayers();
  }

  /** Level-load spinner while playing but no session yet. */
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
      lastHull: this.lastHull,
    };
  }

  private refreshModel(resetFocus: boolean): void {
    const s = this.state;
    const needsModel = s.id !== 'playing' || this.loading;
    if (!needsModel) {
      this.model = null;
      this.screenView.setModel(null);
      return;
    }
    const m = screenModel(s, this.ctx());
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
    const showTouch = playing && touchVisible(this.touchPref, this.touchDetected);
    this.touch.show(showTouch ? this.hud.mode : null);
    // Tint first: the help card below is drawn (and cached) with the current theme border.
    const tint = themeTint(this.o.art, this.spec?.themeId ?? null);
    this.hudView.border = tint;
    this.screenView.border = this.spec ? tint : UI.accent;
    const helpTouch = touchVisible(this.touchPref, this.touchDetected);
    if (this.state.id === 'paused' && this.pauseHelp) this.hudView.setHelp(this.hud.mode, helpTouch, false);
    else if (playing && this.helpMode) this.hudView.setHelp(this.helpMode, helpTouch, this.helpBlocks);
    else this.hudView.setHelp(null, false);
  }

  // ------------------------------------------------------------ gameplay

  levelStarted(spec: LevelSpec): void {
    this.spec = spec;
    this.hud = initHud(spec);
    this.helpMode = spec.vesselMode;
    this.helpBlocks = true;
    this.loading = false;
    this.refreshModel(true);
    this.syncLayers();
  }

  onEvent(e: GameEvent): void {
    const prevMode = this.hud.mode;
    this.hud = hudReduce(this.hud, e);
    if (e.type === 'vesselModeChanged' && e.to !== prevMode) this.showModeHelp(e.to);
  }

  tick(v: VesselState | null, dt: number): void {
    const prevMode = this.hud.mode;
    this.hud = hudTick(this.hud, v, dt);
    if (this.hud.mode !== prevMode) this.showModeHelp(this.hud.mode);
    if (this.helpMode && !this.helpBlocks) {
      this.helpTtl -= dt;
      if (this.helpTtl <= 0) this.dismissHelp();
    }
  }

  /** New controls mid-level: show the card again (non-blocking, times out). */
  private showModeHelp(mode: VesselMode): void {
    this.helpMode = mode;
    this.helpBlocks = false;
    this.helpTtl = 6;
    this.syncLayers();
  }

  /** True while the level-start help card holds the simulation. */
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

  render(nowMs: number): void {
    this.screenView.cssPerVirtual = this.cssPerVirtual();
    if (this.hudView.root.visible) this.hudView.render(this.hud, nowMs);
    if (this.screenView.root.visible && this.model) {
      this.screenView.render(this.menu, nowMs);
      const scrolled = scrollToFocus(this.menu, this.screenView.visibleRows());
      if (scrolled !== this.menu) {
        this.menu = scrolled; // redraw now so what is hit-testable is what is on screen
        this.screenView.render(this.menu, nowMs);
      }
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
    const a = itemAction(this.state, id, this.ctx());
    if (!isUiCommand(a)) {
      this.o.dispatch(a);
      return;
    }
    if (a.ui === 'controls') {
      this.pauseHelp = true;
      this.syncLayers();
    } else if (a.ui === 'toggleTouch') {
      this.touchPref = nextTouchPref(this.touchPref);
      this.o.onTouchPrefChange?.(this.touchPref);
      this.refreshModel(false);
      this.syncLayers();
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
    if (this.state.id === 'cutscene' && !e.repeat) {
      this.o.dispatch({ type: 'cutsceneDone' });
      return;
    }
    if (!e.repeat && this.shortcut(e.code)) {
      e.preventDefault();
      return;
    }
    const cmd = keyToCommand(e.code);
    if (!cmd) return;
    if (e.repeat && (cmd === 'activate' || cmd === 'back' || typeof cmd === 'object')) return;
    e.preventDefault();
    if (typeof cmd === 'object' && this.state.id !== 'levelSelect') return; // digits only pick levels
    this.apply(menuCommand(this.menu, cmd));
  }

  /** Letter shortcuts: pause P resume · R retry · Q quit; results R retry. */
  private shortcut(code: string): boolean {
    const id = this.state.id;
    if (id === 'paused' && code === 'KeyP') this.o.dispatch({ type: 'resume' });
    else if ((id === 'paused' || id === 'results') && code === 'KeyR') this.o.dispatch({ type: 'retry' });
    else if (id === 'paused' && code === 'KeyQ') this.o.dispatch({ type: 'quit' });
    else return false;
    return true;
  }

  private onAnyPointer(e: PointerEvent): void {
    if (e.pointerType === 'touch' && !this.touchDetected) {
      this.touchDetected = true;
      this.rotate.update();
      this.syncLayers();
    }
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
    // Title and cutscene placeholder: tap anywhere.
    if (this.state.id === 'title' || this.state.id === 'cutscene') {
      this.activate(this.model.items[0]?.id ?? '');
      return;
    }
    const v = this.toView(e);
    const i = this.screenView.hitTest(v.x, v.y);
    if (i >= 0 && i === p.index) this.apply(menuCommand(this.menu, { jump: i }));
  }
}

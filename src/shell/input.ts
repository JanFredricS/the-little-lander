/**
 * Input layer: InputSources (keyboard, pointer, on-screen/virtual controls)
 * merged by InputMapper into one InputFrame per fixed step. See the rules in
 * src/contracts/input.ts.
 *
 * Default keyboard bindings (by KeyboardEvent.code, per VesselMode):
 *   all modes      pause: Escape, P · restart level: Backspace
 *   csm            thrust: W / ArrowUp / Space · rotateCCW: A / ArrowLeft · rotateCW: D / ArrowRight
 *   lander         engineLeft: A / ArrowLeft / J · engineRight: D / ArrowRight / L · thrust (= both): W / ArrowUp / K / Space
 *                  topLeft: Q / U · topRight: E / O (S9 top thrusters)
 *                  Settings.swapEngineButtons (default ON) applies here too
 *                  (KeyboardSource.setSwapEngines): the left keys fire the
 *                  RIGHT engine / top thruster and vice versa, so ← / A tilts
 *                  and moves the lander left — same scheme as the touch buttons.
 *   harpoon        aim: arrow keys (8-way) · fire: Space · release: X / ShiftLeft · reelIn: W / R · reelOut: S / F
 *   harpoonThrust  aim: arrow keys · fire: Space · release: X / ShiftLeft · thrust: W · rotateCCW: A · rotateCW: D · reelIn: R · reelOut: F
 * Pointer (mouse): hover aims (vessel -> pointer), left button = fire, right button = release.
 * Pointer (touch/pen on the game canvas): drag aims (drag start -> current finger).
 */

import type {
  AimSample,
  ControlFlags,
  ControlId,
  EdgeControlId,
  InputFrame,
  InputSampleContext,
  InputSource,
  InputSourceSample,
  Vec2,
  VesselMode,
} from '../contracts';

export const CONTROL_IDS: readonly ControlId[] = [
  'thrust',
  'engineLeft',
  'engineRight',
  'topLeft',
  'topRight',
  'rotateCW',
  'rotateCCW',
  'fire',
  'release',
  'reelIn',
  'reelOut',
  'pause',
  'restart',
];

const EDGE_CONTROLS: ReadonlySet<ControlId> = new Set<EdgeControlId>(['fire', 'release', 'pause', 'restart']);

export function isEdgeControl(c: ControlId): c is EdgeControlId {
  return EDGE_CONTROLS.has(c);
}

/** code -> controls, per mode. */
export type KeyBindings = Readonly<Record<string, readonly ControlId[]>>;

/** Shell controls shared by every mode (R is taken by reelIn in the harpoon modes, so restart is Backspace). */
const PAUSE: KeyBindings = { Escape: ['pause'], KeyP: ['pause'], Backspace: ['restart'] };

export const DEFAULT_BINDINGS: Readonly<Record<VesselMode, KeyBindings>> = {
  csm: {
    ...PAUSE,
    KeyW: ['thrust'],
    ArrowUp: ['thrust'],
    Space: ['thrust'],
    KeyA: ['rotateCCW'],
    ArrowLeft: ['rotateCCW'],
    KeyD: ['rotateCW'],
    ArrowRight: ['rotateCW'],
  },
  lander: {
    ...PAUSE,
    KeyA: ['engineLeft'],
    ArrowLeft: ['engineLeft'],
    KeyJ: ['engineLeft'],
    KeyD: ['engineRight'],
    ArrowRight: ['engineRight'],
    KeyL: ['engineRight'],
    KeyW: ['thrust'],
    ArrowUp: ['thrust'],
    KeyK: ['thrust'],
    Space: ['thrust'],
    KeyQ: ['topLeft'],
    KeyU: ['topLeft'],
    KeyE: ['topRight'],
    KeyO: ['topRight'],
  },
  harpoon: {
    ...PAUSE,
    Space: ['fire'],
    KeyX: ['release'],
    ShiftLeft: ['release'],
    KeyW: ['reelIn'],
    KeyR: ['reelIn'],
    KeyS: ['reelOut'],
    KeyF: ['reelOut'],
  },
  harpoonThrust: {
    ...PAUSE,
    Space: ['fire'],
    KeyX: ['release'],
    ShiftLeft: ['release'],
    KeyW: ['thrust'],
    KeyA: ['rotateCCW'],
    KeyD: ['rotateCW'],
    KeyR: ['reelIn'],
    KeyF: ['reelOut'],
  },
};

/** Modes in which the arrow keys aim the harpoon. */
const ARROW_AIM_MODES: ReadonlySet<VesselMode> = new Set<VesselMode>(['harpoon', 'harpoonThrust']);

export function emptyFrame(): InputFrame {
  return {
    thrust: false,
    engineLeft: false,
    engineRight: false,
    topLeft: false,
    topRight: false,
    rotateCW: false,
    rotateCCW: false,
    aim: { x: 0, y: 0 },
    aimTarget: null,
    fire: false,
    release: false,
    reelIn: false,
    reelOut: false,
    pause: false,
    restart: false,
  };
}

function normalise(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  return len > 1e-9 ? { x: v.x / len, y: v.y / len } : { x: 0, y: 0 };
}

// ------------------------------------------------------------------ mapper

/** Merges sources into one InputFrame per fixed step. */
export class InputMapper {
  private readonly sources: InputSource[] = [];

  add(source: InputSource): () => void {
    this.sources.push(source);
    return () => {
      const i = this.sources.indexOf(source);
      if (i >= 0) this.sources.splice(i, 1);
    };
  }

  /** Sample every source once (consuming latched presses) and merge. */
  sample(ctx: InputSampleContext): InputFrame {
    const frame = emptyFrame();
    let aim: AimSample | null = null;
    for (const src of this.sources) {
      const s = src.sample(ctx);
      for (const c of CONTROL_IDS) {
        const pressed = s.pressed[c] === true;
        if (isEdgeControl(c)) {
          if (pressed) frame[c] = true;
        } else if (pressed || s.down[c] === true) {
          frame[c] = true;
        }
      }
      if (!aim && s.aim && (s.aim.dir.x !== 0 || s.aim.dir.y !== 0)) aim = s.aim;
    }
    if (aim) {
      frame.aim = normalise(aim.dir);
      frame.aimTarget = aim.target ? { ...aim.target } : null;
    }
    return frame;
  }

  clear(): void {
    for (const s of this.sources) s.clear();
  }

  dispose(): void {
    for (const s of this.sources) s.dispose();
    this.sources.length = 0;
  }
}

// ---------------------------------------------------- latched state helper

/** Down/pressed bookkeeping for a set of string keys (key codes or controls). */
export class LatchedKeys<K extends string = string> {
  private readonly down = new Set<K>();
  private readonly pressed = new Set<K>();

  press(k: K): void {
    if (!this.down.has(k)) this.pressed.add(k);
    this.down.add(k);
  }

  release(k: K): void {
    this.down.delete(k);
  }

  isDown(k: K): boolean {
    return this.down.has(k);
  }

  /** Snapshot and consume presses. */
  take(): { down: ReadonlySet<K>; pressed: ReadonlySet<K> } {
    const out = { down: new Set(this.down), pressed: new Set(this.pressed) };
    this.pressed.clear();
    return out;
  }

  clear(): void {
    this.down.clear();
    this.pressed.clear();
  }
}

// ---------------------------------------------------------------- keyboard

/** Minimal event-target surface (window in the browser, a fake in tests). */
export interface KeyEventTarget {
  addEventListener(type: 'keydown' | 'keyup', fn: (e: KeyboardEvent) => void): void;
  removeEventListener(type: 'keydown' | 'keyup', fn: (e: KeyboardEvent) => void): void;
}

/** Lander control pairs exchanged by the swapped-engines setting. */
const SWAP_PAIRS: readonly (readonly [ControlId, ControlId])[] = [
  ['engineLeft', 'engineRight'],
  ['topLeft', 'topRight'],
];

function swapFlags(f: ControlFlags): void {
  for (const [a, b] of SWAP_PAIRS) {
    const fa = f[a];
    const fb = f[b];
    delete f[a];
    delete f[b];
    if (fb) f[a] = fb;
    if (fa) f[b] = fa;
  }
}

export class KeyboardSource implements InputSource {
  readonly id = 'keyboard';
  private readonly keys = new LatchedKeys<string>();
  private readonly allCodes: ReadonlySet<string>;
  private swapEngines = false;

  constructor(
    private readonly target: KeyEventTarget | null,
    private readonly bindings: Readonly<Record<VesselMode, KeyBindings>> = DEFAULT_BINDINGS,
  ) {
    const codes = new Set<string>(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
    for (const m of Object.values(bindings)) for (const c of Object.keys(m)) codes.add(c);
    this.allCodes = codes;
    target?.addEventListener('keydown', this.onDown);
    target?.addEventListener('keyup', this.onUp);
  }

  /**
   * S9 swapped engines (Settings.swapEngineButtons) on the keyboard: in lander
   * mode the left keys fire the right engine / top thruster and vice versa.
   */
  setSwapEngines(swap: boolean): void {
    this.swapEngines = swap;
  }

  /** Feed a key directly (tests, replays). */
  keyDown(code: string): void {
    this.keys.press(code);
  }

  keyUp(code: string): void {
    this.keys.release(code);
  }

  sample(ctx: InputSampleContext): InputSourceSample {
    const { down, pressed } = this.keys.take();
    const map = this.bindings[ctx.mode];
    const outDown: ControlFlags = {};
    const outPressed: ControlFlags = {};
    for (const code of down) for (const c of map[code] ?? []) outDown[c] = true;
    for (const code of pressed) for (const c of map[code] ?? []) outPressed[c] = true;
    if (this.swapEngines && ctx.mode === 'lander') {
      swapFlags(outDown);
      swapFlags(outPressed);
    }
    let aim: AimSample | null = null;
    if (ARROW_AIM_MODES.has(ctx.mode)) {
      const held = (c: string) => down.has(c) || pressed.has(c);
      const x = (held('ArrowRight') ? 1 : 0) - (held('ArrowLeft') ? 1 : 0);
      const y = (held('ArrowDown') ? 1 : 0) - (held('ArrowUp') ? 1 : 0);
      if (x !== 0 || y !== 0) aim = { dir: { x, y }, target: null };
    }
    return { down: outDown, pressed: outPressed, aim };
  }

  clear(): void {
    this.keys.clear();
  }

  dispose(): void {
    this.target?.removeEventListener('keydown', this.onDown);
    this.target?.removeEventListener('keyup', this.onUp);
    this.keys.clear();
  }

  private readonly onDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // leave browser shortcuts alone
    if (!this.allCodes.has(e.code)) return;
    e.preventDefault(); // arrows / space must not scroll the page
    if (e.repeat) return;
    this.keys.press(e.code);
  };

  private readonly onUp = (e: KeyboardEvent): void => {
    if (!this.allCodes.has(e.code)) return;
    e.preventDefault();
    this.keys.release(e.code);
  };
}

// ----------------------------------------------------------------- pointer

/** Pixel distance (CSS px) a touch must travel before a drag counts as aim. */
export const TOUCH_AIM_DEADZONE = 8;

/**
 * Mouse + touch/pen on the game surface.
 * - Mouse: hovering aims at the pointer (vessel -> pointer, aimTarget set);
 *   left button = fire, right button = release (context menu suppressed).
 * - Touch/pen: dragging aims along the drag (start -> current), no target.
 * On-screen buttons are separate DOM elements above the canvas (UI slice) and
 * never reach this source.
 */
export class PointerSource implements InputSource {
  readonly id = 'pointer';
  private readonly buttons = new LatchedKeys<'fire' | 'release'>();
  private mouse: { x: number; y: number } | null = null;
  private drag: { id: number; sx: number; sy: number; x: number; y: number } | null = null;

  constructor(private readonly el: HTMLElement | null) {
    el?.addEventListener('pointermove', this.onMove);
    el?.addEventListener('pointerdown', this.onDown);
    el?.addEventListener('pointerup', this.onUp);
    el?.addEventListener('pointercancel', this.onCancel);
    el?.addEventListener('pointerleave', this.onLeave);
    el?.addEventListener('contextmenu', this.onContext);
  }

  sample(ctx: InputSampleContext): InputSourceSample {
    const { down, pressed } = this.buttons.take();
    const flags = (s: ReadonlySet<'fire' | 'release'>): ControlFlags => ({ fire: s.has('fire'), release: s.has('release') });
    return { down: flags(down), pressed: flags(pressed), aim: this.aim(ctx) };
  }

  /** Aim for the current pointer state (public for tests). */
  aim(ctx: InputSampleContext): AimSample | null {
    if (this.drag) {
      const dx = this.drag.x - this.drag.sx;
      const dy = this.drag.y - this.drag.sy;
      if (Math.hypot(dx, dy) < TOUCH_AIM_DEADZONE) return null;
      // client px are y-down like the world, and the camera does not rotate
      return { dir: { x: dx, y: dy }, target: null };
    }
    if (this.mouse && ctx.vesselWorldPos) {
      const t = ctx.clientToWorld(this.mouse.x, this.mouse.y);
      return { dir: { x: t.x - ctx.vesselWorldPos.x, y: t.y - ctx.vesselWorldPos.y }, target: t };
    }
    return null;
  }

  /** Simulate pointer input (tests). */
  simulate(e: { type: 'move' | 'down' | 'up' | 'cancel'; pointerType: string; pointerId?: number; button?: number; x: number; y: number }): void {
    const ev = { pointerType: e.pointerType, pointerId: e.pointerId ?? 1, button: e.button ?? 0, clientX: e.x, clientY: e.y } as PointerEvent;
    if (e.type === 'move') this.onMove(ev);
    else if (e.type === 'down') this.onDown(ev);
    else if (e.type === 'up') this.onUp(ev);
    else this.onCancel(ev);
  }

  clear(): void {
    this.buttons.clear();
    this.drag = null;
  }

  dispose(): void {
    const el = this.el;
    el?.removeEventListener('pointermove', this.onMove);
    el?.removeEventListener('pointerdown', this.onDown);
    el?.removeEventListener('pointerup', this.onUp);
    el?.removeEventListener('pointercancel', this.onCancel);
    el?.removeEventListener('pointerleave', this.onLeave);
    el?.removeEventListener('contextmenu', this.onContext);
    this.clear();
  }

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') this.mouse = { x: e.clientX, y: e.clientY };
    else if (this.drag && this.drag.id === e.pointerId) {
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
    }
  };

  private readonly onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') {
      this.mouse = { x: e.clientX, y: e.clientY };
      if (e.button === 0) this.buttons.press('fire');
      else if (e.button === 2) this.buttons.press('release');
      return;
    }
    if (!this.drag) this.drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY };
    try {
      this.el?.setPointerCapture?.(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') {
      if (e.button === 0) this.buttons.release('fire');
      else if (e.button === 2) this.buttons.release('release');
      return;
    }
    if (this.drag && this.drag.id === e.pointerId) this.drag = null;
  };

  private readonly onCancel = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') this.buttons.clear();
    else if (this.drag && this.drag.id === e.pointerId) this.drag = null;
  };

  private readonly onLeave = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') this.mouse = null;
  };

  private readonly onContext = (e: Event): void => {
    e.preventDefault();
  };
}

// ----------------------------------------------------------------- virtual

/**
 * Programmatic source for on-screen touch controls (the UI slice's buttons
 * call press/release/setAim) and for scripted input in tests/demos. Controls
 * are semantic, so bindings do not apply.
 */
export class VirtualControlsSource implements InputSource {
  private readonly controls = new LatchedKeys<ControlId>();
  private aimDir: Vec2 | null = null;

  constructor(readonly id = 'virtual') {}

  press(c: ControlId): void {
    this.controls.press(c);
  }

  release(c: ControlId): void {
    this.controls.release(c);
  }

  /** Tap: press + release before the next tick (still yields one tick). */
  tap(c: ControlId): void {
    this.controls.press(c);
    this.controls.release(c);
  }

  /** World-space aim direction (any length), or null to clear. */
  setAim(dir: Vec2 | null): void {
    this.aimDir = dir ? { ...dir } : null;
  }

  sample(): InputSourceSample {
    const { down, pressed } = this.controls.take();
    const toFlags = (s: ReadonlySet<ControlId>): ControlFlags => {
      const f: ControlFlags = {};
      for (const c of s) f[c] = true;
      return f;
    };
    return { down: toFlags(down), pressed: toFlags(pressed), aim: this.aimDir ? { dir: { ...this.aimDir }, target: null } : null };
  }

  clear(): void {
    this.controls.clear();
    this.aimDir = null;
  }

  dispose(): void {
    this.clear();
  }
}

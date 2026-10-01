/**
 * DOM on-screen touch controls: absolutely positioned elements above the
 * game canvas inside the host box (= the safe area). Sizes are CSS px from
 * touchLayout(), never virtual px, so targets stay ≥ 48 CSS px at any scale.
 * Pointer bookkeeping is TouchModel; this file only wires DOM events and
 * draws the pixel-styled buttons (semi-transparent, chunky 3px border,
 * stepped corners, bitmap-font labels). System buttons (pause / restart)
 * are near-opaque with an amber border + dark inner ring so they stay
 * readable over both a dark sky and bright terrain.
 */

import type { SteeringScheme, VesselMode } from '../../contracts';
import { rasterText } from '../font';
import { touchLayout, type TouchLayout, type TouchLayoutOptions } from './touchLayout';
import { TouchModel, type ControlSink } from './touchModel';

const STYLE_ID = 'tll-touch-style';
const CSS = `
.tll-touch{position:absolute;inset:0;pointer-events:none;z-index:5;touch-action:none;user-select:none;-webkit-user-select:none}
.tll-touch.hidden{display:none}
.tll-btn,.tll-aim{position:absolute;pointer-events:auto;touch-action:none;box-sizing:border-box}
.tll-btn{display:flex;align-items:center;justify-content:center;background:rgba(11,13,20,.38);border:3px solid rgba(216,220,232,.55);
  clip-path:polygon(0 6px,6px 6px,6px 0,calc(100% - 6px) 0,calc(100% - 6px) 6px,100% 6px,100% calc(100% - 6px),calc(100% - 6px) calc(100% - 6px),calc(100% - 6px) 100%,6px 100%,6px calc(100% - 6px),0 calc(100% - 6px));
  box-shadow:inset -3px -3px 0 rgba(0,0,0,.35),inset 3px 3px 0 rgba(255,255,255,.08)}
.tll-btn.down{background:rgba(240,176,48,.45);border-color:rgba(255,240,192,.9);box-shadow:inset 3px 3px 0 rgba(0,0,0,.35)}
.tll-btn.tll-sys{background:rgba(11,13,20,.86);border-color:#f0b030;box-shadow:inset 0 0 0 2px #05060a,inset -3px -3px 0 2px rgba(0,0,0,.45),inset 3px 3px 0 2px rgba(255,240,192,.12)}
.tll-btn.tll-sys canvas{opacity:1}
.tll-btn.tll-sys.down{background:rgba(240,176,48,.9);border-color:#fff0c0;box-shadow:inset 0 0 0 2px #05060a,inset 3px 3px 0 2px rgba(0,0,0,.35)}
.tll-btn canvas,.tll-aim canvas{image-rendering:pixelated;image-rendering:crisp-edges;pointer-events:none;opacity:.9}
.tll-aim{border:2px dashed rgba(216,220,232,.18);display:flex;align-items:flex-end;justify-content:center;padding-bottom:6px}
.tll-stick{position:absolute;pointer-events:none;border:3px solid rgba(240,176,48,.7);box-sizing:border-box}
.tll-knob{position:absolute;pointer-events:none;width:20px;height:20px;margin:-10px 0 0 -10px;background:rgba(240,176,48,.8)}
.tll-joyzone{position:absolute;pointer-events:auto;touch-action:none}
.tll-joy,.tll-nub{position:absolute;pointer-events:none;box-sizing:border-box;
  clip-path:polygon(0 8px,8px 8px,8px 0,calc(100% - 8px) 0,calc(100% - 8px) 8px,100% 8px,100% calc(100% - 8px),calc(100% - 8px) calc(100% - 8px),calc(100% - 8px) 100%,8px 100%,8px calc(100% - 8px),0 calc(100% - 8px))}
.tll-joy{background:rgba(11,13,20,.28);border:3px solid rgba(216,220,232,.32);box-shadow:inset -3px -3px 0 rgba(0,0,0,.3),inset 3px 3px 0 rgba(255,255,255,.06)}
.tll-joy.down{border-color:rgba(240,176,48,.6)}
.tll-nub{background:rgba(216,220,232,.42);border:3px solid rgba(11,13,20,.55);box-shadow:inset -3px -3px 0 rgba(0,0,0,.3),inset 3px 3px 0 rgba(255,255,255,.18)}
.tll-nub.down{background:rgba(240,176,48,.75);border-color:rgba(255,240,192,.9)}
`;

function label(text: string, maxW: number, maxScale = 4): HTMLCanvasElement {
  const cv = rasterText(text, { color: 0xf0f2f8, shadow: 0x0b0d14 });
  // integer CSS scale so the pixel font stays crisp
  const scale = Math.max(1, Math.min(maxScale, Math.floor(maxW / cv.width)));
  cv.style.width = `${cv.width * scale}px`;
  cv.style.height = `${cv.height * scale}px`;
  return cv;
}

export class TouchLayer {
  readonly el: HTMLDivElement;
  readonly model: TouchModel;
  private mode: VesselMode | null = null;
  private layout: TouchLayout | null = null;
  private readonly btnEls = new Map<string, HTMLDivElement>();
  private stick: HTMLDivElement | null = null;
  private knob: HTMLDivElement | null = null;
  /** JOYSTICK: the stick base + nub (null without a stick in the layout). */
  private joy: HTMLDivElement | null = null;
  private nub: HTMLDivElement | null = null;
  /** The stick's grab zone (pointer capture target of a carried stick finger). */
  private joyZone: HTMLDivElement | null = null;
  private lastSize = '';
  private ro: ResizeObserver | null = null;
  private visible = false;
  private opts: TouchLayoutOptions = {};

  constructor(
    private readonly host: HTMLElement,
    sink: ControlSink,
  ) {
    if (!document.getElementById(STYLE_ID)) {
      const st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.model = new TouchModel(sink);
    this.el = document.createElement('div');
    this.el.className = 'tll-touch hidden';
    this.el.dataset.testid = 'touch-layer';
    host.appendChild(this.el);
    this.el.addEventListener('pointerdown', this.onDown);
    this.el.addEventListener('pointermove', this.onMove);
    this.el.addEventListener('pointerup', this.onUp);
    this.el.addEventListener('pointercancel', this.onCancel);
    this.el.addEventListener('lostpointercapture', this.onLostCapture);
    this.el.addEventListener('contextmenu', this.onContext);
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.relayout());
      this.ro.observe(host);
    }
    window.addEventListener('resize', this.relayout);
    window.addEventListener('blur', this.onBlur);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  getLayout(): TouchLayout | null {
    return this.layout;
  }

  /** Show for `mode` (rebuilds when the mode changes), or hide with null. */
  show(mode: VesselMode | null): void {
    const vis = mode !== null;
    if (!vis) {
      this.model.clear();
      this.visible = false;
      this.el.classList.add('hidden');
      this.syncPressed();
      return;
    }
    this.visible = true;
    this.el.classList.remove('hidden');
    if (mode !== this.mode) {
      this.mode = mode;
      this.lastSize = '';
    }
    this.relayout();
  }

  /** S9: swapped engine buttons (Settings.swapEngineButtons); rebuilds the buttons (releasing held ones) when it changes. */
  setSwapEngines(swap: boolean): void {
    if (!!this.opts.swapEngines === swap) return;
    this.opts = { ...this.opts, swapEngines: swap };
    this.lastSize = '';
    this.relayout();
  }

  /** DIRECT steering: lander / csm drop their flight buttons (rebuilds, releasing held ones, when it changes). */
  setDirectSteering(direct: boolean): void {
    this.setSteering(direct ? 'direct' : 'engines');
  }

  /**
   * Flight scheme: DIRECT drops the lander / csm flight buttons, JOYSTICK replaces them with the
   * virtual stick (rebuilds, releasing held controls, when it changes).
   */
  setSteering(s: SteeringScheme): void {
    const direct = s === 'direct';
    const joystick = s === 'joystick';
    if (!!this.opts.direct === direct && !!this.opts.joystick === joystick) return;
    this.opts = { ...this.opts, direct, joystick };
    this.lastSize = '';
    this.relayout();
  }

  /** Pause / restart buttons (false: the desktop JOYSTICK layer = the stick alone). */
  setSystemButtons(on: boolean): void {
    if ((this.opts.systemButtons ?? true) === on) return;
    this.opts = { ...this.opts, systemButtons: on };
    this.lastSize = '';
    this.relayout();
  }

  dispose(): void {
    this.model.clear();
    this.ro?.disconnect();
    window.removeEventListener('resize', this.relayout);
    window.removeEventListener('blur', this.onBlur);
    this.el.remove();
  }

  private readonly relayout = (): void => {
    if (!this.visible || !this.mode) return;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const o = this.opts;
    const key = `${this.mode}|${w}|${h}|${!!o.swapEngines}|${!!o.direct}|${!!o.joystick}|${o.systemButtons ?? true}`;
    if (key === this.lastSize) return;
    this.lastSize = key;
    const next = touchLayout(this.mode, w, h, this.opts);
    // same geometry (e.g. a resize event that changed nothing we use): keep the DOM and every touch
    if (this.layout && this.el.childElementCount > 0 && sameLayout(this.layout, next)) return;
    this.layout = next;
    // a finger on the stick survives the rebuild (mobile Safari's toolbar resizes the viewport
    // right where the left thumb is); other controls are released as before
    const carried = this.model.relayout(this.layout);
    this.el.replaceChildren();
    this.btnEls.clear();
    const aim = this.layout.aimZone;
    if (aim) {
      const z = document.createElement('div');
      z.className = 'tll-aim';
      place(z, aim);
      z.appendChild(label('DRAG TO AIM', aim.w * 0.8, 2));
      this.el.appendChild(z);
    }
    for (const b of this.layout.buttons) {
      const d = document.createElement('div');
      d.className = b.system ? 'tll-btn tll-sys' : 'tll-btn';
      d.dataset.control = b.control;
      d.setAttribute('role', 'button');
      d.setAttribute('aria-label', b.control);
      place(d, b.rect);
      d.appendChild(label(b.label, b.rect.w * 0.9));
      this.btnEls.set(b.id, d);
      this.el.appendChild(d);
    }
    const st = this.layout.stick;
    this.joy = this.nub = this.joyZone = null;
    if (st) {
      // grab zone (receives the pointer events), base ring, nub (drawn above, not hit-tested)
      const z = document.createElement('div');
      z.className = 'tll-joyzone';
      z.dataset.testid = 'joystick-zone';
      place(z, st.zone);
      this.joyZone = z;
      this.joy = document.createElement('div');
      this.joy.className = 'tll-joy';
      place(this.joy, { x: st.cx - st.r, y: st.cy - st.r, w: st.r * 2, h: st.r * 2 });
      this.nub = document.createElement('div');
      this.nub.className = 'tll-nub';
      const n = Math.round(st.r * 0.8);
      place(this.nub, { x: st.cx - n / 2, y: st.cy - n / 2, w: n, h: n });
      this.el.append(z, this.joy, this.nub);
      // the old zone (the capture target) is gone: capture the carried fingers on the new one so
      // their moves / lift keep arriving wherever the thumb goes
      for (const id of carried) {
        try {
          z.setPointerCapture?.(id);
        } catch {
          /* pointer already gone: its up / cancel arrives (or clear() on blur) */
        }
      }
    }
    this.stick = document.createElement('div');
    this.stick.className = 'tll-stick';
    this.knob = document.createElement('div');
    this.knob.className = 'tll-knob';
    this.el.append(this.stick, this.knob);
    this.syncPressed();
  };

  private local(e: PointerEvent): { x: number; y: number } {
    const r = this.host.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = this.local(e);
    if (this.model.down(e.pointerId, p.x, p.y)) {
      e.preventDefault();
      e.stopPropagation();
      // capture on the layer so moves keep arriving (and we hit-test ourselves for slide-off)
      try {
        (e.target as Element).setPointerCapture?.(e.pointerId);
      } catch {
        /* best effort */
      }
    }
    this.syncPressed();
  };

  private readonly onMove = (e: PointerEvent): void => {
    const p = this.local(e);
    this.model.move(e.pointerId, p.x, p.y);
    this.syncPressed();
  };

  private readonly onUp = (e: PointerEvent): void => {
    this.model.up(e.pointerId);
    this.syncPressed();
  };

  private readonly onCancel = (e: PointerEvent): void => {
    this.model.cancel(e.pointerId);
    this.syncPressed();
  };

  /** Capture lost = treat as cancel, unless a relayout just moved it onto the new stick zone. */
  private readonly onLostCapture = (e: PointerEvent): void => {
    try {
      if (this.joyZone?.hasPointerCapture?.(e.pointerId)) return;
    } catch {
      /* fall through */
    }
    this.onCancel(e);
  };

  private readonly onBlur = (): void => {
    this.model.clear();
    this.syncPressed();
  };

  private readonly onContext = (e: Event): void => {
    e.preventDefault();
  };

  /**
   * Reflect the model in the DOM. Runs on every pointer event (up to 120 Hz per
   * finger on iPhones), so it only WRITES what changed: an unchanged write still
   * dirties style/layout, and the next event's getBoundingClientRect would then
   * force a synchronous layout.
   */
  private syncPressed(): void {
    const held = this.model.heldButtons();
    for (const [id, el] of this.btnEls) {
      const down = held.has(id);
      if (el.classList.contains('down') !== down) el.classList.toggle('down', down);
    }
    const st = this.layout?.stick;
    if (st && this.joy && this.nub) {
      // the nub follows the finger, clamped to the base radius; centred when nobody holds the stick
      const held = this.model.stickHeld();
      let nx = st.cx;
      let ny = st.cy;
      if (held) {
        const dx = held.x - st.cx;
        const dy = held.y - st.cy;
        const len = Math.hypot(dx, dy);
        const k = len > st.r ? st.r / len : 1;
        nx += dx * k;
        ny += dy * k;
      }
      const n = Math.round(st.r * 0.8);
      setStyle(this.nub, 'left', `${Math.round(nx - n / 2)}px`);
      setStyle(this.nub, 'top', `${Math.round(ny - n / 2)}px`);
      if (this.nub.classList.contains('down') !== !!held) {
        this.nub.classList.toggle('down', !!held);
        this.joy.classList.toggle('down', !!held);
      }
    }
    const drag = this.model.aimDrag();
    if (this.stick && this.knob) {
      const display = drag ? 'block' : 'none';
      setStyle(this.stick, 'display', display);
      setStyle(this.knob, 'display', display);
      if (drag) {
        const R = 36;
        setStyle(this.stick, 'left', `${drag.sx - R}px`);
        setStyle(this.stick, 'top', `${drag.sy - R}px`);
        setStyle(this.stick, 'width', `${R * 2}px`);
        setStyle(this.stick, 'height', `${R * 2}px`);
        const dx = drag.x - drag.sx;
        const dy = drag.y - drag.sy;
        const len = Math.hypot(dx, dy);
        const k = len > R ? R / len : 1;
        setStyle(this.knob, 'left', `${drag.sx + dx * k}px`);
        setStyle(this.knob, 'top', `${drag.sy + dy * k}px`);
      }
    }
  }
}

/** Two layouts are the same geometry (the DOM need not be rebuilt). */
export function sameLayout(a: TouchLayout, b: TouchLayout): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function place(el: HTMLElement, r: { x: number; y: number; w: number; h: number }): void {
  el.style.left = `${r.x}px`;
  el.style.top = `${r.y}px`;
  el.style.width = `${r.w}px`;
  el.style.height = `${r.h}px`;
}

/** Touch capability detection (coarse pointer or touch points), plus a live "first touch seen" hook. */
export function detectTouch(win: Window = window): boolean {
  try {
    // a coarse pointer alone is not enough (some desktop setups report one): require touch points too
    const points = win.navigator.maxTouchPoints ?? 0;
    return points > 0 && (!!win.matchMedia?.('(pointer: coarse)').matches || !!win.matchMedia?.('(any-pointer: coarse)').matches);
  } catch {
    return false;
  }
}

/** Write an inline style property only when it changes. */
function setStyle(el: HTMLElement, prop: 'display' | 'left' | 'top' | 'width' | 'height', value: string): void {
  if (el.style[prop] !== value) el.style[prop] = value;
}

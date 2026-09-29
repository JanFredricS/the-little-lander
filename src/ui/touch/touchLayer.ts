/**
 * DOM on-screen touch controls: absolutely positioned elements above the
 * game canvas inside the host box (= the safe area). Sizes are CSS px from
 * touchLayout(), never virtual px, so targets stay ≥ 48 CSS px at any scale.
 * Pointer bookkeeping is TouchModel; this file only wires DOM events and
 * draws the pixel-styled buttons (semi-transparent, chunky 3px border,
 * stepped corners, bitmap-font labels).
 */

import type { VesselMode } from '../../contracts';
import { rasterText } from '../font';
import { touchLayout, type TouchLayout } from './touchLayout';
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
.tll-btn canvas,.tll-aim canvas{image-rendering:pixelated;image-rendering:crisp-edges;pointer-events:none;opacity:.9}
.tll-aim{border:2px dashed rgba(216,220,232,.18);display:flex;align-items:flex-end;justify-content:center;padding-bottom:6px}
.tll-stick{position:absolute;pointer-events:none;border:3px solid rgba(240,176,48,.7);box-sizing:border-box}
.tll-knob{position:absolute;pointer-events:none;width:20px;height:20px;margin:-10px 0 0 -10px;background:rgba(240,176,48,.8)}
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
  private lastSize = '';
  private ro: ResizeObserver | null = null;
  private visible = false;

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
    this.el.addEventListener('lostpointercapture', this.onCancel);
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
    const key = `${this.mode}|${w}|${h}`;
    if (key === this.lastSize) return;
    this.lastSize = key;
    this.layout = touchLayout(this.mode, w, h);
    this.model.setLayout(this.layout);
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
      d.className = 'tll-btn';
      d.dataset.control = b.control;
      d.setAttribute('role', 'button');
      d.setAttribute('aria-label', b.control);
      place(d, b.rect);
      d.appendChild(label(b.label, b.rect.w * 0.75));
      this.btnEls.set(b.id, d);
      this.el.appendChild(d);
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

  private readonly onBlur = (): void => {
    this.model.clear();
    this.syncPressed();
  };

  private readonly onContext = (e: Event): void => {
    e.preventDefault();
  };

  private syncPressed(): void {
    const held = this.model.heldButtons();
    for (const [id, el] of this.btnEls) el.classList.toggle('down', held.has(id));
    const drag = this.model.aimDrag();
    if (this.stick && this.knob) {
      const show = !!drag;
      this.stick.style.display = show ? 'block' : 'none';
      this.knob.style.display = show ? 'block' : 'none';
      if (drag) {
        const R = 36;
        this.stick.style.left = `${drag.sx - R}px`;
        this.stick.style.top = `${drag.sy - R}px`;
        this.stick.style.width = this.stick.style.height = `${R * 2}px`;
        const dx = drag.x - drag.sx;
        const dy = drag.y - drag.sy;
        const len = Math.hypot(dx, dy);
        const k = len > R ? R / len : 1;
        this.knob.style.left = `${drag.sx + dx * k}px`;
        this.knob.style.top = `${drag.sy + dy * k}px`;
      }
    }
  }
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
    return !!win.matchMedia?.('(pointer: coarse)').matches || (win.navigator.maxTouchPoints ?? 0) > 0 && !!win.matchMedia?.('(any-pointer: coarse)').matches;
  } catch {
    return false;
  }
}

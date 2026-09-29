/**
 * Multi-touch bookkeeping for the on-screen controls (pure; DOM-free so it
 * is unit-tested). Coordinates are CSS px in the host box (same space as
 * TouchLayout rects).
 *
 * Rules (contracts/input.ts):
 *  - Each pointerId is tracked independently (both engines at once).
 *  - A HOLD button is down while at least one pointer is on it. Sliding off
 *    releases it; sliding onto another HOLD button presses that one (thumb
 *    rolling between L/R engines or rotate buttons).
 *  - A TAP button (fire / release / pause) presses on pointerdown and
 *    releases on pointerup / slide-off; sliding onto one never presses it.
 *  - pointercancel releases everything that pointer held.
 *  - A pointer that starts in the aim zone (not on a button) drives the aim:
 *    dir = current - start once past AIM_DEADZONE. The last aim sticks after
 *    the finger lifts (aim, then fire with the other thumb) until clear().
 */

import type { ControlId, Vec2 } from '../../contracts';
import { contains, type TouchButton, type TouchLayout } from './touchLayout';

/** CSS px a drag must travel before it aims (matches TOUCH_AIM_DEADZONE in shell/input.ts). */
export const AIM_DEADZONE = 8;

/** Where presses go: App.virtual (VirtualControlsSource) in the game. */
export interface ControlSink {
  press(c: ControlId): void;
  release(c: ControlId): void;
  setAim(dir: Vec2 | null): void;
}

type Owner = { kind: 'button'; button: TouchButton } | { kind: 'aim'; sx: number; sy: number; x: number; y: number } | { kind: 'none' };

export class TouchModel {
  private layout: TouchLayout | null = null;
  private readonly pointers = new Map<number, Owner>();
  /** Pointer count per control (a control may be held by two fingers). */
  private readonly holds = new Map<ControlId, number>();
  private lastAim: Vec2 | null = null;

  constructor(private readonly sink: ControlSink) {}

  setLayout(layout: TouchLayout | null): void {
    this.clear();
    this.layout = layout;
  }

  getLayout(): TouchLayout | null {
    return this.layout;
  }

  /** Button ids currently held (for pressed-state visuals). */
  heldButtons(): Set<string> {
    const out = new Set<string>();
    for (const o of this.pointers.values()) if (o.kind === 'button') out.add(o.button.id);
    return out;
  }

  /** Active aim drag (start/current) for the aim-stick visual, or null. */
  aimDrag(): { sx: number; sy: number; x: number; y: number } | null {
    for (const o of this.pointers.values()) if (o.kind === 'aim') return { sx: o.sx, sy: o.sy, x: o.x, y: o.y };
    return null;
  }

  stickyAim(): Vec2 | null {
    return this.lastAim ? { ...this.lastAim } : null;
  }

  buttonAt(x: number, y: number): TouchButton | null {
    if (!this.layout) return null;
    for (const b of this.layout.buttons) if (contains(b.rect, x, y)) return b;
    return null;
  }

  /** Returns true when the pointer landed on a control (caller should capture it). */
  down(id: number, x: number, y: number): boolean {
    if (!this.layout || this.pointers.has(id)) return false;
    const b = this.buttonAt(x, y);
    if (b) {
      this.pointers.set(id, { kind: 'button', button: b });
      this.hold(b.control);
      return true;
    }
    if (this.layout.aimZone && contains(this.layout.aimZone, x, y)) {
      this.pointers.set(id, { kind: 'aim', sx: x, sy: y, x, y });
      return true;
    }
    return false;
  }

  move(id: number, x: number, y: number): void {
    const o = this.pointers.get(id);
    if (!o) return;
    if (o.kind === 'aim') {
      o.x = x;
      o.y = y;
      const dx = x - o.sx;
      const dy = y - o.sy;
      if (Math.hypot(dx, dy) >= AIM_DEADZONE) {
        // client px are y-down like the world and the camera never rotates
        this.lastAim = { x: dx, y: dy };
        this.sink.setAim(this.lastAim);
      }
      return;
    }
    if (o.kind !== 'button') return;
    if (contains(o.button.rect, x, y)) return;
    // slid off
    this.unhold(o.button.control);
    const next = this.buttonAt(x, y);
    if (o.button.kind === 'hold' && next && next.kind === 'hold') {
      this.pointers.set(id, { kind: 'button', button: next });
      this.hold(next.control);
    } else {
      this.pointers.set(id, { kind: 'none' });
    }
  }

  up(id: number): void {
    const o = this.pointers.get(id);
    if (!o) return;
    this.pointers.delete(id);
    if (o.kind === 'button') this.unhold(o.button.control);
  }

  /** pointercancel: release everything this pointer held. */
  cancel(id: number): void {
    this.up(id);
  }

  /** Forget everything (blur, pause, screen change, mode change). */
  clear(): void {
    for (const [c, n] of this.holds) if (n > 0) this.sink.release(c);
    this.holds.clear();
    this.pointers.clear();
    if (this.lastAim) this.sink.setAim(null);
    this.lastAim = null;
  }

  private hold(c: ControlId): void {
    const n = this.holds.get(c) ?? 0;
    this.holds.set(c, n + 1);
    if (n === 0) this.sink.press(c);
  }

  private unhold(c: ControlId): void {
    const n = this.holds.get(c) ?? 0;
    if (n <= 1) {
      this.holds.delete(c);
      if (n === 1) this.sink.release(c);
    } else this.holds.set(c, n - 1);
  }
}

export type TouchPref = 'auto' | 'on' | 'off';

/** Whether the on-screen layer is shown (Settings.touchControls semantics). */
export function touchVisible(pref: TouchPref, touchDetected: boolean): boolean {
  return pref === 'on' || (pref === 'auto' && touchDetected);
}

export function nextTouchPref(p: TouchPref): TouchPref {
  return p === 'auto' ? 'on' : p === 'on' ? 'off' : 'auto';
}

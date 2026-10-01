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
 *  - JOYSTICK (round 8): a pointer that starts in the stick's grab zone (not
 *    on a button) owns the stick: every move reports the steer =
 *    stickVector() (null inside the deadzone = coast); lifting / cancelling
 *    centres it (steer null). Unlike the aim, a steer never sticks.
 *    A second finger that starts in the zone while the stick is held cannot
 *    steal it: it waits (tracked, captured). When the owner lifts, a waiting
 *    finger that is still inside the zone takes the stick over from where it is.
 *  - relayout() (viewport resize - e.g. mobile Safari's toolbar, which the
 *    bottom-edge thumb summons - rotation, a settings rebuild) keeps the stick
 *    finger(s) when the new layout still has a stick on the same side (its grab
 *    zone overlaps the old one); everything else - and a stick that moved to the
 *    other side (LAYOUT swap) - is released as with setLayout().
 */

import type { ControlId, Vec2 } from '../../contracts';
import { contains, overlaps, stickVector, type TouchButton, type TouchLayout } from './touchLayout';

/** CSS px a drag must travel before it aims (matches TOUCH_AIM_DEADZONE in shell/input.ts). */
export const AIM_DEADZONE = 8;

/** Where presses go: App.virtual (VirtualControlsSource) in the game. */
export interface ControlSink {
  press(c: ControlId): void;
  release(c: ControlId): void;
  setAim(dir: Vec2 | null): void;
  /** JOYSTICK steering: the stick's thrust direction (any length), or null = centred / released (coast). */
  setSteer?(dir: Vec2 | null): void;
}

type Owner =
  | { kind: 'button'; button: TouchButton }
  | { kind: 'aim'; sx: number; sy: number; x: number; y: number }
  | { kind: 'stick'; x: number; y: number }
  /** Started in the stick zone while another finger held the stick: takes over when that one lifts. */
  | { kind: 'stickWait'; x: number; y: number }
  | { kind: 'none' };

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

  /**
   * New layout for the same session of touches (resize / rotation / rebuild). When both the old
   * and the new layout have a stick, the stick finger (and any waiting one) stay tracked and the
   * steer is re-read against the new stick; everything else is released (setLayout). Returns the
   * pointer ids kept, which the DOM layer re-captures on its new elements.
   */
  relayout(layout: TouchLayout | null): number[] {
    const keep: [number, Owner][] = [];
    // round 11: only while the stick stays on its side - after a LAYOUT swap the finger is across
    // the screen from the new base (it would read as a full deflection): released instead
    const stay = !!layout?.stick && !!this.layout?.stick && overlaps(layout.stick.zone, this.layout.stick.zone);
    if (stay) for (const [id, o] of this.pointers) if (o.kind === 'stick' || o.kind === 'stickWait') keep.push([id, o]);
    if (keep.length === 0) {
      this.setLayout(layout);
      return [];
    }
    for (const [id] of keep) this.pointers.delete(id); // clear() must not centre the stick
    this.clear();
    this.layout = layout;
    for (const [id, o] of keep) this.pointers.set(id, o);
    const held = this.stickHeld();
    if (held) this.sink.setSteer?.(stickVector(layout!.stick!, held.x, held.y));
    return keep.map(([id]) => id);
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

  /** The finger on the virtual stick (for the nub visual), or null when nobody holds it. */
  stickHeld(): { x: number; y: number } | null {
    for (const o of this.pointers.values()) if (o.kind === 'stick') return o;
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
    const stick = this.layout.stick;
    if (stick && contains(stick.zone, x, y)) {
      if (this.stickHeld()) {
        this.pointers.set(id, { kind: 'stickWait', x, y }); // no stealing: waits for the owner to lift
        return true;
      }
      this.pointers.set(id, { kind: 'stick', x, y });
      this.sink.setSteer?.(stickVector(stick, x, y));
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
    if (o.kind === 'stick' || o.kind === 'stickWait') {
      o.x = x;
      o.y = y;
      if (o.kind === 'stick' && this.layout?.stick) this.sink.setSteer?.(stickVector(this.layout.stick, x, y));
      return;
    }
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
    else if (o.kind === 'stick') {
      // a finger already resting in the zone takes the stick over; else it centres
      const stick = this.layout?.stick;
      for (const [nid, n] of this.pointers) {
        if (n.kind === 'stickWait' && stick && contains(stick.zone, n.x, n.y)) {
          this.pointers.set(nid, { kind: 'stick', x: n.x, y: n.y });
          this.sink.setSteer?.(stickVector(stick, n.x, n.y));
          return;
        }
      }
      this.sink.setSteer?.(null);
    }
  }

  /** pointercancel: release everything this pointer held. */
  cancel(id: number): void {
    this.up(id);
  }

  /** Forget everything (blur, pause, screen change, mode change). */
  clear(): void {
    for (const [c, n] of this.holds) if (n > 0) this.sink.release(c);
    this.holds.clear();
    const stickHeld = !!this.stickHeld();
    this.pointers.clear();
    if (stickHeld) this.sink.setSteer?.(null);
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

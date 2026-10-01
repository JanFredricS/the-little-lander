/**
 * On-screen touch control layout per vessel mode (pure). Rects are CSS px
 * relative to the game host box, which IS the safe area (#app is inset by
 * env(safe-area-inset-*)), so every target sits inside the safe area.
 * Every target is ≥ MIN_TOUCH_CSS (48 CSS px) in both dimensions.
 *
 *   csm            ◀ ▶ bottom-left (rotate) · THRUST bottom-right
 *   lander         L ENGINE bottom-left · R ENGINE bottom-right (thumb zones),
 *                  TOP L / TOP R (S9 top thrusters, ~0.7× size) above them.
 *                  S9 swap (Settings.swapEngineButtons, the default): the
 *                  LEFT buttons fire the RIGHT engine / top thruster and vice
 *                  versa, so the lander tilts toward the button you press.
 *   harpoon        aim drag zone left · FIRE / REL / ▲ IN / ▼ OUT bottom-right
 *   harpoonThrust  harpoon + THRUST (right) + ◀ ▶ rotate (bottom-left)
 *   DIRECT steering (Settings.steering = 'direct') in lander / csm: no flight
 *                  buttons - holding anywhere else on the play area steers
 *                  (the canvas PointerSource), so only the system buttons stay.
 *   JOYSTICK (Settings.steering = 'joystick', round 8) in lander / csm: no
 *                  flight buttons; a virtual stick anchored bottom-left (left
 *                  thumb) feeds the same DIRECT steering layer. A touch that
 *                  starts in its grab zone (the lower-left quarter-ish) owns
 *                  it; the stick direction = the thrust direction, the centre
 *                  deadzone (and letting go) = coast. On a desktop without
 *                  touch controls the layout is the stick alone (no system
 *                  buttons: Esc / Backspace) and the mouse can drag it.
 *   Round 11 LAYOUT (Settings.stickSide = 'right', option stickRight): the
 *                  stick anchors lower-RIGHT (zone mirrored, right half only)
 *                  and the classic CSM buttons swap sides (THRUST lower-left,
 *                  ◀ ▶ lower-right, still in that order). The lander's engine
 *                  buttons are symmetric (each side's button = that side's
 *                  engine, mirroring would only swap meanings: see the swap
 *                  setting) and the harpoon modes keep their layout.
 *   all modes      II pause, top centre · ↻ restart level, top-left
 *                  ("system" buttons: opaque, high-contrast, see touchLayer.ts)
 */

import type { ControlId, Rect, VesselMode } from '../../contracts';
import { isDirectSteerMode } from '../../shell/directSteering';
import { MIN_TOUCH_CSS } from '../menu';

export type TouchButtonKind = 'hold' | 'tap';

export interface TouchButton {
  id: string;
  control: ControlId;
  label: string;
  /** hold: down while touched (sliding across hold buttons moves the press). tap: edge controls (fire/release/pause/restart). */
  kind: TouchButtonKind;
  rect: Rect;
  /** Shell buttons (pause / restart): drawn opaque with a bright border so they read on any background. */
  system?: boolean;
}

export interface TouchLayout {
  mode: VesselMode;
  buttons: TouchButton[];
  /** Drag-to-aim region (harpoon modes), or null. */
  aimZone: Rect | null;
  /** JOYSTICK steering: the virtual stick (lander / csm), or null. */
  stick: TouchStick | null;
}

/** Virtual stick (CSS px): base centre + radius (full deflection), and the zone a touch must start in to grab it. */
export interface TouchStick {
  cx: number;
  cy: number;
  r: number;
  zone: Rect;
}

/** Stick deadzone as a fraction of its radius: inside it the stick reads centred (coast). */
export const STICK_DEADZONE = 0.22;

/**
 * Stick deflection for a finger at (x, y): the direction from the base centre with
 * magnitude min(1, distance / r) (y-down, like the world: the camera never rotates),
 * or null inside the deadzone (= coast).
 */
// NOTE: the DIRECT layer currently ignores the magnitude by design (no throttle): any deflection past the deadzone = full thrust that way.
export function stickVector(stick: Pick<TouchStick, 'cx' | 'cy' | 'r'>, x: number, y: number): { x: number; y: number } | null {
  const dx = x - stick.cx;
  const dy = y - stick.cy;
  const len = Math.hypot(dx, dy);
  if (len < STICK_DEADZONE * stick.r) return null;
  const k = Math.min(1, len / stick.r) / len;
  return { x: dx * k, y: dy * k };
}

export interface LayoutMetrics {
  /** Base button edge (CSS px). */
  size: number;
  margin: number;
  gap: number;
}

export function layoutMetrics(w: number, h: number): LayoutMetrics {
  const short = Math.max(1, Math.min(w, h));
  const size = Math.round(Math.min(96, Math.max(56, short * 0.2)));
  return { size, margin: Math.round(Math.max(10, short * 0.03)), gap: Math.round(Math.max(8, size * 0.15)) };
}

const r = (x: number, y: number, w: number, h: number): Rect => ({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });

export interface TouchLayoutOptions {
  /** Lander: left-side buttons fire the right-side engines and vice versa (labels name the engine that fires). */
  swapEngines?: boolean;
  /** DIRECT steering: lander / csm show only the system buttons (the play area itself is the control). */
  direct?: boolean;
  /** JOYSTICK steering: lander / csm show the virtual stick (bottom-left) instead of flight buttons. */
  joystick?: boolean;
  /** Pause / restart buttons (default true; false = the desktop joystick-only layout). */
  systemButtons?: boolean;
  /** Round 11 LAYOUT: the stick lower-right (and the classic CSM buttons mirrored). Default false. */
  stickRight?: boolean;
}

export function touchLayout(mode: VesselMode, w: number, h: number, opts: TouchLayoutOptions = {}): TouchLayout {
  const { size: s, margin: m, gap: g } = layoutMetrics(w, h);
  const big = Math.round(s * 1.25);
  const pauseSize = Math.max(MIN_TOUCH_CSS, Math.round(s * 0.7));
  const buttons: TouchButton[] =
    opts.systemButtons === false
      ? []
      : [
          { id: 'pause', control: 'pause', label: 'II', kind: 'tap', system: true, rect: r((w - pauseSize) / 2, m, pauseSize, pauseSize) },
          { id: 'restart', control: 'restart', label: '↻', kind: 'tap', system: true, rect: r(m, m, pauseSize, pauseSize) },
        ];
  let aimZone: Rect | null = null;

  const bottom = h - m;
  const right = w - m;
  const rotateLeft = (x0 = m) => {
    buttons.push(
      { id: 'rotateCCW', control: 'rotateCCW', label: '◀', kind: 'hold', rect: r(x0, bottom - s, s, s) },
      { id: 'rotateCW', control: 'rotateCW', label: '▶', kind: 'hold', rect: r(x0 + s + g, bottom - s, s, s) },
    );
  };
  const harpoonCluster = () => {
    // bottom row: REL  FIRE(big) ; row above: ▼OUT  ▲IN
    const fire = r(right - big, bottom - big, big, big);
    const rel = r(fire.x - g - s, bottom - s, s, s);
    const inB = r(right - s - (big - s) / 2, fire.y - g - s, s, s);
    const out = r(rel.x, inB.y, s, s);
    buttons.push(
      { id: 'fire', control: 'fire', label: 'FIRE', kind: 'tap', rect: fire },
      { id: 'release', control: 'release', label: 'REL', kind: 'tap', rect: rel },
      { id: 'reelIn', control: 'reelIn', label: '▲IN', kind: 'hold', rect: inB },
      { id: 'reelOut', control: 'reelOut', label: '▼OUT', kind: 'hold', rect: out },
    );
    return { left: rel.x, top: inB.y };
  };

  if (opts.joystick && isDirectSteerMode(mode)) {
    // left thumb: base clear of the corner by a quarter radius; grab zone = the lower-left area
    // under the system buttons, at most half the width (the right half stays free: minimap)
    const R = Math.round(s * 0.85);
    const pad = Math.round(R * 0.25);
    const lx = m + pad + R; // centre x on the left side
    const cy = bottom - pad - R;
    const top = Math.max(m + pauseSize + g, cy - 2 * R);
    const zw = Math.min(w / 2, lx + 2 * R);
    // LAYOUT right: the mirror image (lower-right, the left half stays free: minimap)
    const cx = opts.stickRight ? Math.round(w - lx) : lx;
    // right: the edge from the ROUNDED width (an odd w would push a half-px zone 1 px off-screen)
    const zone = opts.stickRight ? r(w - Math.round(zw), top, Math.round(zw), h - top) : r(0, top, zw, h - top);
    return { mode, buttons, aimZone, stick: { cx, cy, r: R, zone } };
  }
  if (opts.direct && isDirectSteerMode(mode)) return { mode, buttons, aimZone, stick: null };
  switch (mode) {
    case 'csm':
      // side-anchored: LAYOUT right mirrors it (THRUST lower-left, ◀ ▶ lower-right in reading order)
      rotateLeft(opts.stickRight ? right - 2 * s - g : m);
      buttons.push({ id: 'thrust', control: 'thrust', label: 'THRUST', kind: 'hold', rect: r(opts.stickRight ? m : right - big, bottom - big, big, big) });
      break;
    case 'lander': {
      const small = Math.max(MIN_TOUCH_CSS, Math.round(big * 0.7));
      const topY = bottom - big - g - small;
      const sw = !!opts.swapEngines;
      const engL = { control: 'engineLeft', label: 'L ENG' } as const;
      const engR = { control: 'engineRight', label: 'R ENG' } as const;
      const topL = { control: 'topLeft', label: 'TOP L' } as const;
      const topR = { control: 'topRight', label: 'TOP R' } as const;
      // ids follow the control (not the side), so pressed-state visuals track the engine
      const at = (c: { control: ControlId; label: string }, rect: Rect): TouchButton => ({ id: c.control, control: c.control, label: c.label, kind: 'hold', rect });
      buttons.push(
        at(sw ? engR : engL, r(m, bottom - big, big, big)),
        at(sw ? engL : engR, r(right - big, bottom - big, big, big)),
        at(sw ? topR : topL, r(m, topY, small, small)),
        at(sw ? topL : topR, r(right - small, topY, small, small)),
      );
      break;
    }
    case 'harpoon': {
      const c = harpoonCluster();
      const top = m + pauseSize + g;
      aimZone = r(m, top, Math.min(w * 0.5, c.left - g) - m, bottom - top);
      break;
    }
    case 'harpoonThrust': {
      const c = harpoonCluster();
      buttons.push({ id: 'thrust', control: 'thrust', label: 'THR', kind: 'hold', rect: r(c.left, c.top - g - s, right - c.left, s) });
      rotateLeft();
      const top = m + pauseSize + g;
      aimZone = r(m, top, Math.min(w * 0.5, c.left - g) - m, bottom - s - g - top);
      break;
    }
  }
  return { mode, buttons, aimZone, stick: null };
}

export function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

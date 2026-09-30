/**
 * On-screen touch control layout per vessel mode (pure). Rects are CSS px
 * relative to the game host box, which IS the safe area (#app is inset by
 * env(safe-area-inset-*)), so every target sits inside the safe area.
 * Every target is ≥ MIN_TOUCH_CSS (48 CSS px) in both dimensions.
 *
 *   csm            ◀ ▶ bottom-left (rotate) · THRUST bottom-right
 *   lander         L ENGINE bottom-left · R ENGINE bottom-right (thumb zones),
 *                  TOP L / TOP R (S9 top thrusters, ~0.7× size) above them
 *   harpoon        aim drag zone left · FIRE / REL / ▲ IN / ▼ OUT bottom-right
 *   harpoonThrust  harpoon + THRUST (right) + ◀ ▶ rotate (bottom-left)
 *   all modes      II pause, top centre
 */

import type { ControlId, Rect, VesselMode } from '../../contracts';
import { MIN_TOUCH_CSS } from '../menu';

export type TouchButtonKind = 'hold' | 'tap';

export interface TouchButton {
  id: string;
  control: ControlId;
  label: string;
  /** hold: down while touched (sliding across hold buttons moves the press). tap: edge controls (fire/release/pause). */
  kind: TouchButtonKind;
  rect: Rect;
}

export interface TouchLayout {
  mode: VesselMode;
  buttons: TouchButton[];
  /** Drag-to-aim region (harpoon modes), or null. */
  aimZone: Rect | null;
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

export function touchLayout(mode: VesselMode, w: number, h: number): TouchLayout {
  const { size: s, margin: m, gap: g } = layoutMetrics(w, h);
  const big = Math.round(s * 1.25);
  const pauseSize = Math.max(MIN_TOUCH_CSS, Math.round(s * 0.7));
  const buttons: TouchButton[] = [{ id: 'pause', control: 'pause', label: 'II', kind: 'tap', rect: r((w - pauseSize) / 2, m, pauseSize, pauseSize) }];
  let aimZone: Rect | null = null;

  const bottom = h - m;
  const right = w - m;
  const rotateLeft = () => {
    buttons.push(
      { id: 'rotateCCW', control: 'rotateCCW', label: '◀', kind: 'hold', rect: r(m, bottom - s, s, s) },
      { id: 'rotateCW', control: 'rotateCW', label: '▶', kind: 'hold', rect: r(m + s + g, bottom - s, s, s) },
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

  switch (mode) {
    case 'csm':
      rotateLeft();
      buttons.push({ id: 'thrust', control: 'thrust', label: 'THRUST', kind: 'hold', rect: r(right - big, bottom - big, big, big) });
      break;
    case 'lander': {
      const small = Math.max(MIN_TOUCH_CSS, Math.round(big * 0.7));
      const topY = bottom - big - g - small;
      buttons.push(
        { id: 'engineLeft', control: 'engineLeft', label: 'L ENG', kind: 'hold', rect: r(m, bottom - big, big, big) },
        { id: 'engineRight', control: 'engineRight', label: 'R ENG', kind: 'hold', rect: r(right - big, bottom - big, big, big) },
        { id: 'topLeft', control: 'topLeft', label: 'TOP L', kind: 'hold', rect: r(m, topY, small, small) },
        { id: 'topRight', control: 'topRight', label: 'TOP R', kind: 'hold', rect: r(right - small, topY, small, small) },
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
  return { mode, buttons, aimZone };
}

export function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

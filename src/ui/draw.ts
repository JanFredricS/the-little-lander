/** Pixel-art drawing helpers on Pixi Graphics (virtual px, integer coords). */

import type { Graphics } from 'pixi.js';
import { UI } from './uiTheme';

/** Chunky panel: dark 1px outline, 1px tinted border, notched corners, translucent fill. */
export function panel(g: Graphics, x: number, y: number, w: number, h: number, border: number, fillAlpha = 0.82, fill: number = UI.panel): Graphics {
  x = Math.round(x);
  y = Math.round(y);
  w = Math.round(w);
  h = Math.round(h);
  // outline (notched)
  g.rect(x + 1, y, w - 2, h).fill({ color: UI.outline, alpha: 0.9 });
  g.rect(x, y + 1, w, h - 2).fill({ color: UI.outline, alpha: 0.9 });
  // border
  g.rect(x + 2, y + 1, w - 4, h - 2).fill(border);
  g.rect(x + 1, y + 2, w - 2, h - 4).fill(border);
  // body
  g.rect(x + 2, y + 2, w - 4, h - 4).fill({ color: fill, alpha: 1 });
  if (fillAlpha < 1) g.rect(x + 2, y + 2, w - 4, h - 4).fill({ color: UI.bg, alpha: 1 - fillAlpha });
  // top rim light
  g.rect(x + 2, y + 2, w - 4, 1).fill({ color: 0xffffff, alpha: 0.08 });
  return g;
}

/** Segmented bar (fills in 2px cells). */
export function bar(g: Graphics, x: number, y: number, w: number, h: number, frac: number, color: number, back = 0x262c3c): Graphics {
  g.rect(x - 1, y - 1, w + 2, h + 2).fill(UI.outline);
  g.rect(x, y, w, h).fill(back);
  const f = Math.max(0, Math.min(1, frac));
  const filled = Math.round(w * f);
  if (filled > 0) {
    g.rect(x, y, filled, h).fill(color);
    g.rect(x, y, filled, 1).fill({ color: 0xffffff, alpha: 0.35 });
    for (let cx = x + 3; cx < x + filled; cx += 4) g.rect(cx, y + 1, 1, h - 1).fill({ color: 0x000000, alpha: 0.25 });
  }
  return g;
}

/** Pixel arrow (8 directions) centred at (cx, cy), `size` px long. */
export function arrow(g: Graphics, cx: number, cy: number, angle: number, size: number, color: number): Graphics {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const half = size / 2;
  const plot = (x: number, y: number) => g.rect(Math.round(x) - 1, Math.round(y) - 1, 3, 3).fill(color);
  for (let t = -half; t <= half; t += 1) plot(cx + dx * t, cy + dy * t);
  const head = size * 0.35;
  for (const s of [-1, 1]) {
    const a = angle + Math.PI + (s * Math.PI) / 4;
    for (let t = 0; t <= head; t += 1) plot(cx + dx * half + Math.cos(a) * t, cy + dy * half + Math.sin(a) * t);
  }
  return g;
}

/**
 * Menu screen renderer (Pixi, virtual px): title (pixel logo + starfield +
 * drifting lander), level list, panels (pause / results / game over /
 * cutscene placeholder), loading. Draws a ScreenModel + MenuState; exposes
 * hit-testing for mouse/touch. Rows are sized by layoutRows() so they reach
 * 48 CSS px when there is room (lists scroll otherwise).
 */

import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { VIEW_HEIGHT, VIEW_WIDTH } from '../contracts';
import type { ArtApi } from '../contracts';
import { panel } from './draw';
import { layoutRows, rowAt, type MenuState, type RowLayout } from './menu';
import { PixelText } from './pixelText';
import type { ScreenModel } from './screens';
import { UI } from './uiTheme';

const ROW_GAP = 4;
const MAX_ROWS = 12;

interface Star {
  x: number;
  y: number;
  layer: number;
  phase: number;
}

function stars(seed: number, n: number): Star[] {
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
  return Array.from({ length: n }, () => ({ x: rnd() * VIEW_WIDTH, y: rnd() * VIEW_HEIGHT, layer: Math.floor(rnd() * 3), phase: rnd() * Math.PI * 2 }));
}

export interface RowsGeometry {
  layout: RowLayout;
  x: number;
  w: number;
  count: number;
  /** First item index drawn (hit tests use what was actually drawn). */
  scroll: number;
}

export class ScreenView {
  readonly root = new Container();
  private readonly bg = new Graphics();
  private readonly fg = new Graphics();
  private readonly heading = new PixelText('', { color: UI.accent, outline: UI.outline });
  private readonly info = new PixelText('', { color: UI.ink, align: 'center' });
  private readonly footer = new PixelText('', { color: UI.dim });
  private readonly toast = new PixelText('', { color: UI.danger, outline: UI.outline });
  private readonly labels: PixelText[] = [];
  private readonly details: PixelText[] = [];
  private readonly lander: Sprite;
  private readonly starField = stars(0x5eed, 110);
  private geom: RowsGeometry | null = null;
  private model: ScreenModel | null = null;
  border: number = UI.ink;
  /** CSS px per virtual px (from the scaler). */
  cssPerVirtual = 1;
  private toastUntil = 0;

  constructor(art: ArtApi) {
    const f = art.getSprite('vessel.lander');
    this.lander = new Sprite(Texture.from(f.canvas as HTMLCanvasElement));
    this.lander.anchor.set(f.pivot.x / Math.max(1, f.width), f.pivot.y / Math.max(1, f.height));
    for (let i = 0; i < MAX_ROWS; i++) {
      this.labels.push(new PixelText('', { color: UI.ink }));
      this.details.push(new PixelText('', { color: UI.dim }));
    }
    this.root.addChild(this.bg, this.lander, this.fg, this.heading, this.info, ...this.labels, ...this.details, this.footer, this.toast);
    this.root.visible = false;
  }

  setModel(model: ScreenModel | null): void {
    this.model = model;
    this.geom = null; // nothing hit-testable until the new model is drawn
    this.root.visible = !!model;
    this.toastUntil = 0;
  }

  /** Short red message (e.g. "LOCKED"). */
  flash(text: string, nowMs: number): void {
    this.toast.setText(text);
    this.toastUntil = nowMs + 1200;
  }

  /** Rows geometry of the last render (for hit tests / scrolling). */
  rows(): RowsGeometry | null {
    return this.geom;
  }

  /** Item index at virtual point (as last drawn), or -1. */
  hitTest(vx: number, vy: number): number {
    const g = this.geom;
    if (!g || vx < g.x - 4 || vx > g.x + g.w + 4) return -1;
    const i = rowAt(g.layout, ROW_GAP, vy, g.count - g.scroll);
    return i < 0 ? -1 : i + g.scroll;
  }

  /** Visible row count for the current model at the current scale. */
  visibleRows(): number {
    return this.geom?.layout.visible ?? 1;
  }

  render(menu: MenuState, nowMs: number): void {
    const m = this.model;
    if (!m) return;
    const t = nowMs / 1000;
    const bg = this.bg.clear();
    const fg = this.fg.clear();

    // background
    if (m.overGame) bg.rect(0, 0, VIEW_WIDTH, VIEW_HEIGHT).fill({ color: UI.bg, alpha: 0.6 });
    else {
      bg.rect(0, 0, VIEW_WIDTH, VIEW_HEIGHT).fill(UI.bg);
      for (const s of this.starField) {
        const speed = [2, 5, 11][s.layer]!;
        const x = (((s.x - t * speed) % VIEW_WIDTH) + VIEW_WIDTH) % VIEW_WIDTH;
        const tw = 0.5 + 0.5 * Math.sin(t * 2 + s.phase);
        const c = s.layer === 2 ? 0xf0f2f8 : s.layer === 1 ? 0x9aa4b8 : 0x4a5064;
        bg.rect(Math.floor(x), Math.floor(s.y), 1, 1).fill({ color: c, alpha: 0.35 + 0.65 * tw });
      }
    }
    this.lander.visible = m.kind === 'title';
    if (m.kind === 'title') {
      this.lander.position.set(Math.round(VIEW_WIDTH / 2 + Math.sin(t * 0.4) * 140), Math.round(160 + Math.sin(t * 1.3) * 6));
      this.lander.rotation = Math.sin(t * 0.4 + Math.PI / 2) * 0.15;
      this.lander.scale.set(2);
      // planet horizon
      bg.rect(0, 300, VIEW_WIDTH, 60).fill(0x1a2238);
      bg.rect(0, 300, VIEW_WIDTH, 1).fill(0x4a78b0);
      for (let x = 0; x < VIEW_WIDTH; x += 8) bg.rect(x, 301 + ((x / 8) % 3), 4, 1).fill({ color: 0x2a3858, alpha: 1 });
    }

    // heading / info / rows region per kind
    let rowsTop: number;
    let rowsBottom: number;
    let rowX: number;
    let rowW: number;
    const center = (p: PixelText, y: number) => p.position.set(Math.round(VIEW_WIDTH / 2 - p.width / 2), Math.round(y));
    this.info.setText(m.info.join('\n'));
    this.footer.setText(m.footer);
    center(this.footer, VIEW_HEIGHT - 14);

    if (m.kind === 'title') {
      this.heading.setText(m.heading, { scale: 4, color: UI.accent });
      center(this.heading, 42);
      this.info.setText(m.info.join('\n'), { color: UI.wind });
      center(this.info, 42 + this.heading.height + 10);
      rowsTop = 210;
      rowsBottom = 290;
      rowW = 180;
      rowX = (VIEW_WIDTH - rowW) / 2;
    } else if (m.kind === 'list') {
      this.heading.setText(m.heading, { scale: 2, color: UI.accent });
      center(this.heading, 12);
      this.info.visible = false;
      rowsTop = 40;
      rowsBottom = VIEW_HEIGHT - 26;
      rowW = 480;
      rowX = (VIEW_WIDTH - rowW) / 2;
    } else if (m.kind === 'panel') {
      const pw = 340;
      this.heading.setText(m.heading, { scale: 2, color: m.heading === 'GAME OVER' ? UI.danger : UI.accent });
      // stat blocks (results) read better left-aligned; short lines stay centred
      this.info.setText(m.info.join('\n'), { color: UI.ink, align: m.info.length > 2 ? 'left' : 'center' });
      const infoH = m.info.length ? this.info.height + 10 : 0;
      const probeRow = Math.max(18, Math.ceil(48 / Math.max(0.01, this.cssPerVirtual)));
      const rowsH = m.items.length * (probeRow + ROW_GAP);
      const ph = Math.min(VIEW_HEIGHT - 16, 16 + this.heading.height + 10 + infoH + rowsH + 8);
      const py = Math.round((VIEW_HEIGHT - ph) / 2);
      const px = Math.round((VIEW_WIDTH - pw) / 2);
      panel(fg, px, py, pw, ph, this.border, 0.92);
      center(this.heading, py + 12);
      center(this.info, py + 12 + this.heading.height + 8);
      rowsTop = py + 12 + this.heading.height + 10 + infoH;
      rowsBottom = py + ph - 8;
      rowW = pw - 40;
      rowX = px + 20;
      this.footer.visible = true;
    } else {
      this.heading.setText(m.heading, { scale: 2, color: UI.ink });
      center(this.heading, VIEW_HEIGHT / 2 - 8);
      rowsTop = rowsBottom = 0;
      rowW = rowX = 0;
    }
    this.info.visible = m.kind !== 'list' && m.info.length > 0;

    // rows
    const n = m.items.length;
    const layout = layoutRows(n, { top: rowsTop, bottom: rowsBottom, cssPerVirtual: this.cssPerVirtual, minRow: m.kind === 'list' ? 20 : 18, maxRow: 48, gap: ROW_GAP });
    this.geom = n ? { layout, x: rowX, w: rowW, count: n, scroll: menu.scroll } : null;
    const vis = Math.min(layout.visible, MAX_ROWS);
    for (let i = 0; i < MAX_ROWS; i++) {
      const idx = menu.scroll + i;
      const item = i < vis ? m.items[idx] : undefined;
      const label = this.labels[i]!;
      const detail = this.details[i]!;
      label.visible = detail.visible = !!item;
      if (!item) continue;
      const y = layout.rowY(i);
      const focused = idx === menu.focus;
      const pulse = focused ? 0.5 + 0.5 * Math.sin(t * 6) : 0;
      if (focused) {
        fg.rect(rowX - 1, y - 1, rowW + 2, layout.rowH + 2).fill(UI.outline);
        fg.rect(rowX, y, rowW, layout.rowH).fill(UI.accent);
        fg.rect(rowX + 1, y + 1, rowW - 2, layout.rowH - 2).fill({ color: 0x3a2e14, alpha: 1 - pulse * 0.15 });
      } else {
        fg.rect(rowX, y, rowW, layout.rowH).fill({ color: 0x1c2233, alpha: 0.85 });
        fg.rect(rowX, y + layout.rowH - 1, rowW, 1).fill({ color: 0x000000, alpha: 0.4 });
      }
      const color = !item.enabled ? UI.dim : focused ? UI.light : UI.ink;
      label.setText(focused ? `▶ ${item.label}` : `  ${item.label}`, { color });
      const ly = Math.round(y + (layout.rowH - label.height) / 2);
      if (m.kind === 'list') label.position.set(Math.round(rowX + 8), ly);
      else label.position.set(Math.round(rowX + rowW / 2 - label.width / 2), ly);
      detail.visible = !!item.detail;
      if (item.detail) {
        const dc = item.detail === 'LOCKED' ? UI.danger : item.detail === 'SOON' ? UI.dim : item.detail === 'NEW' ? UI.ok : UI.wind;
        detail.setText(item.detail, { color: dc });
        detail.position.set(Math.round(rowX + rowW - 8 - detail.width), ly);
      }
    }
    // scroll indicators
    if (n > vis) {
      const cx = VIEW_WIDTH / 2;
      if (menu.scroll > 0) this.tri(fg, cx, rowsTop - 6, -1);
      if (menu.scroll + vis < n) this.tri(fg, cx, layout.rowY(vis) + 2, 1);
    }
    this.toast.visible = nowMs < this.toastUntil;
    if (this.toast.visible) center(this.toast, m.kind === 'list' ? 28 : VIEW_HEIGHT - 30);
  }

  private tri(g: Graphics, cx: number, y: number, dir: 1 | -1): void {
    for (let r = 0; r < 4; r++) {
      const yy = dir === 1 ? y + r : y + 3 - r;
      g.rect(Math.round(cx - (3 - r)), Math.round(yy), (3 - r) * 2 + 1, 1).fill(UI.accent);
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}

/**
 * Minimap (round 8): a small window on the level's terrain around the vessel,
 * the vessel as a heading arrow and the exit square marked (pinned to the
 * window edge with an arrow when it is out of range). Bottom-right corner,
 * lifted / shifted clear of any on-screen touch control (minimapPlacement).
 * Always on by default; pause-menu MINIMAP toggle (Settings.showMinimap).
 *
 * PERF (stutter hunt): the WHOLE level is baked ONCE per level start
 * (bakeMinimap: a scanline fill of the terrain pieces at 1/MINIMAP_SCALE plus a
 * 1 px outline, straight into an RGBA buffer - no canvas, no antialiasing)
 * into one static texture. Per frame only numbers move: the texture FRAME
 * (the window), the sprite offset and the marker positions / rotations - no
 * canvas painting, no Graphics rebuild, no allocation (minimapLayout writes
 * into a reused record; the texture is re-UV'd only when the window moved a
 * whole minimap pixel). Baked sizes at 1:16: hangarRun 513×94, descent
 * 150×875, floatingIsles 1125×188, hollow 1000×150, vaults 875×88 ... (all
 * well under the 2048 texture limit; ~0.85 MB RGBA at most). The texture is
 * freed when the player leaves the level for a menu (clear()) and on teardown.
 *
 * KNOWN LIMITATION: the bake is the level's STATIC terrain. Moving islands,
 * crumbling / brittle pieces and other runtime terrain changes are not shown
 * (dynamic markers for them can come later if wanted).
 */

import { BufferImageSource, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import type { ExitDockEntity, LevelSpec, Rect, Vec2 } from '../contracts';
import { UI } from './uiTheme';

/** World px per minimap px. */
export const MINIMAP_SCALE = 16;
/** Minimap window (virtual px, inside the frame): 1,792 × 1,152 world px around the vessel (~2.8 × 3.2 screens). */
export const MINIMAP_W = 112;
export const MINIMAP_H = 72;
/** Frame border around the window (virtual px, each side). */
export const MINIMAP_BORDER = 2;
/**
 * Exit square centre inset from the window edge when it is pinned there (out of
 * range): room for the square (±3) and, outside it, the edge arrow (±3), all
 * inside the window.
 */
export const MINIMAP_EDGE_INSET = 9;
/** Pinned exit: the arrow sits this far from the square's centre, toward the exit. */
const ARROW_OFFSET = 5;
/** Arrow half-extent (its polygon spans -2..3 along and ±3 across): kept this far inside the window. */
const ARROW_HALF = 3;
const EDGE_INSET = MINIMAP_EDGE_INSET;

const FILL = { rgb: UI.dim, a: 150 };
const EDGE = { rgb: UI.ink, a: 255 };

export interface MinimapBake {
  /** Baked size (minimap px) = ceil(world / MINIMAP_SCALE). */
  w: number;
  h: number;
  /** RGBA, premultiplied alpha, row-major. */
  data: Uint8Array;
}

/** Fill outline of a terrain piece: ground / ceiling polylines are closed to the world bottom / top. */
function fillOutline(kind: 'ground' | 'ceiling' | 'polygon', pts: readonly Vec2[], worldH: number): readonly Vec2[] {
  if (kind === 'polygon') return pts;
  const edgeY = kind === 'ground' ? worldH : 0;
  return [...pts, { x: pts[pts.length - 1]!.x, y: edgeY }, { x: pts[0]!.x, y: edgeY }];
}

/**
 * Bake the whole level's terrain at 1/MINIMAP_SCALE: a pixel is solid when its
 * centre is inside a piece (even-odd per piece, pieces OR'd); solid pixels with
 * an empty 4-neighbour are the outline (the world border counts as solid, so the
 * level's own edges are not outlined). Load-time only.
 */
export function bakeMinimap(spec: Pick<LevelSpec, 'worldSize' | 'terrain'>): MinimapBake {
  const S = MINIMAP_SCALE;
  const w = Math.max(1, Math.ceil(spec.worldSize.w / S));
  const h = Math.max(1, Math.ceil(spec.worldSize.h / S));
  const solid = new Uint8Array(w * h);
  const xs: number[] = [];
  for (const piece of spec.terrain.pieces) {
    const poly = fillOutline(piece.kind, piece.points, spec.worldSize.h);
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of poly) {
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    }
    const r0 = Math.max(0, Math.floor(y0 / S - 0.5));
    const r1 = Math.min(h - 1, Math.ceil(y1 / S));
    for (let r = r0; r <= r1; r++) {
      const wy = (r + 0.5) * S;
      xs.length = 0;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i]!;
        const b = poly[j]!;
        if (a.y > wy !== b.y > wy) xs.push(a.x + ((wy - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        // columns whose centre lies in [xs[k], xs[k+1])
        const c0 = Math.max(0, Math.ceil(xs[k]! / S - 0.5));
        const c1 = Math.min(w - 1, Math.ceil(xs[k + 1]! / S - 0.5) - 1);
        for (let c = c0; c <= c1; c++) solid[r * w + c] = 1;
      }
    }
  }
  const data = new Uint8Array(w * h * 4);
  const at = (c: number, r: number) => (c < 0 || r < 0 || c >= w || r >= h ? 1 : solid[r * w + c]!);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (!solid[r * w + c]) continue;
      const edge = !at(c - 1, r) || !at(c + 1, r) || !at(c, r - 1) || !at(c, r + 1);
      const col = edge ? EDGE : FILL;
      const o = (r * w + c) * 4;
      const k = col.a / 255; // premultiplied
      data[o] = Math.round(((col.rgb >> 16) & 0xff) * k);
      data[o + 1] = Math.round(((col.rgb >> 8) & 0xff) * k);
      data[o + 2] = Math.round((col.rgb & 0xff) * k);
      data[o + 3] = col.a;
    }
  }
  return { w, h, data };
}

/** Per-frame minimap geometry (all minimap / virtual px; reused, never reallocated). */
export interface MinimapLayout {
  /** Window origin in baked px (integer). */
  winX: number;
  winY: number;
  /** Texture frame = the window clipped to the baked image (fw / fh 0 = nothing of the level in view). */
  fx: number;
  fy: number;
  fw: number;
  fh: number;
  /** Where that frame's top-left sits inside the window. */
  ox: number;
  oy: number;
  /** Vessel marker inside the window. */
  vx: number;
  vy: number;
  /** Exit marker inside the window (pinned to the edge inset when out of range). */
  hasExit: boolean;
  ex: number;
  ey: number;
  exitInside: boolean;
  /** Direction vessel -> exit (screen radians, 0 = right, y-down), for the edge arrow. */
  exitAngle: number;
  /** Edge arrow centre (pinned exit only), clamped so the whole arrow stays inside the window. */
  ax: number;
  ay: number;
}

export function createMinimapLayout(): MinimapLayout {
  return { winX: 0, winY: 0, fx: 0, fy: 0, fw: 0, fh: 0, ox: 0, oy: 0, vx: 0, vy: 0, hasExit: false, ex: 0, ey: 0, exitInside: false, exitAngle: 0, ax: 0, ay: 0 };
}

/**
 * The window centred on the vessel (world px), clipped to the baked image of
 * `texW` × `texH`; the exit (its rect centre, world px) inside it or pinned to
 * its edge along the vessel -> exit ray. Writes `out` and returns it.
 */
export function minimapLayout(out: MinimapLayout, texW: number, texH: number, vesselX: number, vesselY: number, exit: Pick<ExitDockEntity, 'x' | 'y' | 'h'> | null): MinimapLayout {
  const S = MINIMAP_SCALE;
  const W = MINIMAP_W;
  const H = MINIMAP_H;
  const winX = Math.round(vesselX / S) - (W >> 1);
  const winY = Math.round(vesselY / S) - (H >> 1);
  out.winX = winX;
  out.winY = winY;
  const x0 = Math.max(winX, 0);
  const y0 = Math.max(winY, 0);
  const x1 = Math.min(winX + W, texW);
  const y1 = Math.min(winY + H, texH);
  out.fx = x0;
  out.fy = y0;
  out.fw = Math.max(0, x1 - x0);
  out.fh = Math.max(0, y1 - y0);
  out.ox = x0 - winX;
  out.oy = y0 - winY;
  const vx = vesselX / S - winX;
  const vy = vesselY / S - winY;
  out.vx = vx;
  out.vy = vy;
  out.hasExit = !!exit;
  if (!exit) return out;
  const ex = exit.x / S - winX;
  const ey = (exit.y - exit.h / 2) / S - winY;
  const lo = EDGE_INSET;
  const hiX = W - EDGE_INSET;
  const hiY = H - EDGE_INSET;
  out.exitAngle = Math.atan2(ey - vy, ex - vx);
  out.exitInside = ex >= lo && ex <= hiX && ey >= lo && ey <= hiY;
  if (out.exitInside) {
    out.ex = ex;
    out.ey = ey;
    return out;
  }
  // pin to the inset box along the ray from the vessel (which is inside it)
  const dx = ex - vx;
  const dy = ey - vy;
  let t = 1;
  if (dx > 0) t = Math.min(t, (hiX - vx) / dx);
  else if (dx < 0) t = Math.min(t, (lo - vx) / dx);
  if (dy > 0) t = Math.min(t, (hiY - vy) / dy);
  else if (dy < 0) t = Math.min(t, (lo - vy) / dy);
  t = Math.max(0, t);
  out.ex = Math.min(hiX, Math.max(lo, vx + dx * t));
  out.ey = Math.min(hiY, Math.max(lo, vy + dy * t));
  out.ax = Math.min(W - ARROW_HALF, Math.max(ARROW_HALF, out.ex + ARROW_OFFSET * Math.cos(out.exitAngle)));
  out.ay = Math.min(H - ARROW_HALF, Math.max(ARROW_HALF, out.ey + ARROW_OFFSET * Math.sin(out.exitAngle)));
  return out;
}

/**
 * Where the minimap frame (`w` × `h` virtual px, border included) goes: the
 * bottom-right corner unless an on-screen control (`avoid`, virtual px) is
 * there; then shifted left along the bottom past those controls, else lifted
 * above them in the right column (never above `minTop`: the objectives).
 */
export function minimapPlacement(avoid: readonly Rect[], w: number, h: number, viewW: number, viewH: number, margin = 4, minTop = 80): { x: number; y: number } {
  const hits = (x: number, y: number) => avoid.some((r) => x < r.x + r.w && r.x < x + w && y < r.y + r.h && r.y < y + h);
  const corner = { x: viewW - margin - w, y: viewH - margin - h };
  if (!hits(corner.x, corner.y)) return corner;
  // along the bottom: left of everything in the way, repeatedly
  let x = corner.x;
  for (let k = 0; k < 6 && x >= 0; k++) {
    const blocking = avoid.filter((r) => x < r.x + r.w && r.x < x + w && corner.y < r.y + r.h && r.y < corner.y + h);
    if (blocking.length === 0) break;
    x = Math.min(...blocking.map((r) => r.x)) - margin - w;
  }
  if (x >= viewW / 2 && !hits(x, corner.y)) return { x, y: corner.y };
  // up the right column: above everything in the way
  let y = corner.y;
  for (let k = 0; k < 6 && y >= minTop; k++) {
    const blocking = avoid.filter((r) => corner.x < r.x + r.w && r.x < corner.x + w && y < r.y + r.h && r.y < y + h);
    if (blocking.length === 0) break;
    y = Math.min(...blocking.map((r) => r.y)) - margin - h;
  }
  return { x: corner.x, y: Math.max(minTop, Math.round(y)) };
}

/**
 * The Pixi minimap. setLevel() bakes the level once; render() per frame only
 * moves the texture frame, the sprite and the markers.
 */
export class MinimapView {
  readonly root = new Container();
  private readonly frameG = new Graphics();
  private readonly map = new Container();
  private readonly sprite = new Sprite(Texture.EMPTY);
  private readonly vessel = new Graphics();
  private readonly exitMark = new Graphics();
  private readonly exitArrow = new Graphics();
  private texture: Texture | null = null;
  private texW = 0;
  private texH = 0;
  private exit: ExitDockEntity | null = null;
  private border = NaN;
  private readonly layout = createMinimapLayout();
  /** Last applied texture frame (re-UV only when it changes). */
  private readonly lastFrame = new Float64Array(4).fill(NaN);
  /** Bakes since construction (tests: exactly one per level). */
  bakes = 0;

  constructor() {
    this.map.position.set(MINIMAP_BORDER, MINIMAP_BORDER);
    this.map.addChild(this.sprite, this.exitMark, this.exitArrow, this.vessel);
    this.root.addChild(this.frameG, this.map);
    // markers: drawn once, only moved / rotated per frame
    this.vessel.poly([0, -3, 3, 3, 0, 1.5, -3, 3]).fill(UI.accent).stroke({ color: UI.outline, width: 1, alignment: 1 });
    this.exitMark.rect(-3, -3, 6, 6).fill(UI.ok).rect(-1, -1, 2, 2).fill(UI.outline);
    this.exitArrow.poly([3, 0, -2, -3, -2, 3]).fill(UI.ok);
    this.root.visible = false;
  }

  /**
   * New level: bake its terrain ONCE into a static texture (the previous one is
   * destroyed). `upload` (the App's renderer.texture.initSource) puts it on the
   * GPU now, in the load frame, not in the first gameplay frame.
   */
  setLevel(spec: Pick<LevelSpec, 'worldSize' | 'terrain' | 'objectives' | 'entities'>, upload?: (source: Texture['source']) => void): void {
    const bake = bakeMinimap(spec);
    this.bakes++;
    this.texture?.destroy(true);
    const source = new BufferImageSource({ resource: bake.data, width: bake.w, height: bake.h, scaleMode: 'nearest', alphaMode: 'premultiplied-alpha' });
    this.texture = new Texture({ source, frame: new Rectangle(0, 0, Math.min(bake.w, MINIMAP_W), Math.min(bake.h, MINIMAP_H)), dynamic: true });
    this.sprite.texture = this.texture;
    this.texW = bake.w;
    this.texH = bake.h;
    this.lastFrame.fill(NaN);
    const o = spec.objectives.find((x) => x.kind === 'reachExit');
    this.exit = o && o.kind === 'reachExit' ? (spec.entities.find((e): e is ExitDockEntity => e.kind === 'exitDock' && e.id === o.exitId) ?? null) : null;
    try {
      upload?.(source);
    } catch {
      /* best effort: the first render uploads it otherwise */
    }
  }

  /** Baked texture size (minimap px), 0 × 0 before the first level. */
  get bakedSize(): { w: number; h: number } {
    return { w: this.texW, h: this.texH };
  }

  /** Frame (border included) size in virtual px. */
  static get outerW(): number {
    return MINIMAP_W + 2 * MINIMAP_BORDER;
  }
  static get outerH(): number {
    return MINIMAP_H + 2 * MINIMAP_BORDER;
  }

  /** One frame: the window around the vessel at (x, y) world px with heading `angle`, the frame at (left, top) virtual px. */
  render(vesselX: number, vesselY: number, angle: number, left: number, top: number, border: number): void {
    if (!this.texture) return;
    if (border !== this.border) {
      this.border = border;
      const g = this.frameG.clear();
      const w = MINIMAP_W + 2 * MINIMAP_BORDER;
      const h = MINIMAP_H + 2 * MINIMAP_BORDER;
      g.rect(0, 0, w, h).fill({ color: UI.outline, alpha: 0.85 });
      g.rect(1, 1, w - 2, h - 2).fill({ color: border, alpha: 0.7 });
      g.rect(MINIMAP_BORDER, MINIMAP_BORDER, MINIMAP_W, MINIMAP_H).fill({ color: UI.bg, alpha: 0.72 });
    }
    this.root.position.set(Math.round(left), Math.round(top));
    const l = minimapLayout(this.layout, this.texW, this.texH, vesselX, vesselY, this.exit);
    const f = this.lastFrame;
    if (l.fw <= 0 || l.fh <= 0) this.sprite.visible = false;
    else {
      this.sprite.visible = true;
      if (f[0] !== l.fx || f[1] !== l.fy || f[2] !== l.fw || f[3] !== l.fh) {
        f[0] = l.fx;
        f[1] = l.fy;
        f[2] = l.fw;
        f[3] = l.fh;
        const fr = this.texture.frame;
        fr.x = l.fx;
        fr.y = l.fy;
        fr.width = l.fw;
        fr.height = l.fh;
        this.texture.update(); // re-UV + 'update' -> the sprite resizes (no allocation)
      }
      this.sprite.position.set(l.ox, l.oy);
    }
    this.vessel.position.set(Math.round(l.vx), Math.round(l.vy));
    this.vessel.rotation = angle;
    this.exitMark.visible = l.hasExit;
    this.exitArrow.visible = l.hasExit && !l.exitInside;
    if (l.hasExit) {
      this.exitMark.position.set(Math.round(l.ex), Math.round(l.ey));
      if (!l.exitInside) {
        // the arrow sits just outside the pinned square, toward the exit, inside the window
        this.exitArrow.position.set(Math.round(l.ax), Math.round(l.ay));
        this.exitArrow.rotation = l.exitAngle;
      }
    }
  }

  /** Leaving the level (menus): free the baked texture (up to ~0.85 MB) and hide; the next setLevel bakes again. */
  clear(): void {
    this.sprite.texture = Texture.EMPTY;
    this.texture?.destroy(true);
    this.texture = null;
    this.texW = this.texH = 0;
    this.exit = null;
    this.lastFrame.fill(NaN);
    this.root.visible = false;
  }

  /** The baked level texture is alive (tests: freed on leaving the level). */
  get hasTexture(): boolean {
    return this.texture !== null;
  }

  destroy(): void {
    this.sprite.texture = Texture.EMPTY;
    this.texture?.destroy(true);
    this.texture = null;
    this.root.destroy({ children: true });
  }
}

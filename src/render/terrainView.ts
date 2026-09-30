/**
 * Scrolling terrain layer: the level's terrain painted with S2 tiles
 * (terrainTiles.ts) into CHUNK×CHUNK px canvases on demand around the
 * camera, uploaded as nearest-sampled textures, culled and recycled as the
 * view moves. Chunks that touch no terrain cost nothing. Works for every
 * level (maps 1-8, debug levels) with no per-level code.
 *
 * Frame budget (S8): chunks inside the view are painted immediately; the
 * pre-paint margin ring at most MARGIN_PAINTS_PER_FRAME per frame. Culled
 * chunks return their canvas + texture + sprite to a free list and are
 * repainted in place (no canvas / GPU texture churn while scrolling).
 */

import { Container, Sprite, Texture } from 'pixi.js';
import { VIEW_HEIGHT, VIEW_WIDTH } from '../contracts';
import type { ArtApi, LevelSpec, PixelCanvas, TerrainPiece, TerrainStyle, Vec2 } from '../contracts';
import { paintPieces, preparePiece, TileSource, type PaintRect, type PreparedPiece } from './terrainTiles';

const CHUNK = 256;
/** Chunks kept around the visible ones (pre-painted before they scroll in). */
const MARGIN = 1;
/** Off-screen (margin) chunks painted per frame at most. */
const MARGIN_PAINTS_PER_FRAME = 1;

function makeCanvas(w: number, h: number): PixelCanvas {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}

/** A chunk's GPU-side resources, recycled through TerrainView.free. */
interface Surface {
  canvas: PixelCanvas;
  ctx: CanvasRenderingContext2D;
  texture: Texture;
  sprite: Sprite;
}

interface Chunk {
  i: number;
  j: number;
  surface: Surface | null;
}

/** Numeric chunk key (no per-frame string building); chunk indices stay well inside ±2^15. */
const chunkKey = (i: number, j: number) => (i + 0x8000) * 0x10000 + (j + 0x8000);

export class TerrainView {
  readonly root = new Container();
  private readonly pieces: PreparedPiece[];
  private readonly tiles: TileSource;
  private readonly chunks = new Map<number, Chunk>();
  private readonly free: Surface[] = [];
  /** Brittle regions: their rock gets crack art. */
  private readonly cracks: PaintRect[];

  constructor(
    private readonly spec: LevelSpec,
    art: ArtApi,
  ) {
    this.tiles = new TileSource(art, spec.themeId, makeCanvas);
    this.pieces = spec.terrain.pieces.map((p) => preparePiece(p, spec.worldSize.h));
    this.cracks = spec.zones.flatMap((z) => (z.kind === 'brittleRegion' ? [z.rect] : []));
  }

  /** Paint/cull chunks for a view whose top-left world point is `o`. */
  update(o: Vec2): void {
    const i0 = Math.floor(o.x / CHUNK) - MARGIN;
    const i1 = Math.floor((o.x + VIEW_WIDTH) / CHUNK) + MARGIN;
    const j0 = Math.floor(o.y / CHUNK) - MARGIN;
    const j1 = Math.floor((o.y + VIEW_HEIGHT) / CHUNK) + MARGIN;
    let budget = MARGIN_PAINTS_PER_FRAME;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const key = chunkKey(i, j);
        if (this.chunks.has(key)) continue;
        const visible = i > i0 && i < i1 && j > j0 && j < j1;
        if (!visible && budget-- <= 0) continue;
        this.chunks.set(key, this.paint(i, j));
      }
    }
    for (const [key, c] of this.chunks) {
      const { i, j } = c;
      if (i >= i0 - 1 && i <= i1 + 1 && j >= j0 - 1 && j <= j1 + 1) continue;
      if (c.surface) this.release(c.surface);
      this.chunks.delete(key);
    }
  }

  /** Chunks currently holding painted terrain (tests / debugging). */
  get paintedCount(): number {
    let n = 0;
    for (const c of this.chunks.values()) if (c.surface) n++;
    return n;
  }

  destroy(): void {
    for (const c of this.chunks.values()) if (c.surface) this.release(c.surface);
    this.chunks.clear();
    for (const f of this.free) f.texture.destroy(true);
    this.free.length = 0;
    this.root.destroy({ children: true });
  }

  private paint(i: number, j: number): Chunk {
    const r = { x: i * CHUNK, y: j * CHUNK, w: CHUNK, h: CHUNK };
    if (r.x >= this.spec.worldSize.w || r.y >= this.spec.worldSize.h || r.x + CHUNK <= 0 || r.y + CHUNK <= 0) return { i, j, surface: null };
    const recycled = this.free.pop();
    const f = recycled ?? this.surface();
    f.ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (recycled) f.ctx.clearRect(0, 0, CHUNK, CHUNK);
    f.ctx.translate(-r.x, -r.y);
    if (!paintPieces(f.ctx, this.pieces, this.tiles, r, this.cracks)) {
      this.free.push(f);
      return { i, j, surface: null };
    }
    if (recycled) f.texture.source.update();
    f.sprite.position.set(r.x, r.y);
    f.sprite.visible = true;
    return { i, j, surface: f };
  }

  private surface(): Surface {
    const canvas = makeCanvas(CHUNK, CHUNK);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const texture = Texture.from(canvas as HTMLCanvasElement);
    const sprite = new Sprite(texture);
    this.root.addChild(sprite);
    return { canvas, ctx, texture, sprite };
  }

  private release(f: Surface): void {
    f.sprite.visible = false;
    this.free.push(f);
  }
}

/**
 * A standalone tiled canvas for one outline (moving islands): returns the
 * canvas and the outline-space offset of its top-left corner.
 */
export function paintOutline(art: ArtApi, spec: LevelSpec, id: string, outline: readonly Vec2[], style: TerrainStyle): { canvas: PixelCanvas; offset: Vec2 } {
  const piece: Pick<TerrainPiece, 'id' | 'kind' | 'points' | 'style'> = { id, kind: 'polygon', points: outline, style };
  const prepared = preparePiece(piece, spec.worldSize.h);
  const pad = 2;
  const x0 = Math.floor(prepared.bbox.x0) - pad;
  const y0 = Math.floor(prepared.bbox.y0) - 16 - pad; // room for decor above the top
  const w = Math.ceil(prepared.bbox.x1) + pad - x0;
  const h = Math.ceil(prepared.bbox.y1) + pad - y0;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.translate(-x0, -y0);
  paintPieces(ctx, [prepared], new TileSource(art, spec.themeId, makeCanvas), { x: x0, y: y0, w, h });
  return { canvas, offset: { x: x0, y: y0 } };
}

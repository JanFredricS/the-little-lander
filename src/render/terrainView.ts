/**
 * Scrolling terrain layer: the level's terrain painted with S2 tiles
 * (terrainTiles.ts) into CHUNK×CHUNK px canvases on demand around the
 * camera, uploaded as nearest-sampled textures, culled and recycled as the
 * view moves. Chunks that touch no terrain cost nothing. Works for every
 * level (maps 1-8, debug levels) with no per-level code.
 */

import { Container, Sprite, Texture } from 'pixi.js';
import { VIEW_HEIGHT, VIEW_WIDTH } from '../contracts';
import type { ArtApi, LevelSpec, PixelCanvas, TerrainPiece, TerrainStyle, Vec2 } from '../contracts';
import { paintPieces, preparePiece, TileSource, type PreparedPiece } from './terrainTiles';

const CHUNK = 256;
/** Chunks kept around the visible ones (pre-painted before they scroll in). */
const MARGIN = 1;

function makeCanvas(w: number, h: number): PixelCanvas {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}

interface Chunk {
  sprite: Sprite | null;
}

export class TerrainView {
  readonly root = new Container();
  private readonly pieces: PreparedPiece[];
  private readonly tiles: TileSource;
  private readonly chunks = new Map<string, Chunk>();

  constructor(
    private readonly spec: LevelSpec,
    art: ArtApi,
  ) {
    this.tiles = new TileSource(art, spec.themeId, makeCanvas);
    this.pieces = spec.terrain.pieces.map((p) => preparePiece(p, spec.worldSize.h));
  }

  /** Paint/cull chunks for a view whose top-left world point is `o`. */
  update(o: Vec2): void {
    const i0 = Math.floor(o.x / CHUNK) - MARGIN;
    const i1 = Math.floor((o.x + VIEW_WIDTH) / CHUNK) + MARGIN;
    const j0 = Math.floor(o.y / CHUNK) - MARGIN;
    const j1 = Math.floor((o.y + VIEW_HEIGHT) / CHUNK) + MARGIN;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const key = `${i},${j}`;
        if (!this.chunks.has(key)) this.chunks.set(key, this.paint(i, j));
      }
    }
    for (const [key, c] of this.chunks) {
      const [i, j] = key.split(',').map(Number) as [number, number];
      if (i >= i0 - 1 && i <= i1 + 1 && j >= j0 - 1 && j <= j1 + 1) continue;
      c.sprite?.destroy({ texture: true, textureSource: true });
      this.chunks.delete(key);
    }
  }

  destroy(): void {
    for (const c of this.chunks.values()) c.sprite?.destroy({ texture: true, textureSource: true });
    this.chunks.clear();
    this.root.destroy({ children: true });
  }

  private paint(i: number, j: number): Chunk {
    const r = { x: i * CHUNK, y: j * CHUNK, w: CHUNK, h: CHUNK };
    if (r.x >= this.spec.worldSize.w || r.y >= this.spec.worldSize.h || r.x + CHUNK <= 0 || r.y + CHUNK <= 0) return { sprite: null };
    const canvas = makeCanvas(CHUNK, CHUNK);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.translate(-r.x, -r.y);
    if (!paintPieces(ctx, this.pieces, this.tiles, r)) return { sprite: null };
    const sprite = new Sprite(Texture.from(canvas as HTMLCanvasElement));
    sprite.position.set(r.x, r.y);
    this.root.addChild(sprite);
    return { sprite };
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

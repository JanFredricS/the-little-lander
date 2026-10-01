/**
 * Scrolling terrain layer: the level's terrain painted with S2 tiles
 * (terrainTiles.ts) into CHUNK×CHUNK px canvases on demand around the
 * camera, uploaded as nearest-sampled textures, culled and recycled as the
 * view moves. Chunks that touch no terrain cost nothing. Works for every
 * level (maps 1-8, debug levels) with no per-level code.
 *
 * Frame budget (stutter round 2, profiled on descent at speed: the old
 * whole-chunk painter spent up to ~30 ms of one frame painting + uploading):
 * - Chunks are painted in TERRAIN_BAND_ROWS-row bands, TERRAIN_PAINT_BUDGET_MS
 *   per frame, nearest-to-the-predicted-view first.
 * - A finished chunk is uploaded (texture.source.update + shown) on a LATER
 *   frame than its last band, at most TERRAIN_UPLOADS_PER_FRAME per frame,
 *   so paint and GPU upload never stack in one frame.
 * - The prepare area is the view plus a MARGIN ring, extended up to
 *   TERRAIN_MAX_LEAD chunks in the camera's direction of travel (lead =
 *   TERRAIN_LEAD_MS of camera motion), so budgeted work finishes before a
 *   chunk scrolls in even at max descent speed.
 * - Exceptions to the two rules above, all counted (syncUploadsLastUpdate):
 *   . LEVEL LOAD - the first update prepares the whole area at once
 *     (painted + uploaded in that frame; the load screen hides it).
 *   . CAMERA JUMP (restart / teleport: a move of more than a view in one
 *     update) - the new on-screen chunks are painted + uploaded at once,
 *     the rest of the area streams as usual. Counted in jumpUpdates.
 *   . LATE - in steady flight, an on-screen chunk that is still painting OR
 *     painted-but-not-uploaded is finished + shown at once (terrain must not
 *     be missing from the screen). Counted in lateChunks: the look-ahead
 *     keeps this at 0 in normal flight, so the invariants hold whenever it
 *     reads 0.
 * - Culled chunks return their canvas + texture + sprite to a free list and
 *   are repainted in place: same-size re-uploads, no canvas / GPU texture
 *   allocation churn while scrolling.
 */

import { Container, Sprite, Texture } from 'pixi.js';
import { VIEW_HEIGHT, VIEW_WIDTH } from '../contracts';
import type { ArtApi, LevelSpec, PixelCanvas, TerrainPiece, TerrainStyle, Vec2 } from '../contracts';
import { paintPieces, piecesTouch, preparePiece, TileSource, type PaintRect, type PreparedPiece } from './terrainTiles';

export const TERRAIN_CHUNK = 256;
const CHUNK = TERRAIN_CHUNK;
/** Chunks kept around the visible ones on every side (pre-painted before they scroll in). */
const MARGIN = 1;
/** Rows per paint band (a 256 px chunk = 4 bands). */
export const TERRAIN_BAND_ROWS = 64;
const BANDS = CHUNK / TERRAIN_BAND_ROWS;
/** Per-frame time budget (ms) for off-screen band painting; at least one band always runs. */
export const TERRAIN_PAINT_BUDGET_MS = 2;
/** Finished off-screen chunks uploaded + shown per frame at most. */
export const TERRAIN_UPLOADS_PER_FRAME = 2;
/** Look-ahead: the prepare area extends this much camera motion (ms) ahead... */
export const TERRAIN_LEAD_MS = 900;
/** ...capped at this many extra chunks in the direction of travel. */
export const TERRAIN_MAX_LEAD = 3;
/** Camera velocity smoothing per update (EMA weight of the newest sample). */
const VEL_SMOOTH = 0.2;

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

/** Chunk lifecycle: painting bands -> painted (awaiting upload) -> shown; or empty. */
const Stage = { Painting: 0, Painted: 1, Shown: 2, Empty: 3 } as const;
type Stage = (typeof Stage)[keyof typeof Stage];

interface Chunk {
  i: number;
  j: number;
  surface: Surface | null;
  stage: Stage;
  /** Next band to paint while Painting. */
  band: number;
  /** Any band drew terrain. */
  drew: boolean;
}

/** Numeric chunk key (no per-frame string building); chunk indices stay well inside ±2^15. */
const chunkKey = (i: number, j: number) => (i + 0x8000) * 0x10000 + (j + 0x8000);

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class TerrainView {
  readonly root = new Container();
  private readonly pieces: PreparedPiece[];
  private readonly tiles: TileSource;
  private readonly chunks = new Map<number, Chunk>();
  /** Chunks still painting (unordered; picked by priority). */
  private readonly painting: Chunk[] = [];
  /** Painted chunks waiting for their upload frame (FIFO). */
  private readonly uploads: Chunk[] = [];
  private readonly free: Surface[] = [];
  /** Brittle regions: their rock gets crack art. */
  private readonly cracks: PaintRect[];
  /** Reused paint rect (no per-band allocation). */
  private readonly band: PaintRect = { x: 0, y: 0, w: CHUNK, h: TERRAIN_BAND_ROWS };
  /** Camera tracking for the look-ahead (world px, px/ms). */
  private lastX = 0;
  private lastY = 0;
  private lastT = 0;
  private velX = 0;
  private velY = 0;
  private started = false;
  /** Visible-rect chunk range of the current update (priority reference). */
  private vi0 = 0;
  private vi1 = 0;
  private vj0 = 0;
  private vj1 = 0;
  /** Bands painted in the last update() (diagnostics / tests). */
  bandsLastUpdate = 0;
  /** Chunks uploaded in the last update() (diagnostics / tests). */
  uploadsLastUpdate = 0;
  /** In steady flight, on-screen chunks that were not shown yet and had to be finished + uploaded at once (diagnostics; should stay 0). */
  lateChunks = 0;
  /** Updates treated as a camera jump (on-screen chunks prepared at once; exempt from lateChunks). */
  jumpUpdates = 0;
  /** Uploads in the last update() that bypassed TERRAIN_UPLOADS_PER_FRAME / the later-frame rule (load, jump, late). */
  syncUploadsLastUpdate = 0;
  /** A camera jump was detected by track() for the current update. */
  private jumped = false;
  /** Wall ms spent in the last update() (FPS-counter hitch attribution: PAINT). */
  msLastUpdate = 0;

  constructor(
    private readonly spec: LevelSpec,
    art: ArtApi,
    private readonly clock: () => number = now,
  ) {
    this.tiles = new TileSource(art, spec.themeId, makeCanvas);
    this.pieces = spec.terrain.pieces.map((p) => preparePiece(p, spec.worldSize.h));
    this.cracks = spec.zones.flatMap((z) => (z.kind === 'brittleRegion' ? [z.rect] : []));
  }

  /** Paint/upload/cull chunks for a view whose top-left world point is `o`. */
  update(o: Vec2): void {
    const start = this.clock();
    this.track(o, start);
    this.updateChunks(o, start);
    this.msLastUpdate = this.clock() - start;
  }

  /** Smoothed camera velocity (px/ms) for the look-ahead; a jump (restart, teleport) resets it. */
  private track(o: Vec2, t: number): void {
    const dt = t - this.lastT;
    const dx = o.x - this.lastX;
    const dy = o.y - this.lastY;
    this.jumped = this.started && (Math.abs(dx) > VIEW_WIDTH || Math.abs(dy) > VIEW_HEIGHT);
    if (!this.started || dt <= 0 || dt > 250 || this.jumped) {
      this.velX = 0;
      this.velY = 0;
    } else {
      this.velX += (dx / dt - this.velX) * VEL_SMOOTH;
      this.velY += (dy / dt - this.velY) * VEL_SMOOTH;
    }
    this.lastX = o.x;
    this.lastY = o.y;
    this.lastT = t;
  }

  private updateChunks(o: Vec2, t0: number): void {
    const first = !this.started;
    this.started = true;
    const jump = this.jumped;
    if (jump) this.jumpUpdates++;
    this.bandsLastUpdate = 0;
    this.uploadsLastUpdate = 0;
    this.syncUploadsLastUpdate = 0;
    // visible range, then the prepare range: MARGIN all round + lead along the travel direction
    const vi0 = (this.vi0 = Math.floor(o.x / CHUNK));
    const vi1 = (this.vi1 = Math.floor((o.x + VIEW_WIDTH - 1e-6) / CHUNK));
    const vj0 = (this.vj0 = Math.floor(o.y / CHUNK));
    const vj1 = (this.vj1 = Math.floor((o.y + VIEW_HEIGHT - 1e-6) / CHUNK));
    const leadX = Math.min(TERRAIN_MAX_LEAD, Math.ceil((Math.abs(this.velX) * TERRAIN_LEAD_MS) / CHUNK));
    const leadY = Math.min(TERRAIN_MAX_LEAD, Math.ceil((Math.abs(this.velY) * TERRAIN_LEAD_MS) / CHUNK));
    const i0 = vi0 - MARGIN - (this.velX < 0 ? leadX : 0);
    const i1 = vi1 + MARGIN + (this.velX > 0 ? leadX : 0);
    const j0 = vj0 - MARGIN - (this.velY < 0 ? leadY : 0);
    const j1 = vj1 + MARGIN + (this.velY > 0 ? leadY : 0);
    // cull outside the prepare range (+1 hysteresis, +lead so a reversal does not thrash) FIRST, so
    // the surfaces it frees are reused by the chunks opened below (a camera jump does not allocate
    // a second full set of canvases / textures)
    for (const [key, c] of this.chunks) {
      const { i, j } = c;
      if (i >= i0 - 1 && i <= i1 + 1 && j >= j0 - 1 && j <= j1 + 1) continue;
      this.close(c);
      this.chunks.delete(key);
    }
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const key = chunkKey(i, j);
        let c = this.chunks.get(key);
        if (!c) {
          c = this.open(i, j);
          this.chunks.set(key, c);
        }
        const visible = i >= vi0 && i <= vi1 && j >= vj0 && j <= vj1;
        if (first || visible) this.finishNow(c, !first && !jump);
      }
    }
    // uploads first: chunks finished on an EARLIER frame (never the frame they were painted)
    let n = 0;
    while (this.uploads.length > 0 && n < TERRAIN_UPLOADS_PER_FRAME) {
      const c = this.uploads.shift()!;
      if (c.stage !== Stage.Painted) continue;
      this.show(c);
      n++;
    }
    // off-screen bands, nearest the predicted view first, within the frame budget (at least one band)
    let firstBand = true;
    while (this.painting.length > 0 && (firstBand || this.clock() - t0 < TERRAIN_PAINT_BUDGET_MS)) {
      const k = this.nextPainting();
      if (k < 0) break;
      firstBand = false;
      const c = this.painting[k]!;
      this.paintBand(c);
      if (c.stage !== Stage.Painting) {
        this.dropPainting(k);
        if (c.stage === Stage.Painted) this.uploads.push(c);
      }
    }
  }

  /** Index of the painting chunk nearest the predicted view (half a lead ahead); -1 = none left. */
  private nextPainting(): number {
    const p = this.painting;
    for (let k = p.length - 1; k >= 0; k--) if (p[k]!.stage !== Stage.Painting) this.dropPainting(k);
    const cx = (this.vi0 + this.vi1 + 1) / 2 + (this.velX * TERRAIN_LEAD_MS * 0.5) / CHUNK;
    const cy = (this.vj0 + this.vj1 + 1) / 2 + (this.velY * TERRAIN_LEAD_MS * 0.5) / CHUNK;
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < p.length; k++) {
      const c = p[k]!;
      // Chebyshev distance in chunks; a started chunk wins near-ties (finish what is begun)
      const d = Math.max(Math.abs(c.i + 0.5 - cx), Math.abs(c.j + 0.5 - cy)) - c.band * 0.1;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    return best;
  }

  private dropPainting(k: number): void {
    const last = this.painting.pop()!;
    if (k < this.painting.length) this.painting[k] = last;
  }

  /** Chunks currently holding painted terrain (tests / debugging). */
  get paintedCount(): number {
    let n = 0;
    for (const c of this.chunks.values()) if (c.stage === Stage.Shown) n++;
    return n;
  }

  /** Chunks still being painted or waiting for their upload frame. */
  get pendingCount(): number {
    let n = 0;
    for (const c of this.chunks.values()) if (c.stage === Stage.Painting || c.stage === Stage.Painted) n++;
    return n;
  }

  destroy(): void {
    for (const c of this.chunks.values()) if (c.surface) this.release(c.surface);
    this.chunks.clear();
    this.painting.length = 0;
    this.uploads.length = 0;
    for (const f of this.free) f.texture.destroy(true);
    this.free.length = 0;
    this.root.destroy({ children: true });
  }

  /** A new chunk: empty ones (no terrain nearby) are done at once; others get a cleared surface and start painting. */
  private open(i: number, j: number): Chunk {
    const x = i * CHUNK;
    const y = j * CHUNK;
    const outside = x >= this.spec.worldSize.w || y >= this.spec.worldSize.h || x + CHUNK <= 0 || y + CHUNK <= 0;
    if (outside || !piecesTouch(this.pieces, { x, y, w: CHUNK, h: CHUNK })) return { i, j, surface: null, stage: Stage.Empty, band: BANDS, drew: false };
    const recycled = this.free.pop();
    const f = recycled ?? this.surface();
    if (recycled) {
      f.ctx.setTransform(1, 0, 0, 1, 0, 0);
      f.ctx.clearRect(0, 0, CHUNK, CHUNK);
    }
    f.sprite.visible = false;
    const c: Chunk = { i, j, surface: f, stage: Stage.Painting, band: 0, drew: false };
    this.painting.push(c);
    return c;
  }

  /**
   * Finish a chunk this frame and show it (bypassing the upload rules): it
   * is on screen, or the level just loaded. `late` = steady flight (not a
   * load or jump): counted in lateChunks whether it was still painting or
   * painted but waiting for its upload frame.
   */
  private finishNow(c: Chunk, late: boolean): void {
    if (c.stage === Stage.Shown || c.stage === Stage.Empty) return;
    if (late) this.lateChunks++;
    while (c.stage === Stage.Painting) this.paintBand(c);
    if (c.stage === Stage.Painted) {
      this.show(c);
      this.syncUploadsLastUpdate++;
    }
  }

  /** Paint the chunk's next band (clipped to it: the finished chunk is pixel-identical to a one-pass paint). */
  private paintBand(c: Chunk): void {
    const f = c.surface;
    if (!f || c.stage !== Stage.Painting) return;
    const r = this.band;
    r.x = c.i * CHUNK;
    r.y = c.j * CHUNK + c.band * TERRAIN_BAND_ROWS;
    const ctx = f.ctx;
    ctx.setTransform(1, 0, 0, 1, -r.x, -c.j * CHUNK);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    if (paintPieces(ctx, this.pieces, this.tiles, r, this.cracks)) c.drew = true;
    ctx.restore();
    c.band++;
    this.bandsLastUpdate++;
    if (c.band < BANDS) return;
    if (!c.drew) {
      // bbox said maybe, but nothing landed in the chunk
      this.release(f);
      c.surface = null;
      c.stage = Stage.Empty;
      return;
    }
    c.stage = Stage.Painted;
  }

  /** Upload + show a painted chunk (the upload itself happens in this frame's Pixi render). */
  private show(c: Chunk): void {
    const f = c.surface!;
    f.texture.source.update();
    f.sprite.position.set(c.i * CHUNK, c.j * CHUNK);
    f.sprite.visible = true;
    c.stage = Stage.Shown;
    this.uploadsLastUpdate++;
  }

  private close(c: Chunk): void {
    if (c.surface) this.release(c.surface);
    c.surface = null;
    c.stage = Stage.Empty; // queued entries are skipped when reached
  }

  private surface(): Surface {
    const canvas = makeCanvas(CHUNK, CHUNK);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const texture = Texture.from(canvas as HTMLCanvasElement);
    const sprite = new Sprite(texture);
    sprite.visible = false;
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

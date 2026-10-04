/**
 * Scrolling terrain layer: the level's terrain painted with S2 tiles
 * (terrainTiles.ts) into CHUNK×CHUNK px canvases on demand around the
 * camera, uploaded as nearest-sampled textures, culled and recycled as the
 * view moves. Chunks that touch no terrain cost nothing. Works for every
 * level (maps 1-8, debug levels) with no per-level code.
 *
 * Frame budget (stutter rounds 2-3, profiled on descent at speed):
 * - Chunks are painted in TERRAIN_BAND_ROWS-row bands within a per-frame
 *   budget: TERRAIN_PAINT_BUDGET_MS normally, rising to
 *   TERRAIN_PAINT_BUDGET_MAX_MS while the backlog would not finish in
 *   TERRAIN_CATCHUP_FRAMES at the base budget or something on screen is
 *   unfinished. A band is only started when the measured band cost still
 *   fits the budget (the first band of a frame always runs).
 * - In steady flight NOTHING bypasses that budget. An on-screen chunk that
 *   is not ready (the look-ahead lost the race: very slow canvas, extreme
 *   speed) is painted first, band by band from the side facing the view,
 *   and re-uploaded as it fills (at most TERRAIN_VISIBLE_UPLOADS_PER_FRAME
 *   per frame): a few frames of late fill instead of a 100+ ms frame
 *   (round 3: synchronous finishing of late chunks measured 130 ms PAINT
 *   hitches on a slow Mac canvas). Counted in lateChunks.
 * - Uploads (texture.source.update: Pixi uploads synchronously right
 *   there) run within TERRAIN_UPLOAD_BUDGET_MS per frame on their measured
 *   cost (the first always runs): on-screen chunks first, then off-screen
 *   finished chunks - those on a LATER frame than their last band, at most
 *   TERRAIN_UPLOADS_PER_FRAME per frame. Timed separately (uploadMsLastUpdate:
 *   the FPS counter's UPLOAD phase). Chunk canvases are CPU-backed
 *   (willReadFrequently): a GPU canvas defers its rasterisation to the
 *   upload, where no budget can see it.
 * - The prepare area is the view plus a MARGIN ring, extended up to
 *   TERRAIN_MAX_LEAD chunks in the camera's direction of travel (lead =
 *   TERRAIN_LEAD_MS of camera motion), so chunks are normally finished
 *   before they scroll in.
 * - Exceptions (synchronous, counted in syncUploadsLastUpdate):
 *   . LEVEL LOAD - the first update prepares the whole area at once
 *     (painted + uploaded in that frame; the load screen hides it).
 *   . CAMERA JUMP - a teleport / restart (a view or more away from where
 *     the velocity predicted), or a landing beyond the REACH of the area
 *     prepared last update (that area widened by one more lead per axis,
 *     ~2x the look-ahead: nothing near there was even opened). A long frame
 *     along the flight path inside the reach is NOT a jump: its new chunks
 *     fill in late (a synchronous repaint would itself be the next long
 *     frame). The on-screen chunks are painted + uploaded at once, the rest
 *     of the area streams as usual. Counted in jumpUpdates.
 *   . BLANK SCREEN - inside the reach, but not ONE on-screen terrain chunk
 *     is shown, not even partly (an extreme-speed long frame, a backward snap past the
 *     trailing margin): the on-screen chunks are prepared at once, like a
 *     jump (counted in jumpUpdates and blankUpdates). Never two updates in
 *     a row, so a slow synchronous frame cannot feed itself; a partly blank
 *     screen still fills in late within the budget.
 * - GPU init (setUploader, the App's renderer.texture.initSource): a new
 *   chunk surface is initialised on the GPU when it is created (timed as
 *   UPLOAD). Pixi only listens for source updates once a source is
 *   initialised, so without it a fresh surface's first update() is a no-op
 *   and its real upload lands unbudgeted in the next render (SUBMIT); such
 *   first updates are kept out of the measured upload cost.
 * - Culled chunks return their canvas + texture + sprite to a free list and
 *   are repainted in place: same-size re-uploads, no canvas / GPU texture
 *   allocation churn while scrolling.
 */

import { Container, Sprite, Texture } from 'pixi.js';
import { VIEW_HEIGHT, VIEW_WIDTH } from '../contracts';
import type { ArtApi, LevelSpec, PixelCanvas, TerrainPiece, TerrainStyle, Vec2 } from '../contracts';
import { isCrystalSpire } from './crystalSpires';
import { paintPieces, piecesTouch, preparePiece, TileSource, type PaintRect, type PreparedPiece } from './terrainTiles';

export const TERRAIN_CHUNK = 256;
const CHUNK = TERRAIN_CHUNK;
/** Chunks kept around the visible ones on every side (pre-painted before they scroll in). */
const MARGIN = 1;
/** Rows per paint band (a 256 px chunk = 8 bands): the smallest unit of paint work in a frame. */
export const TERRAIN_BAND_ROWS = 32;
const BANDS = CHUNK / TERRAIN_BAND_ROWS;
/** Per-frame band painting budget (ms) when keeping up; at least one band always runs. */
export const TERRAIN_PAINT_BUDGET_MS = 2;
/** Per-frame budget ceiling (ms) while catching up (backlog, or unfinished terrain on screen). */
export const TERRAIN_PAINT_BUDGET_MAX_MS = 6;
/** The budget rises so the current backlog would finish within this many frames. */
export const TERRAIN_CATCHUP_FRAMES = 30;
/** Finished off-screen chunks uploaded + shown per frame at most. */
export const TERRAIN_UPLOADS_PER_FRAME = 2;
/** On-screen chunks (re-)uploaded per frame at most while they fill in late. */
export const TERRAIN_VISIBLE_UPLOADS_PER_FRAME = 4;
/**
 * Per-frame texture upload budget (ms): an upload starts only while the
 * measured upload cost still fits (the first upload of a frame always runs).
 * A 256 px RGBA chunk is 256 KB; on some GPUs / browsers one upload costs
 * several ms (round 4: Mac hitches blamed on PAINT were uploads).
 */
export const TERRAIN_UPLOAD_BUDGET_MS = 2;
/** Upload cost estimate (ms) before any upload was measured. */
const UPLOAD_MS_INITIAL = 0.3;
/** Look-ahead: the prepare area extends this much camera motion (ms) ahead... */
export const TERRAIN_LEAD_MS = 1200;
/** ...capped at this many extra chunks in the direction of travel. */
export const TERRAIN_MAX_LEAD = 5;
/** Band cost estimate (ms) before any band was measured. */
const BAND_MS_INITIAL = 0.5;
/** Camera velocity smoothing per update (EMA weight of the newest sample). */
const VEL_SMOOTH = 0.2;
/** An update gap longer than this (ms) is a stall, not a velocity sample (the velocity estimate is kept). */
const STALL_MS = 250;

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
  /** Initialised on the GPU (texture.source.update() really uploads). */
  gpu: boolean;
}

/** Chunk lifecycle: painting bands -> painted (awaiting upload) -> shown; or empty. */
const Stage = { Painting: 0, Painted: 1, Shown: 2, Empty: 3 } as const;
type Stage = (typeof Stage)[keyof typeof Stage];

interface Chunk {
  i: number;
  j: number;
  surface: Surface | null;
  stage: Stage;
  /** Bands painted so far (Painting). */
  band: number;
  /** Paint bottom band first (the chunk is above the view: its bottom edge scrolls in first). */
  up: boolean;
  /** Any band drew terrain. */
  drew: boolean;
  /** Drew since its last upload (late fill re-uploads only changed chunks). */
  dirty: boolean;
  /** Already counted in lateChunks. */
  late: boolean;
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
  /** Prepare range of the last update (a view landing outside it is a jump). */
  private pi0 = 0;
  private pi1 = -1;
  private pj0 = 0;
  private pj1 = -1;
  /** Look-ahead (chunks) of the current update, per axis. */
  private leadX = 0;
  private leadY = 0;
  /** Bands painted in the last update() (diagnostics / tests). */
  bandsLastUpdate = 0;
  /** Chunks uploaded in the last update() (diagnostics / tests). */
  uploadsLastUpdate = 0;
  /** In steady flight, chunks that were on screen before they were finished + shown (each counted once; diagnostics, 0 when the look-ahead keeps up). */
  lateChunks = 0;
  /** On-screen terrain chunks not fully shown after the last update() (late fill in progress). */
  unreadyVisibleLastUpdate = 0;
  /** Paint budget (ms) the last update() allowed. */
  budgetLastUpdate = 0;
  /** Updates treated as a camera jump (on-screen chunks prepared at once; exempt from lateChunks). */
  jumpUpdates = 0;
  /** Of jumpUpdates: fully blank screens inside the reach (see the header). */
  blankUpdates = 0;
  /** The last update prepared on-screen chunks synchronously (load / jump / blank): the blank rule waits a frame. */
  private syncedLastUpdate = false;
  /** GPU initialiser for new surfaces (renderer.texture.initSource); null = none (tests, headless). */
  private uploader: ((source: Texture['source']) => void) | null = null;
  /** Uploads in the last update() that bypassed the per-frame budget and upload caps (level load, camera jump only). */
  syncUploadsLastUpdate = 0;
  /** Synchronous uploads since the view was created (diagnostics: FPS-counter terrain line). */
  syncUploadsTotal = 0;
  /** Wall ms of the last update() spent in texture uploads (part of msLastUpdate; FPS-counter UPLOAD phase). */
  uploadMsLastUpdate = 0;
  /** Smoothed measured cost of one chunk upload (ms): decides whether another upload fits TERRAIN_UPLOAD_BUDGET_MS. */
  uploadMs = UPLOAD_MS_INITIAL;
  /** Smoothed measured cost of one band (ms): decides whether another band fits the budget. */
  bandMs = BAND_MS_INITIAL;
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
    // round 20: crystal spires are drawn by their own layer (crystalSpires.ts)
    this.pieces = spec.terrain.pieces.filter((p) => !isCrystalSpire(p)).map((p) => preparePiece(p, spec.worldSize.h));
    this.cracks = spec.zones.flatMap((z) => (z.kind === 'brittleRegion' ? [z.rect] : []));
  }

  /**
   * GPU-initialise every chunk surface as it is created (the App passes renderer.texture.initSource),
   * so its later texture.source.update() calls really upload where they are timed and budgeted.
   */
  setUploader(init: (source: Texture['source']) => void): void {
    this.uploader = init;
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
    // a teleport = the view moved a view or more in one update AND not where its own velocity
    // predicted (restart, teleport). A long frame at speed (a stall: GC, tab jank) moves far too,
    // but as predicted: it gets the budgeted late fill unless it lands beyond the reach
    // updateChunks() checks - a synchronous repaint there would itself be the next long frame.
    const far = Math.abs(dx) >= VIEW_WIDTH || Math.abs(dy) >= VIEW_HEIGHT;
    const unexplained = Math.abs(dx - this.velX * dt) >= VIEW_WIDTH || Math.abs(dy - this.velY * dt) >= VIEW_HEIGHT;
    const stall = dt > STALL_MS;
    this.jumped = this.started && far && unexplained;
    if (!this.started || this.jumped) {
      // teleport / restart: the old motion says nothing about the new one
      this.velX = 0;
      this.velY = 0;
    } else if (dt > 0 && !stall) {
      this.velX += (dx / dt - this.velX) * VEL_SMOOTH;
      this.velY += (dy / dt - this.velY) * VEL_SMOOTH;
    } // a stall keeps the last velocity: one long sample is no evidence of a new speed
    this.lastX = o.x;
    this.lastY = o.y;
    this.lastT = t;
  }

  private updateChunks(o: Vec2, t0: number): void {
    const first = !this.started;
    this.started = true;
    this.bandsLastUpdate = 0;
    this.uploadsLastUpdate = 0;
    this.syncUploadsLastUpdate = 0;
    this.uploadMsLastUpdate = 0;
    // visible range, then the prepare range: MARGIN all round + lead along the travel direction
    const vi0 = (this.vi0 = Math.floor(o.x / CHUNK));
    const vi1 = (this.vi1 = Math.floor((o.x + VIEW_WIDTH - 1e-6) / CHUNK));
    const vj0 = (this.vj0 = Math.floor(o.y / CHUNK));
    const vj1 = (this.vj1 = Math.floor((o.y + VIEW_HEIGHT - 1e-6) / CHUNK));
    // a jump: a teleport (track()), or the view landed beyond the REACH of last update's prepare
    // range - that range widened by one more lead (at least MARGIN) per axis, i.e. about twice the
    // look-ahead along the flight path. Inside the reach (a long frame along the path) the new
    // chunks fill in late within the budget: blank for a few frames beats a frozen 100 ms frame
    // whose own length would put the next frame beyond the reach again.
    const rx = Math.max(MARGIN, this.leadX);
    const ry = Math.max(MARGIN, this.leadY);
    const outside = !first && (vi0 < this.pi0 - rx || vi1 > this.pi1 + rx || vj0 < this.pj0 - ry || vj1 > this.pj1 + ry);
    const jump = !first && (this.jumped || outside);
    if (jump) this.jumpUpdates++;
    const leadX = (this.leadX = Math.min(TERRAIN_MAX_LEAD, Math.ceil((Math.abs(this.velX) * TERRAIN_LEAD_MS) / CHUNK)));
    const leadY = (this.leadY = Math.min(TERRAIN_MAX_LEAD, Math.ceil((Math.abs(this.velY) * TERRAIN_LEAD_MS) / CHUNK)));
    const i0 = vi0 - MARGIN - (this.velX < 0 ? leadX : 0);
    const i1 = vi1 + MARGIN + (this.velX > 0 ? leadX : 0);
    const j0 = vj0 - MARGIN - (this.velY < 0 ? leadY : 0);
    const j1 = vj1 + MARGIN + (this.velY > 0 ? leadY : 0);
    this.pi0 = i0;
    this.pi1 = i1;
    this.pj0 = j0;
    this.pj1 = j1;
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
        if (!this.chunks.has(key)) this.chunks.set(key, this.open(i, j, vj0, vj1));
      }
    }
    // a fully blank screen inside the reach (nothing on screen shown, terrain there): prepare it at
    // once, like a jump - but not right after another synchronous update (no self-feeding loop)
    let blank = false;
    if (!first && !jump && !this.syncedLastUpdate) {
      let terrain = 0;
      let shown = 0;
      for (let j = vj0; j <= vj1; j++) {
        for (let i = vi0; i <= vi1; i++) {
          const c = this.chunks.get(chunkKey(i, j))!;
          if (c.stage === Stage.Empty) continue;
          terrain++;
          // shown, or an unfinished chunk already on screen as it fills (showPartial)
          if (c.stage === Stage.Shown || c.surface?.sprite.visible) shown++;
        }
      }
      blank = terrain > 0 && shown === 0;
      if (blank) {
        this.jumpUpdates++;
        this.blankUpdates++;
      }
    }
    const sync = jump || blank;
    this.syncedLastUpdate = first || sync;
    let unready = 0;
    let painting = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = this.chunks.get(chunkKey(i, j))!;
        const visible = i >= vi0 && i <= vi1 && j >= vj0 && j <= vj1;
        if (first || (sync && visible)) this.prepareNow(c);
        else if (visible && (c.stage === Stage.Painting || c.stage === Stage.Painted)) {
          unready++;
          if (!c.late) {
            c.late = true;
            this.lateChunks++;
          }
        }
        if (c.stage === Stage.Painting) painting += BANDS - c.band;
      }
    }
    // budget: base, raised to clear the backlog within TERRAIN_CATCHUP_FRAMES, max while terrain on screen is unfinished
    const need = (painting * this.bandMs) / TERRAIN_CATCHUP_FRAMES;
    const budget = unready > 0 ? TERRAIN_PAINT_BUDGET_MAX_MS : Math.min(TERRAIN_PAINT_BUDGET_MAX_MS, Math.max(TERRAIN_PAINT_BUDGET_MS, need));
    this.budgetLastUpdate = budget;
    // off-screen chunks waiting since an EARLIER frame (never uploaded the frame they were painted)
    const waiting = this.uploads.length;
    // bands: on-screen unfinished chunks first, then nearest the predicted view; a band starts only
    // while its measured cost still fits the budget (the first band of a frame always runs)
    let firstBand = true;
    while (this.painting.length > 0 && (firstBand || this.clock() - t0 + this.bandMs <= budget)) {
      const k = this.nextPainting();
      if (k < 0) break;
      firstBand = false;
      const c = this.painting[k]!;
      const b0 = this.clock();
      this.paintBand(c);
      this.bandMs += (this.clock() - b0 - this.bandMs) * 0.2;
      if (c.stage !== Stage.Painting) {
        this.dropPainting(k);
        if (c.stage === Stage.Painted) this.uploads.push(c);
      }
    }
    // uploads within TERRAIN_UPLOAD_BUDGET_MS (the first always runs): on screen first - finished
    // chunks shown, unfinished ones re-uploaded as they fill (capped) - then off-screen ones
    let vis = 0;
    unready = 0;
    for (let j = vj0; j <= vj1; j++) {
      for (let i = vi0; i <= vi1; i++) {
        const c = this.chunks.get(chunkKey(i, j));
        if (!c || c.stage === Stage.Shown || c.stage === Stage.Empty) continue;
        let ready = false;
        if (vis < TERRAIN_VISIBLE_UPLOADS_PER_FRAME && (c.stage === Stage.Painted || c.dirty) && this.uploadFits()) {
          vis++;
          ready = c.stage === Stage.Painted;
          if (ready) this.show(c);
          else this.showPartial(c);
        }
        if (!ready) unready++;
      }
    }
    this.unreadyVisibleLastUpdate = unready;
    const q = this.uploads;
    for (let k = 0, n = 0, end = waiting; k < end && k < q.length && n < TERRAIN_UPLOADS_PER_FRAME; ) {
      const c = q[k]!;
      if (c.stage !== Stage.Painted) {
        q.splice(k, 1);
        end--;
      } else if (this.isVisible(c)) k++; // on screen: the visible pass shows it (stays queued meanwhile)
      else if (!this.uploadFits()) break;
      else {
        q.splice(k, 1);
        end--;
        this.show(c);
        n++;
      }
    }
  }

  /** Another upload fits this frame's upload budget (the first always does). */
  private uploadFits(): boolean {
    return this.uploadsLastUpdate === this.syncUploadsLastUpdate || this.uploadMsLastUpdate + this.uploadMs <= TERRAIN_UPLOAD_BUDGET_MS;
  }

  private isVisible(c: Chunk): boolean {
    return c.i >= this.vi0 && c.i <= this.vi1 && c.j >= this.vj0 && c.j <= this.vj1;
  }

  /**
   * Index of the painting chunk nearest the predicted view (half a lead ahead, the lead being
   * capped like the prepare range - an uncapped prediction at high speed would sit beyond the
   * prepared area and favour its far edge over the chunks scrolling in next); -1 = none left.
   */
  private nextPainting(): number {
    const p = this.painting;
    for (let k = p.length - 1; k >= 0; k--) if (p[k]!.stage !== Stage.Painting) this.dropPainting(k);
    const vx = (this.vi0 + this.vi1 + 1) / 2;
    const vy = (this.vj0 + this.vj1 + 1) / 2;
    const ax = this.leadX / 2;
    const ay = this.leadY / 2;
    const cx = vx + Math.min(ax, Math.max(-ax, (this.velX * TERRAIN_LEAD_MS * 0.5) / CHUNK));
    const cy = vy + Math.min(ay, Math.max(-ay, (this.velY * TERRAIN_LEAD_MS * 0.5) / CHUNK));
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < p.length; k++) {
      const c = p[k]!;
      // on-screen chunks first (nearest the view centre), then Chebyshev distance in chunks to the
      // predicted view; a started chunk wins near-ties (finish what is begun)
      const d = this.isVisible(c)
        ? -1000 + Math.max(Math.abs(c.i + 0.5 - vx), Math.abs(c.j + 0.5 - vy))
        : Math.max(Math.abs(c.i + 0.5 - cx), Math.abs(c.j + 0.5 - cy)) - c.band * (0.4 / BANDS);
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
  private open(i: number, j: number, vj0: number, vj1: number): Chunk {
    const x = i * CHUNK;
    const y = j * CHUNK;
    // above the view's middle: its bottom edge scrolls in first, so paint bottom-up
    const up = j * 2 + 1 < vj0 + vj1 + 1;
    const outside = x >= this.spec.worldSize.w || y >= this.spec.worldSize.h || x + CHUNK <= 0 || y + CHUNK <= 0;
    if (outside || !piecesTouch(this.pieces, { x, y, w: CHUNK, h: CHUNK })) return { i, j, surface: null, stage: Stage.Empty, band: BANDS, up, drew: false, dirty: false, late: false };
    const recycled = this.free.pop();
    const f = recycled ?? this.surface();
    if (recycled) {
      f.ctx.setTransform(1, 0, 0, 1, 0, 0);
      f.ctx.clearRect(0, 0, CHUNK, CHUNK);
    }
    f.sprite.visible = false;
    const c: Chunk = { i, j, surface: f, stage: Stage.Painting, band: 0, up, drew: false, dirty: false, late: false };
    this.painting.push(c);
    return c;
  }

  /**
   * Level load / camera jump only: finish a chunk this frame and show it,
   * bypassing the budget and upload caps (counted in syncUploadsLastUpdate).
   */
  private prepareNow(c: Chunk): void {
    if (c.stage === Stage.Shown || c.stage === Stage.Empty) return;
    while (c.stage === Stage.Painting) this.paintBand(c);
    if (c.stage === Stage.Painted) {
      this.show(c);
      this.syncUploadsLastUpdate++;
      this.syncUploadsTotal++;
    }
  }

  /** Paint the chunk's next band (clipped to it: the finished chunk is pixel-identical to a one-pass paint). */
  private paintBand(c: Chunk): void {
    const f = c.surface;
    if (!f || c.stage !== Stage.Painting) return;
    const r = this.band;
    r.x = c.i * CHUNK;
    r.y = c.j * CHUNK + (c.up ? BANDS - 1 - c.band : c.band) * TERRAIN_BAND_ROWS;
    const ctx = f.ctx;
    ctx.setTransform(1, 0, 0, 1, -r.x, -c.j * CHUNK);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    const drew = paintPieces(ctx, this.pieces, this.tiles, r, this.cracks);
    ctx.restore();
    if (drew) {
      c.drew = true;
      c.dirty = true; // a band that drew nothing changed nothing: no re-upload for it
    }
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

  /** Upload + show a painted chunk (Pixi uploads inside texture.source.update() for an initialised source). */
  private show(c: Chunk): void {
    this.showPartial(c);
    c.stage = Stage.Shown;
  }

  /** Upload + show what a chunk holds so far (an on-screen chunk filling in late). */
  private showPartial(c: Chunk): void {
    const f = c.surface!;
    const u0 = this.clock();
    f.texture.source.update(); // Pixi uploads right here (an initialised source): timed as UPLOAD
    const du = this.clock() - u0;
    this.uploadMsLastUpdate += du;
    // a never-initialised source (no uploader) did not upload here - the render will: keep it out of the estimate
    if (f.gpu) this.uploadMs += (du - this.uploadMs) * 0.2;
    f.gpu = true;
    f.sprite.position.set(c.i * CHUNK, c.j * CHUNK);
    f.sprite.visible = true;
    c.dirty = false;
    this.uploadsLastUpdate++;
  }

  private close(c: Chunk): void {
    if (c.surface) this.release(c.surface);
    c.surface = null;
    c.stage = Stage.Empty; // queued entries are skipped when reached
  }

  private surface(): Surface {
    const canvas = makeCanvas(CHUNK, CHUNK);
    // CPU-backed (willReadFrequently): band painting then really costs what the budget measures, and
    // an upload is a plain pixel copy. A GPU-accelerated canvas records the draws and rasterises
    // them at upload time - unbudgeted, inside texture.source.update() (round 4 Mac hitches).
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    const texture = Texture.from(canvas as HTMLCanvasElement);
    const sprite = new Sprite(texture);
    sprite.visible = false;
    this.root.addChild(sprite);
    let gpu = false;
    if (this.uploader) {
      // GPU init now (a 256 KB upload, timed as UPLOAD) so later updates upload where the budget sees them
      const u0 = this.clock();
      this.uploader(texture.source);
      this.uploadMsLastUpdate += this.clock() - u0;
      gpu = true;
    }
    return { canvas, ctx, texture, sprite, gpu };
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

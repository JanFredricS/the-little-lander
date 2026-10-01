/**
 * TerrainView streaming (stutter rounds 2-3): budgeted band painting with no
 * synchronous escape hatch in steady flight, late on-screen chunks filled
 * band by band at top priority, uploads on a later frame than the paint
 * (off-screen), velocity look-ahead, surface recycling.
 * Pixi and canvases are faked (Node has neither); the painter is real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let frame = 0;
let canvasesMade = 0;
/** Bands painted in the current frame (TerrainView issues exactly one ctx.rect per band). */
let bandsThisFrame = 0;
/** Draw calls (drawImage / fillRect) issued in the current frame. */
let opsThisFrame = 0;
/** Texture uploads issued in the current frame. */
let uploadsThisFrame = 0;
let bandsFrame = -1;
/** Virtual-clock reading at the start of the frame's latest band (see bandClock). */
let lastBandStart = 0;
/** Upload log: [frame of the upload, frame of that canvas's last paint band, canvas, new pixels since its previous upload]. */
const uploadLog: Array<[number, number, FakeCanvas, boolean]> = [];

/** Coarse pixel model of a chunk canvas: CELL px cells, each remembering which chunk origin drew it. */
const CELL = 8;

function startFrameCount(): void {
  if (bandsFrame !== frame) {
    bandsFrame = frame;
    bandsThisFrame = 0;
    opsThisFrame = 0;
    uploadsThisFrame = 0;
  }
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * 2D context stub with a coarse pixel model: translation-only transforms, rect
 * clips (polygon clips are ignored: conservative), clearRect, and draws that
 * mark the cells they cover with the chunk origin they were drawn for (the
 * negated setTransform translation, as TerrainView.paintBand sets it).
 */
class FakeCtx {
  fillStyle: unknown = '#000';
  imageSmoothingEnabled = true;
  private tx = 0;
  private ty = 0;
  private clipBox: Box = { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity };
  private pathBox: Box | null = null;
  private stack: Array<{ tx: number; ty: number; clip: Box }> = [];
  constructor(private readonly canvas: FakeCanvas) {}
  setTransform(_a: number, _b: number, _c: number, _d: number, e: number, f: number) {
    this.tx = e;
    this.ty = f;
  }
  translate(x: number, y: number) {
    this.tx += x;
    this.ty += y;
  }
  scale() {}
  save() {
    this.stack.push({ tx: this.tx, ty: this.ty, clip: { ...this.clipBox } });
  }
  restore() {
    const s = this.stack.pop()!;
    this.tx = s.tx;
    this.ty = s.ty;
    this.clipBox = s.clip;
  }
  beginPath() {
    this.pathBox = null;
  }
  rect(x: number, y: number, w: number, h: number) {
    this.pathBox = { x0: x + this.tx, y0: y + this.ty, x1: x + w + this.tx, y1: y + h + this.ty };
    // one rect per band: frame accounting for the virtual clock
    this.canvas.lastPaintFrame = frame;
    startFrameCount();
    bandsThisFrame++;
    lastBandStart = paintClock();
    this.canvas.bandRows.push([this.pathBox.y0, this.pathBox.y1]);
  }
  moveTo() {
    this.pathBox = null; // a polygon path: ignored as a clip (conservative)
  }
  lineTo() {}
  closePath() {}
  clip() {
    const r = this.pathBox;
    if (!r) return;
    const c = this.clipBox;
    this.clipBox = { x0: Math.max(c.x0, r.x0), y0: Math.max(c.y0, r.y0), x1: Math.min(c.x1, r.x1), y1: Math.min(c.y1, r.y1) };
  }
  clearRect(x: number, y: number, w: number, h: number) {
    if (this.tx === 0 && this.ty === 0 && x <= 0 && y <= 0 && x + w >= this.canvas.width && y + h >= this.canvas.height) {
      this.canvas.cells.fill(0);
      this.canvas.bandRows.length = 0;
    }
  }
  private mark(x: number, y: number, w: number, h: number) {
    startFrameCount();
    opsThisFrame++;
    const c = this.clipBox;
    const x0 = Math.max(x + this.tx, c.x0, 0);
    const y0 = Math.max(y + this.ty, c.y0, 0);
    const x1 = Math.min(x + w + this.tx, c.x1, this.canvas.width);
    const y1 = Math.min(y + h + this.ty, c.y1, this.canvas.height);
    if (!(x0 < x1 && y0 < y1)) return;
    const origin = -this.tx * 1e6 + -this.ty + 0.5; // never 0
    const n = this.canvas.width / CELL;
    for (let cy = Math.floor(y0 / CELL); cy < Math.ceil(y1 / CELL); cy++)
      for (let cx = Math.floor(x0 / CELL); cx < Math.ceil(x1 / CELL); cx++) this.canvas.cells[cy * n + cx] = origin;
    this.canvas.fresh = true;
  }
  fillRect(x: number, y: number, w: number, h: number) {
    this.mark(x, y, w, h);
  }
  drawImage(img: FakeCanvas, ...a: number[]) {
    if (a.length === 2) this.mark(a[0]!, a[1]!, img.width, img.height);
    else this.mark(a[4]!, a[5]!, a[6]!, a[7]!);
  }
}

class FakeCanvas {
  lastPaintFrame = -1;
  readonly cells: Float64Array;
  /** Canvas rows [y0, y1) of every band clip since the last full clear. */
  readonly bandRows: Array<[number, number]> = [];
  /** Pixels drawn since the last upload. */
  fresh = false;
  private ctx: FakeCtx | null = null;
  constructor(
    public width: number,
    public height: number,
  ) {
    canvasesMade++;
    this.cells = new Float64Array(Math.ceil(width / CELL) * Math.ceil(height / CELL));
  }
  getContext(): unknown {
    return (this.ctx ??= new FakeCtx(this));
  }
  /** Origins (chunk world x * 1e6 + y) of every drawn cell. */
  origins(): Set<number> {
    const s = new Set<number>();
    for (const v of this.cells) if (v !== 0) s.add(v - 0.5);
    return s;
  }
  /** Every drawn cell lies in a band painted since the last clear. */
  cellsInPaintedBands(): boolean {
    const n = this.width / CELL;
    for (let k = 0; k < this.cells.length; k++) {
      if (this.cells[k] === 0) continue;
      const y0 = Math.floor(k / n) * CELL;
      if (!this.bandRows.some(([a, b]) => y0 + CELL > a && y0 < b)) return false;
    }
    return true;
  }
}

vi.mock('pixi.js', () => {
  class Container {
    children: unknown[] = [];
    addChild(c: unknown) {
      this.children.push(c);
      return c;
    }
    destroy() {}
  }
  class Sprite {
    visible = true;
    position = { x: 0, y: 0, set(x: number, y: number) { this.x = x; this.y = y; } };
    constructor(public texture: { canvas: FakeCanvas }) {}
  }
  const Texture = {
    from(canvas: FakeCanvas) {
      return {
        canvas,
        source: {
          update: () => {
            startFrameCount();
            uploadsThisFrame++;
            uploadLog.push([frame, canvas.lastPaintFrame, canvas, canvas.fresh]);
            canvas.fresh = false;
          },
        },
        destroy() {},
      };
    },
  };
  return { Container, Sprite, Texture };
});

const { TerrainView, TERRAIN_UPLOADS_PER_FRAME, TERRAIN_VISIBLE_UPLOADS_PER_FRAME, TERRAIN_PAINT_BUDGET_MAX_MS, TERRAIN_UPLOAD_BUDGET_MS, TERRAIN_CHUNK } = await import('../src/render/terrainView');
const { getLevel } = await import('../src/levels/registry');
const { PALETTES } = await import('../src/art/palettes');

const tile = new FakeCanvas(16, 16);
const art = { palettes: PALETTES, getTile: () => tile } as never;

let clockBandMs = 0;
let clockOpMs = 0;
let clockUploadMs = 0;
/** The virtual clock without upload time (band cost accounting). */
function paintClock(): number {
  const cur = bandsFrame === frame;
  return frame * (1000 / 60) + (cur ? bandsThisFrame * clockBandMs + opsThisFrame * clockOpMs : 0);
}
function clockNow(): number {
  const cur = bandsFrame === frame;
  return frame * (1000 / 60) + (cur ? bandsThisFrame * clockBandMs + opsThisFrame * clockOpMs + uploadsThisFrame * clockUploadMs : 0);
}
/**
 * Virtual clock: frames 16.7 ms apart; within a frame every band costs
 * `bandMs` plus `opMs` per draw call it issues (real painter work: bands
 * vary in cost, so the estimate-driven budget can be checked for real).
 */
function bandClock(bandMs: number, opMs = 0, uploadMs = 0): () => number {
  clockBandMs = bandMs;
  clockOpMs = opMs;
  clockUploadMs = uploadMs;
  return clockNow;
}

beforeEach(() => {
  vi.stubGlobal('OffscreenCanvas', FakeCanvas);
  frame = 0;
  canvasesMade = 0;
  bandsThisFrame = 0;
  opsThisFrame = 0;
  uploadsThisFrame = 0;
  bandsFrame = -1;
  lastBandStart = 0;
  uploadLog.length = 0;
});
afterEach(() => vi.unstubAllGlobals());

type View = InstanceType<typeof TerrainView>;
interface ChunkPeek {
  i: number;
  j: number;
  stage: number;
  surface: { sprite: { visible: boolean }; canvas: FakeCanvas } | null;
}
const chunksOf = (tv: View) => [...(tv as unknown as { chunks: Map<number, ChunkPeek> }).chunks.values()];
const PAINTING = 0;
const PAINTED = 1;
const SHOWN = 2;
const EMPTY = 3;

/**
 * Every upload logged from index `from` on shows only pixels painted FOR that
 * chunk (a recycled canvas was cleared), only in bands painted since, and a
 * re-upload without new pixels happens only as the final show of a finished
 * chunk. Run right after the update that logged them. Returns the index to
 * continue from.
 */
function checkUploads(tv: View, from: number): number {
  const byCanvas = new Map<FakeCanvas, ChunkPeek>();
  for (const c of chunksOf(tv)) if (c.surface) byCanvas.set(c.surface.canvas, c);
  for (let k = from; k < uploadLog.length; k++) {
    const [, , canvas, fresh] = uploadLog[k]!;
    const c = byCanvas.get(canvas);
    expect(c, 'uploaded canvas belongs to a live chunk').toBeDefined();
    const origin = c!.i * TERRAIN_CHUNK * 1e6 + c!.j * TERRAIN_CHUNK;
    for (const o of canvas.origins()) expect(o, `chunk ${c!.i},${c!.j}: stale pixels from another chunk`).toBe(origin);
    expect(canvas.cellsInPaintedBands(), `chunk ${c!.i},${c!.j}: pixels outside its painted bands`).toBe(true);
    if (!fresh) expect(c!.stage, `chunk ${c!.i},${c!.j}: re-uploaded with nothing new`).toBe(SHOWN);
  }
  return uploadLog.length;
}

function onScreen(c: ChunkPeek, x: number, y: number): boolean {
  return c.i >= Math.floor(x / TERRAIN_CHUNK) && c.i <= Math.floor((x + 639) / TERRAIN_CHUNK) && c.j >= Math.floor(y / TERRAIN_CHUNK) && c.j <= Math.floor((y + 359) / TERRAIN_CHUNK);
}

/** Fly down `frames` frames at `pxPerFrame`, calling `each` after every update. */
function descend(tv: View, x: number, y0: number, pxPerFrame: number, frames: number, each?: (y: number) => void): number {
  let y = y0;
  for (let f = 0; f < frames; f++) {
    frame++;
    y += pxPerFrame;
    tv.update({ x, y });
    each?.(y);
  }
  return y;
}

describe('TerrainView streaming', () => {
  const spec = getLevel('descent')!;
  // the boulder-field shaft: its left wall is on screen
  const x = 400;
  const y0 = 4000;

  it('prepares the whole area on the first update (level load), synchronously', () => {
    const tv = new TerrainView(spec, art, bandClock(0.25));
    tv.update({ x, y: y0 });
    expect(tv.paintedCount).toBeGreaterThan(0);
    expect(tv.pendingCount).toBe(0);
    expect(tv.lateChunks).toBe(0);
    // load-frame accounting: every chunk shown was a synchronous (exempt) upload, painted this same frame
    expect(tv.syncUploadsLastUpdate).toBe(tv.paintedCount);
    expect(tv.uploadsLastUpdate).toBe(tv.paintedCount);
    expect(uploadLog.length).toBe(tv.paintedCount);
    expect(uploadLog.every(([up, painted]) => up === painted)).toBe(true);
    expect(tv.jumpUpdates).toBe(0);
  });

  it('a chunk inside a piece bbox where no pixel lands ends up empty (no surface, no upload)', () => {
    const style = spec.terrain.pieces[0]!.style;
    // an L of two 40 px bars: its bbox covers chunk (2,2), its rock never reaches it
    const L = {
      ...spec,
      worldSize: { w: 1024, h: 1024 },
      terrain: { pieces: [{ id: 'L', kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 1024, y: 0 }, { x: 1024, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 1024 }, { x: 0, y: 1024 }], style }] },
      zones: [],
    } as unknown as typeof spec;
    const tv = new TerrainView(L, art, bandClock(0.25));
    tv.update({ x: 384, y: 384 }); // view on chunks (1..3, 1..2)
    const c22 = chunksOf(tv).find((c) => c.i === 2 && c.j === 2)!;
    expect(c22.stage).toBe(EMPTY);
    expect(c22.surface).toBeNull();
    const c00 = chunksOf(tv).find((c) => c.i === 0 && c.j === 0)!;
    expect(c00.stage).toBe(SHOWN);
  });

  it('keeping up: at fast descent nothing on screen is late, and no chunk is uploaded in the frame its last band was painted', () => {
    const tv = new TerrainView(spec, art, bandClock(0.25));
    tv.update({ x, y: y0 });
    const firstUploads = uploadLog.length;
    // ~1200 px/s at 60 fps, 5000 px of shaft
    let logged = firstUploads;
    descend(tv, x, y0, 20, 250, () => {
      expect(tv.syncUploadsLastUpdate).toBe(0);
      expect(tv.unreadyVisibleLastUpdate).toBe(0);
      logged = checkUploads(tv, logged);
    });
    expect(tv.lateChunks).toBe(0);
    const flight = uploadLog.slice(firstUploads);
    expect(flight.length).toBeGreaterThan(20);
    for (const [up, painted] of flight) expect(painted).toBeLessThan(up);
    const perFrame = new Map<number, number>();
    for (const [up] of flight) perFrame.set(up, (perFrame.get(up) ?? 0) + 1);
    expect(Math.max(...perFrame.values())).toBeLessThanOrEqual(TERRAIN_UPLOADS_PER_FRAME);
  });

  it('falling behind (slow canvas): never more than the max budget per frame; late chunks fill in band by band, visible as they fill', () => {
    // a slow canvas: ~1.5 ms per band plus 0.02 ms per draw call (bands differ in cost)
    const tv = new TerrainView(spec, art, bandClock(1.5, 0.02));
    tv.update({ x, y: y0 });
    let logged = uploadLog.length;
    let partialSeen = false;
    let unreadyFrames = 0;
    let multiBandFrames = 0;
    // the budget held every frame: a band only STARTS while its estimated cost still fits, so a
    // frame's time minus its last band's cost is within the budget (no fixed per-band cost assumed)
    const budgetHeld = () => {
      const lastBand = tv.bandsLastUpdate > 0 ? paintClock() - lastBandStart : 0;
      expect(tv.msLastUpdate - lastBand).toBeLessThanOrEqual(tv.budgetLastUpdate + 1e-9);
      expect(tv.budgetLastUpdate).toBeLessThanOrEqual(TERRAIN_PAINT_BUDGET_MAX_MS);
      if (tv.bandsLastUpdate > 1) multiBandFrames++;
    };
    // ~3600 px/s: far more than these bands can keep up with
    const y = descend(tv, x, y0, 60, 120, (yy) => {
      expect(tv.syncUploadsLastUpdate).toBe(0); // no synchronous finishing in steady flight
      expect(tv.jumpUpdates).toBe(0);
      budgetHeld();
      if (tv.unreadyVisibleLastUpdate > 0) unreadyFrames++;
      for (const c of chunksOf(tv)) if (onScreen(c, x, yy) && c.stage === PAINTING && c.surface?.sprite.visible) partialSeen = true;
      expect(tv.uploadsLastUpdate).toBeLessThanOrEqual(TERRAIN_UPLOADS_PER_FRAME + TERRAIN_VISIBLE_UPLOADS_PER_FRAME);
      logged = checkUploads(tv, logged);
    });
    expect(multiBandFrames).toBeGreaterThan(10); // the check above was exercised with several bands per frame
    expect(tv.lateChunks).toBeGreaterThan(0);
    expect(unreadyFrames).toBeGreaterThan(0);
    expect(partialSeen).toBe(true); // an unfinished on-screen chunk was uploaded + shown as it filled
    // each late chunk counted once: never more than the chunks that were ever opened
    expect(tv.lateChunks).toBeLessThan(120);
    // hover: the backlog drains within the budget (on screen first) and everything ends up shown
    let settle = 0;
    let onScreenDone: number | undefined;
    while (settle < 1000 && (tv.unreadyVisibleLastUpdate > 0 || tv.pendingCount > 0)) {
      frame++;
      settle++;
      tv.update({ x, y });
      budgetHeld();
      logged = checkUploads(tv, logged);
      if (tv.unreadyVisibleLastUpdate === 0) onScreenDone ??= settle;
    }
    expect(onScreenDone).toBeLessThan(60); // the screen is whole again within a second
    expect(tv.unreadyVisibleLastUpdate).toBe(0);
    expect(tv.pendingCount).toBe(0);
    for (const c of chunksOf(tv)) if (onScreen(c, x, y)) expect(c.stage === SHOWN || c.stage === EMPTY).toBe(true);
  });

  it('a visible chunk that is painted but not yet uploaded is shown within the visible cap, counted late, never stuck', () => {
    // free bands: the whole ring paints in one frame while off-screen uploads stay capped -> a backlog of painted chunks
    const tv = new TerrainView(spec, art, bandClock(0));
    tv.update({ x, y: y0 });
    frame++;
    tv.update({ x, y: y0 + 300 }); // steady flight: opens rows below and paints them all
    const backlog = chunksOf(tv).filter((c) => c.stage === PAINTED).length;
    expect(backlog).toBeGreaterThan(TERRAIN_UPLOADS_PER_FRAME);
    const late0 = tv.lateChunks;
    frame++;
    tv.update({ x, y: y0 + 600 }); // that row is on screen before its upload frame came up
    expect(tv.jumpUpdates).toBe(0);
    expect(tv.syncUploadsLastUpdate).toBe(0);
    expect(tv.lateChunks).toBeGreaterThan(late0);
    expect(tv.uploadsLastUpdate).toBeLessThanOrEqual(TERRAIN_UPLOADS_PER_FRAME + TERRAIN_VISIBLE_UPLOADS_PER_FRAME);
    // a few frames later everything on screen is shown and nothing painted is left waiting
    let logged = checkUploads(tv, 0);
    for (let k = 0; k < 30; k++) {
      frame++;
      tv.update({ x, y: y0 + 600 });
      logged = checkUploads(tv, logged);
    }
    expect(tv.unreadyVisibleLastUpdate).toBe(0);
    expect(tv.pendingCount).toBe(0);
    for (const c of chunksOf(tv)) if (onScreen(c, x, y0 + 600)) expect(c.stage === SHOWN || c.stage === EMPTY).toBe(true);
  });

  it('a long frame at speed is not a camera jump (no synchronous repaint)', () => {
    const tv = new TerrainView(spec, art, bandClock(0.25));
    tv.update({ x, y: y0 });
    let y = descend(tv, x, y0, 40, 60); // ~2400 px/s
    // a 200 ms stall: the camera moved ~480 px, as its velocity predicted
    frame += 12;
    y += 480;
    tv.update({ x, y });
    expect(tv.jumpUpdates).toBe(0);
    expect(tv.syncUploadsLastUpdate).toBe(0);
  });

  it('leads along the direction of travel and recycles surfaces', () => {
    const tv = new TerrainView(spec, art, bandClock(0.25));
    tv.update({ x, y: y0 });
    const made = canvasesMade;
    const y = descend(tv, x, y0, 20, 250);
    const js = chunksOf(tv).map((c) => c.j);
    const vj0 = Math.floor(y / TERRAIN_CHUNK);
    const vj1 = Math.floor((y + 360) / TERRAIN_CHUNK);
    expect(Math.max(...js) - vj1).toBeGreaterThanOrEqual(2); // margin + lead below
    expect(vj0 - Math.min(...js)).toBeLessThanOrEqual(2); // margin (+ hysteresis) only above
    // steady state: culled surfaces are repainted in place, not re-created
    const mid = canvasesMade;
    let logged = uploadLog.length;
    // recycled canvases are cleared: every upload shows only its own chunk's pixels
    descend(tv, x, y, 20, 150, () => (logged = checkUploads(tv, logged)));
    expect(canvasesMade - mid).toBeLessThanOrEqual(2);
    expect(mid - made).toBeLessThan(60);
  });

  it('a camera jump (restart) resets the lead; on-screen chunks are finished at once', () => {
    const tv = new TerrainView(spec, art, bandClock(0.25));
    tv.update({ x, y: y0 });
    const y = descend(tv, x, y0, 20, 60);
    const late0 = tv.lateChunks;
    const made = canvasesMade;
    const surfacesBefore = chunksOf(tv).filter((c) => c.surface).length;
    frame++;
    const logged = uploadLog.length;
    tv.update({ x, y: y0 }); // 1200 px back up: a jump
    checkUploads(tv, logged);
    expect(y - y0).toBeGreaterThan(360);
    expect(tv.jumpUpdates).toBe(1);
    expect(tv.lateChunks).toBe(late0); // exempt from the steady-flight late count...
    expect(tv.syncUploadsLastUpdate).toBeGreaterThan(0); // ...but its synchronous uploads are counted
    // abandoned chunks were released BEFORE the new set opened: their surfaces were reused
    expect(surfacesBefore).toBeGreaterThan(4);
    expect(canvasesMade - made).toBe(0);
    // everything on screen is shown after the jump frame
    for (const c of chunksOf(tv)) if (onScreen(c, x, y0) && c.surface) expect(c.stage).toBe(SHOWN);
  });
  /** Fly down at `pxPerFrame` until the velocity estimate settles. */
  function cruise(tv: View, yStart: number, pxPerFrame: number, frames: number): number {
    tv.update({ x, y: yStart });
    return descend(tv, x, yStart, pxPerFrame, frames);
  }

  function screenReady(tv: View, yy: number): void {
    expect(tv.unreadyVisibleLastUpdate).toBe(0);
    for (const c of chunksOf(tv)) if (onScreen(c, x, yy)) expect(c.stage === SHOWN || c.stage === EMPTY, `chunk ${c.i},${c.j}`).toBe(true);
  }

  it('a stall along the flight path inside the reach is NOT a jump: the new screen fills in late within the budget, no repeat', () => {
    // bands, draw calls AND uploads cost time (a canvas that keeps up at this speed without stalls)
    const tv = new TerrainView(spec, art, bandClock(0.5, 0.005, 1));
    let y = cruise(tv, 1000, 42, 60); // ~2500 px/s
    const syncAtLoad = tv.syncUploadsTotal;
    let logged = uploadLog.length;
    const frameOk = () => {
      expect(tv.syncUploadsLastUpdate).toBe(0);
      // paint within its budget (minus the last band) + uploads within theirs (minus the last upload)
      const lastBand = tv.bandsLastUpdate > 0 ? paintClock() - lastBandStart : 0;
      expect(tv.msLastUpdate - tv.uploadMsLastUpdate - lastBand).toBeLessThanOrEqual(tv.budgetLastUpdate + 1e-9);
      expect(tv.uploadMsLastUpdate).toBeLessThanOrEqual(TERRAIN_UPLOAD_BUDGET_MS + 1);
      logged = checkUploads(tv, logged);
    };
    for (const stallFrames of [6, 18, 60]) {
      // a 100 ms, 300 ms, 1 s stall (GC, tab jank): the camera moved on as predicted
      frame += stallFrames;
      y += 42 * stallFrames;
      tv.update({ x, y });
      frameOk();
      // ...and flight goes on: the stall must not feed itself (no jump, no synchronous frame)
      let ready: number | undefined;
      for (let f = 1; f <= 90; f++) {
        frame++;
        y += 42;
        tv.update({ x, y });
        frameOk();
        if (tv.unreadyVisibleLastUpdate === 0) ready ??= f;
      }
      expect(ready, `screen whole again after a ${stallFrames}-frame stall`).toBeLessThan(60);
    }
    expect(tv.jumpUpdates).toBe(0);
    expect(tv.syncUploadsTotal).toBe(syncAtLoad); // nothing synchronous after the level load
  });

  it('a velocity-aligned move beyond the reach (~2x the look-ahead) is a jump: the new screen is whole at once', () => {
    const tv = new TerrainView(spec, art, bandClock(0.25));
    let y = cruise(tv, 1000, 150, 40); // 9000 px/s, velocity estimate settled; lead capped at TERRAIN_MAX_LEAD chunks
    // a 600 ms stall at that speed: 5400 px, exactly as predicted, past the reach
    frame += 36;
    y += 5400;
    const logged = uploadLog.length;
    tv.update({ x, y });
    expect(tv.jumpUpdates).toBe(1);
    screenReady(tv, y);
    checkUploads(tv, logged);
  });

  /** On-screen terrain chunks (non-empty) and how many of them show something (finished, or partly as they fill). */
  function screenShown(tv: View, yy: number): { terrain: number; showing: number } {
    let terrain = 0;
    let showing = 0;
    for (const c of chunksOf(tv)) {
      if (!onScreen(c, x, yy) || c.stage === EMPTY) continue;
      terrain++;
      if (c.stage === SHOWN || c.surface?.sprite.visible) showing++;
    }
    return { terrain, showing };
  }

  it('an extreme-speed long frame INSIDE the reach that leaves the screen fully blank is prepared at once, exactly once', () => {
    const tv = new TerrainView(spec, art, bandClock(0.25));
    let y = cruise(tv, 1000, 150, 40); // 9000 px/s
    expect(tv.jumpUpdates).toBe(0);
    // a 250 ms frame: 2250 px, as predicted - inside the reach (not a jump by the reach rule)
    frame += 15;
    y += 2250;
    let logged = uploadLog.length;
    tv.update({ x, y });
    logged = checkUploads(tv, logged);
    expect(tv.blankUpdates).toBe(1);
    expect(tv.jumpUpdates).toBe(1);
    expect(tv.syncUploadsLastUpdate).toBeGreaterThan(0);
    screenReady(tv, y);
    // flight goes on: never blank again, the next frame is not synchronous, few frames below fully shown
    let partial = 0;
    for (let f = 1; f <= 60; f++) {
      frame++;
      y += 150;
      tv.update({ x, y });
      logged = checkUploads(tv, logged);
      if (f === 1) expect(tv.syncUploadsLastUpdate).toBe(0);
      const s = screenShown(tv, y);
      expect(s.terrain === 0 || s.showing > 0, `frame ${f}: screen blank`).toBe(true);
      if (s.showing < s.terrain) partial++;
    }
    expect(tv.blankUpdates).toBe(1);
    expect(tv.jumpUpdates).toBe(1);
    expect(partial).toBeLessThanOrEqual(10);
  });

  it('a blank screen is not re-prepared on two updates in a row (no self-feeding synchronous loop)', () => {
    const tv = new TerrainView(spec, art, bandClock(0.25));
    let y = cruise(tv, 1000, 150, 40);
    frame += 15;
    y += 2250;
    tv.update({ x, y }); // blank -> prepared
    frame += 15;
    y += 2250;
    tv.update({ x, y }); // blank again right away: waits a frame (late fill)
    expect(tv.blankUpdates).toBe(1);
    expect(tv.syncUploadsLastUpdate).toBe(0);
  });

  it('a backward snap: under a view it overlaps the shown screen (no sync); a view or more is a jump prepared once', () => {
    const tv = new TerrainView(spec, art, bandClock(0.25));
    let y = cruise(tv, 1000, 150, 40); // flying down at 9000 px/s, lead below
    frame++;
    y -= 359; // snap back up, just under a view: not a teleport
    tv.update({ x, y });
    expect(tv.jumpUpdates).toBe(0);
    expect(tv.syncUploadsLastUpdate).toBe(0);
    const s = screenShown(tv, y);
    expect(s.showing).toBeGreaterThan(0);
    for (let f = 0; f < 30; f++) {
      frame++;
      tv.update({ x, y });
    }
    screenReady(tv, y);
    // now down again and a snap back up past the trailing margin by more than a view: a jump
    y = descend(tv, x, y, 150, 30);
    frame++;
    y -= 900;
    const logged = uploadLog.length;
    tv.update({ x, y });
    checkUploads(tv, logged);
    expect(tv.jumpUpdates).toBe(1);
    expect(tv.blankUpdates).toBe(0);
    screenReady(tv, y);
    frame++;
    tv.update({ x, y });
    expect(tv.jumpUpdates).toBe(1); // prepared once
    expect(tv.syncUploadsLastUpdate).toBe(0);
  });

  it('GPU init: every new surface is initialised once through the uploader; without one, first updates stay out of the upload estimate', () => {
    // with an uploader (the App's renderer.texture.initSource)
    const tv = new TerrainView(spec, art, bandClock(0.25, 0, 3));
    const inits = new Map<unknown, number>();
    tv.setUploader((src) => inits.set(src, (inits.get(src) ?? 0) + 1));
    // every chunk surface ever live (recycled ones keep their source)
    const sources = new Set<unknown>();
    const collect = () => {
      for (const c of chunksOf(tv)) if (c.surface) sources.add((c.surface as unknown as { texture: { source: unknown } }).texture.source);
    };
    tv.update({ x, y: y0 });
    collect();
    descend(tv, x, y0, 20, 120, collect);
    expect(sources.size).toBeGreaterThan(10);
    expect(inits.size).toBe(sources.size);
    for (const src of sources) expect(inits.has(src)).toBe(true);
    expect([...inits.values()].every((n) => n === 1)).toBe(true);
    // measured uploads (3 ms each) moved the estimate
    expect(tv.uploadMs).toBeGreaterThan(2);

    // without one, the load's uploads are all first updates of fresh sources: not measured
    const bare = new TerrainView(spec, art, bandClock(0.25, 0, 3));
    const initial = bare.uploadMs;
    bare.update({ x, y: y0 });
    expect(bare.uploadsLastUpdate).toBeGreaterThan(0);
    expect(bare.uploadMs).toBe(initial);
  });

  it('uploads stay within their per-frame budget (the first always runs) and every chunk still ends up shown', () => {
    const tv = new TerrainView(spec, art, bandClock(0.25, 0, 1.2)); // ~1.2 ms per upload: one and a half fit the budget
    tv.update({ x, y: y0 });
    let maxUploads = 0;
    let y = descend(tv, x, y0, 30, 200, () => {
      expect(tv.uploadMsLastUpdate - (tv.uploadsLastUpdate > 0 ? 1.2 : 0)).toBeLessThanOrEqual(TERRAIN_UPLOAD_BUDGET_MS + 1e-9);
      maxUploads = Math.max(maxUploads, tv.uploadsLastUpdate);
    });
    expect(maxUploads).toBeLessThanOrEqual(2);
    for (let k = 0; k < 120; k++) {
      frame++;
      tv.update({ x, y });
    }
    expect(tv.pendingCount).toBe(0);
    screenReady(tv, y);
  });

  it('an exact one-screen teleport from a hover is a jump', () => {
    const tv = new TerrainView(spec, art, bandClock(0.25));
    tv.update({ x, y: y0 });
    for (let k = 0; k < 30; k++) {
      frame++;
      tv.update({ x, y: y0 });
    }
    frame++;
    tv.update({ x, y: y0 + 360 }); // VIEW_HEIGHT exactly
    expect(tv.jumpUpdates).toBe(1);
    screenReady(tv, y0 + 360);
  });

  it('at very high speed the chunks scrolling in next are painted before the far edge of the lead', () => {
    const tv = new TerrainView(spec, art, bandClock(2));
    let y = cruise(tv, 1000, 60, 1); // ~3600 px/s: uncapped half-lead would be ~8 chunks ahead
    type Peek = { painting: ChunkPeek[]; nextPainting(): number; vj1: number; pj1: number };
    const peek = tv as unknown as Peek;
    let checked = 0;
    for (let f = 0; f < 120; f++) {
      frame++;
      y += 60;
      tv.update({ x, y });
      const k = peek.nextPainting();
      if (k < 0) continue;
      const chosen = peek.painting[k]!;
      const nearRow = peek.vj1 + 2;
      // something just below the view is still unfinished: it must win over the far lead edge
      if (peek.painting.some((c) => c.j <= nearRow) && chosen.j > peek.vj1) {
        expect(chosen.j, `frame ${f}: picked row ${chosen.j}, view ends at ${peek.vj1}, lead edge ${peek.pj1}`).toBeLessThanOrEqual(nearRow + 1);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('a chunk inside a piece bbox lying in the open between two walls of that piece is empty (no surface, no upload)', () => {
    const style = spec.terrain.pieces[0]!.style;
    // a U: two 40 px walls joined at the bottom; the middle is open air the bbox covers
    const U = {
      ...spec,
      worldSize: { w: 1024, h: 1024 },
      terrain: {
        pieces: [
          {
            id: 'U',
            kind: 'polygon',
            points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 984 }, { x: 984, y: 984 }, { x: 984, y: 0 }, { x: 1024, y: 0 }, { x: 1024, y: 1024 }, { x: 0, y: 1024 }],
            style,
          },
        ],
      },
      zones: [],
    } as unknown as typeof spec;
    const tv = new TerrainView(U, art, bandClock(0.25));
    tv.update({ x: 300, y: 300 }); // view on chunks (1..3, 1..2): open air
    for (const [i, j] of [[1, 1], [2, 1], [1, 2], [2, 2]] as const) {
      const c = chunksOf(tv).find((q) => q.i === i && q.j === j)!;
      expect(c.stage, `chunk ${i},${j}`).toBe(EMPTY);
      expect(c.surface).toBeNull();
    }
    const wall = chunksOf(tv).find((c) => c.i === 0 && c.j === 1)!;
    expect(wall.stage).toBe(SHOWN);
  });
});

/**
 * TerrainView streaming (stutter round 2): budgeted band painting, uploads
 * on a later frame than the paint, velocity look-ahead, surface recycling.
 * Pixi and canvases are faked (Node has neither); the painter is real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let frame = 0;
let canvasesMade = 0;
/** Upload log: [frame of the upload, frame of that canvas's last paint band]. */
const uploadLog: Array<[number, number]> = [];

class FakeCanvas {
  lastPaintFrame = -1;
  constructor(
    public width: number,
    public height: number,
  ) {
    canvasesMade++;
  }
  getContext(): unknown {
    const canvas = this;
    const store: Record<string | symbol, unknown> = {};
    return new Proxy(store, {
      get(t, k) {
        if (k in t) return t[k];
        if (k === 'clip') return () => void (canvas.lastPaintFrame = frame);
        return () => undefined;
      },
      set(t, k, v) {
        t[k] = v;
        return true;
      },
    });
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
      return { canvas, source: { update: () => uploadLog.push([frame, canvas.lastPaintFrame]) }, destroy() {} };
    },
  };
  return { Container, Sprite, Texture };
});

const { TerrainView, TERRAIN_UPLOADS_PER_FRAME, TERRAIN_CHUNK } = await import('../src/render/terrainView');
const { getLevel } = await import('../src/levels/registry');
const { PALETTES } = await import('../src/art/palettes');

const tile = new FakeCanvas(16, 16);
const art = { palettes: PALETTES, getTile: () => tile } as never;

/** Fake clock: frames 16.7 ms apart; every read inside a frame advances 0.5 ms (the 2 ms budget fits ~4 bands). */
function fakeClock(): () => number {
  let f = -1;
  let t = 0;
  return () => {
    if (f !== frame) {
      f = frame;
      t = frame * (1000 / 60);
    }
    return (t += 0.5);
  };
}

beforeEach(() => {
  vi.stubGlobal('OffscreenCanvas', FakeCanvas);
  frame = 0;
  canvasesMade = 0;
  uploadLog.length = 0;
});
afterEach(() => vi.unstubAllGlobals());

function descend(tv: InstanceType<typeof TerrainView>, x: number, y0: number, pxPerFrame: number, frames: number): number {
  let y = y0;
  for (let f = 0; f < frames; f++) {
    frame++;
    y += pxPerFrame;
    tv.update({ x, y });
  }
  return y;
}

describe('TerrainView streaming', () => {
  const spec = getLevel('descent')!;
  const x = 800;

  it('prepares the whole area on the first update (level load), synchronously', () => {
    const tv = new TerrainView(spec, art, fakeClock());
    tv.update({ x, y: 400 });
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

  it('a visible chunk that is painted but not yet uploaded counts as late (and is shown at once)', () => {
    // clock frozen within a frame: the paint budget never runs out, so the whole ring paints in one
    // frame while uploads stay capped at TERRAIN_UPLOADS_PER_FRAME -> a backlog of painted chunks
    const tv = new TerrainView(spec, art, () => frame * (1000 / 60));
    tv.update({ x, y: 400 });
    frame++;
    tv.update({ x, y: 400 + 300 }); // < a view: steady flight, opens a new row below and paints it all
    const chunks = (tv as unknown as { chunks: Map<number, { i: number; j: number; stage: number }> }).chunks;
    const backlog = [...chunks.values()].filter((c) => c.stage === 1).length;
    expect(backlog).toBeGreaterThan(0);
    const late0 = tv.lateChunks;
    // scroll so that row is on screen before its uploads came up
    frame++;
    tv.update({ x, y: 400 + 600 });
    expect(tv.jumpUpdates).toBe(0);
    expect(tv.lateChunks).toBeGreaterThan(late0);
    expect(tv.syncUploadsLastUpdate).toBe(tv.lateChunks - late0); // every late chunk was a counted sync upload
    const vj0 = Math.floor(1000 / TERRAIN_CHUNK);
    const vj1 = Math.floor((1000 + 359) / TERRAIN_CHUNK);
    for (const c of chunks.values()) if (c.j >= vj0 && c.j <= vj1 && c.i >= Math.floor(x / TERRAIN_CHUNK) && c.i <= Math.floor((x + 639) / TERRAIN_CHUNK)) expect(c.stage === 2 || c.stage === 3).toBe(true);
  });

  it('at fast descent nothing on screen is late, and no chunk is uploaded in the frame its last band was painted', () => {
    const tv = new TerrainView(spec, art, fakeClock());
    tv.update({ x, y: 400 });
    const firstUploads = uploadLog.length;
    // ~1200 px/s at 60 fps, 5000 px of shaft
    descend(tv, x, 400, 20, 250);
    expect(tv.lateChunks).toBe(0);
    const flight = uploadLog.slice(firstUploads);
    expect(flight.length).toBeGreaterThan(20);
    for (const [up, painted] of flight) expect(painted).toBeLessThan(up);
    const perFrame = new Map<number, number>();
    for (const [up] of flight) perFrame.set(up, (perFrame.get(up) ?? 0) + 1);
    expect(Math.max(...perFrame.values())).toBeLessThanOrEqual(TERRAIN_UPLOADS_PER_FRAME);
  });

  it('leads along the direction of travel and recycles surfaces', () => {
    const tv = new TerrainView(spec, art, fakeClock());
    tv.update({ x, y: 400 });
    const made = canvasesMade;
    const y = descend(tv, x, 400, 20, 250);
    const chunks = [...(tv as unknown as { chunks: Map<number, { j: number }> }).chunks.values()];
    const js = chunks.map((c) => c.j);
    const vj0 = Math.floor(y / TERRAIN_CHUNK);
    const vj1 = Math.floor((y + 360) / TERRAIN_CHUNK);
    expect(Math.max(...js) - vj1).toBeGreaterThanOrEqual(2); // margin + lead below
    expect(vj0 - Math.min(...js)).toBeLessThanOrEqual(2); // margin (+ hysteresis) only above
    // steady state: culled surfaces are repainted in place, not re-created
    const mid = canvasesMade;
    descend(tv, x, y, 20, 150);
    expect(canvasesMade - mid).toBeLessThanOrEqual(2);
    expect(mid - made).toBeLessThan(40);
  });

  it('a camera jump (restart) resets the lead; on-screen chunks are finished at once', () => {
    const tv = new TerrainView(spec, art, fakeClock());
    tv.update({ x, y: 400 });
    const y = descend(tv, x, 400, 20, 60);
    const late0 = tv.lateChunks;
    const made = canvasesMade;
    const live = (tv as unknown as { chunks: Map<number, { surface: unknown }> }).chunks;
    const surfacesBefore = [...live.values()].filter((c) => c.surface).length;
    frame++;
    tv.update({ x, y: 400 }); // 1200 px back up: a jump
    expect(y - 400).toBeGreaterThan(360);
    expect(tv.jumpUpdates).toBe(1);
    expect(tv.lateChunks).toBe(late0); // exempt from the steady-flight late count...
    expect(tv.syncUploadsLastUpdate).toBeGreaterThan(0); // ...but its synchronous uploads are counted
    // abandoned chunks were released BEFORE the new set opened: their surfaces were reused
    expect(surfacesBefore).toBeGreaterThan(4);
    expect(canvasesMade - made).toBe(0);
    // everything on screen is shown after the jump frame
    const chunks = [...(tv as unknown as { chunks: Map<number, { i: number; j: number; stage: number; surface: unknown }> }).chunks.values()];
    for (const c of chunks) {
      const onScreen = c.j >= 1 && c.j <= Math.floor(759 / TERRAIN_CHUNK) && c.i >= Math.floor(x / TERRAIN_CHUNK) && c.i <= Math.floor((x + 639) / TERRAIN_CHUNK);
      if (onScreen && c.surface) expect(c.stage).toBe(2);
    }
  });
});

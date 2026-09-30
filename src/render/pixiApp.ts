/**
 * Pixi boot: a 640×360 virtual stage rendered at an integer device-pixel
 * scale (src/shell/scaler.ts), nearest-neighbour texture sampling, no
 * antialiasing. The canvas is centred (letterboxed) inside the host box.
 *
 * All game drawing happens in VIRTUAL px on `app.stage`; the renderer's
 * `resolution` = device px per virtual px, so textures stay crisp and
 * every virtual pixel is a whole number of device pixels.
 */

import { Application, TextureSource } from 'pixi.js';
import { VIEW_HEIGHT, VIEW_WIDTH } from '../contracts';
import { clientToView, watchViewScale, type ViewScale } from '../shell/scaler';

export interface PixiHost {
  app: Application;
  canvas: HTMLCanvasElement;
  /** Current scale (updated on resize / orientation change). */
  readonly scale: ViewScale;
  /**
   * Low-res mode: the backbuffer is the virtual 640×360 (device scale capped at
   * 1) and CSS upscales it with image-rendering: pixelated. Same CSS size, so
   * layout, pointer mapping and the DOM touch layer are unaffected.
   */
  setLowRes(on: boolean): void;
  readonly lowRes: boolean;
  /**
   * Upload a texture to the GPU now (level load) instead of on the first frame
   * that draws it, which on iOS shows as a one-off hitch mid-flight.
   */
  uploadTexture(source: TextureSource): void;
  /** Client (CSS) point -> virtual view px. */
  clientToView(clientX: number, clientY: number): { x: number; y: number };
  destroy(): void;
}

export interface PixiHostOptions {
  /**
   * Low-res mode from the first backbuffer allocation on (the App resolves the
   * setting BEFORE creating the host, so a low-res phone never allocates the
   * full-DPR buffer, not even for one frame).
   */
  lowRes?: boolean;
}

/**
 * Renderer resolution state: the latest device scale (from the scaler) and the
 * low-res flag; calls `resize(resolution)` whenever the effective resolution
 * changes. Pure (unit-tested with a fake resize).
 */
export class RenderResolutionState {
  private deviceScale: number | null = null;
  private applied: number | null = null;

  constructor(
    private readonly resize: (resolution: number) => void,
    private low = false,
  ) {}

  get lowRes(): boolean {
    return this.low;
  }

  /** New device scale from the scaler (first call = first real allocation). */
  setDeviceScale(s: number): void {
    this.deviceScale = s;
    this.apply(true);
  }

  setLowRes(on: boolean): void {
    if (on === this.low) return;
    this.low = on;
    this.apply(false);
  }

  private apply(force: boolean): void {
    if (this.deviceScale === null) return;
    const r = renderResolution(this.deviceScale, this.low);
    if (!force && r === this.applied) return;
    this.applied = r;
    this.resize(r);
  }
}

/** GPU resources unused this long (ms) are unloaded by Pixi's GC (default 60 s). */
export const GPU_GC_MAX_UNUSED_MS = 5 * 60_000;
/** How often Pixi's GPU GC sweeps (ms, default 30 s). */
export const GPU_GC_FREQUENCY_MS = 60_000;

export async function createPixiHost(host: HTMLElement, opts: PixiHostOptions = {}): Promise<PixiHost> {
  TextureSource.defaultOptions.scaleMode = 'nearest';
  const app = new Application();
  await app.init({
    width: VIEW_WIDTH,
    height: VIEW_HEIGHT,
    resolution: 1,
    autoDensity: false,
    antialias: false,
    roundPixels: true,
    background: 0x0b0d14,
    preference: 'webgl',
    // Pixi's GPU garbage collector (default: sweep every 30 s, unload anything
    // unused for 60 s) evicted the textures pre-uploaded at level load (crash
    // explosion, landed pose, pickups further on) and re-uploaded them on first
    // sight: a hitch mid-flight. LevelView.destroy() unloads a level's textures
    // itself at level end, so the GC only has to catch what nothing frees
    // explicitly (menu / UI resources idle for minutes).
    gcMaxUnusedTime: GPU_GC_MAX_UNUSED_MS,
    gcFrequency: GPU_GC_FREQUENCY_MS,
  });
  const canvas = app.canvas;
  canvas.style.position = 'absolute';
  canvas.style.imageRendering = 'pixelated';
  canvas.style.touchAction = 'none';
  canvas.tabIndex = -1;
  host.appendChild(canvas);

  let scale: ViewScale | null = null;
  const res = new RenderResolutionState((r) => app.renderer.resize(VIEW_WIDTH, VIEW_HEIGHT, r), !!opts.lowRes);
  const unwatch = watchViewScale(host, (s) => {
    scale = s;
    res.setDeviceScale(s.deviceScale);
    canvas.style.width = `${s.cssWidth}px`;
    canvas.style.height = `${s.cssHeight}px`;
    canvas.style.left = `${s.offsetX}px`;
    canvas.style.top = `${s.offsetY}px`;
  });

  return {
    app,
    canvas,
    get lowRes() {
      return res.lowRes;
    },
    setLowRes(on) {
      res.setLowRes(on);
    },
    get scale() {
      if (!scale) throw new Error('scale not computed yet');
      return scale;
    },
    uploadTexture(source) {
      if (source.destroyed || source.width <= 0 || source.height <= 0) return;
      app.renderer.texture.initSource(source);
    },
    clientToView(clientX, clientY) {
      return clientToView(clientX, clientY, canvas.getBoundingClientRect());
    },
    destroy() {
      unwatch();
      app.destroy(true, { children: true, texture: true });
    },
  };
}

/** Renderer resolution (device px per virtual px): the full device scale, or at most 1 in low-res mode. */
export function renderResolution(deviceScale: number, lowRes: boolean): number {
  return lowRes ? Math.min(1, deviceScale) : deviceScale;
}

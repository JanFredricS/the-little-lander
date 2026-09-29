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
  /** Client (CSS) point -> virtual view px. */
  clientToView(clientX: number, clientY: number): { x: number; y: number };
  destroy(): void;
}

export async function createPixiHost(host: HTMLElement): Promise<PixiHost> {
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
  });
  const canvas = app.canvas;
  canvas.style.position = 'absolute';
  canvas.style.imageRendering = 'pixelated';
  canvas.style.touchAction = 'none';
  canvas.tabIndex = -1;
  host.appendChild(canvas);

  let scale: ViewScale | null = null;
  const unwatch = watchViewScale(host, (s) => {
    scale = s;
    app.renderer.resize(VIEW_WIDTH, VIEW_HEIGHT, s.deviceScale);
    canvas.style.width = `${s.cssWidth}px`;
    canvas.style.height = `${s.cssHeight}px`;
    canvas.style.left = `${s.offsetX}px`;
    canvas.style.top = `${s.offsetY}px`;
  });

  return {
    app,
    canvas,
    get scale() {
      if (!scale) throw new Error('scale not computed yet');
      return scale;
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

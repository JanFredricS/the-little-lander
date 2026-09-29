/**
 * Pix -> pixels. The only place palette indices become colours.
 */

import type { PixelCanvas } from '../../contracts';
import type { Pix } from './pix';
import type { ArtPalette } from './palette';

/** RGBA bytes for a buffer (index 0 = fully transparent). */
export function toRGBA(pix: Pix, palette: ArtPalette, opaqueBackground?: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pix.w * pix.h * 4);
  const cols = palette.colors;
  for (let i = 0; i < pix.data.length; i++) {
    const idx = pix.data[i]!;
    const o = i * 4;
    if (idx === 0) {
      if (opaqueBackground !== undefined) {
        out[o] = (opaqueBackground >> 16) & 255;
        out[o + 1] = (opaqueBackground >> 8) & 255;
        out[o + 2] = opaqueBackground & 255;
        out[o + 3] = 255;
      }
      continue;
    }
    const c = cols[idx] ?? 0xff00ff;
    out[o] = (c >> 16) & 255;
    out[o + 1] = (c >> 8) & 255;
    out[o + 2] = c & 255;
    out[o + 3] = 255;
  }
  return out;
}

export type CanvasFactory = (w: number, h: number) => PixelCanvas;

/** DOM canvas when a document exists (Pixi-friendly), else OffscreenCanvas. */
export const defaultCanvasFactory: CanvasFactory = (w, h) => {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  throw new Error('No canvas implementation available (use the Pix-level generators in Node)');
};

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function pixToCanvas(pix: Pix, palette: ArtPalette, factory: CanvasFactory = defaultCanvasFactory): PixelCanvas {
  const canvas = factory(pix.w, pix.h);
  const ctx = canvas.getContext('2d') as Ctx2D | null;
  if (ctx) {
    const img = ctx.createImageData(pix.w, pix.h);
    img.data.set(toRGBA(pix, palette));
    ctx.putImageData(img, 0, 0);
  }
  return canvas;
}

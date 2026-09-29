/**
 * Flattens the art catalog into PNG-ready RGBA sheets (used by the headless
 * tools/export-art.mjs script; the browser gallery has its own buttons).
 */

import { toRGBA } from './core/canvas';
import { Pix } from './core/pix';
import { artCatalog, type CatalogItem } from './catalog';

export interface ExportSheet {
  path: string;
  w: number;
  h: number;
  rgba: Uint8ClampedArray;
}

/** Frames side by side with a 2px transparent gap. */
export function stripOf(frames: readonly Pix[]): Pix {
  const gap = frames.length > 1 ? 2 : 0;
  const w = frames.reduce((a, f) => a + f.w, 0) + gap * (frames.length - 1);
  const h = Math.max(...frames.map((f) => f.h));
  const out = new Pix(w, h);
  let x = 0;
  for (const f of frames) {
    out.blit(f, x, 0);
    x += f.w + gap;
  }
  return out;
}

export function sheetOf(item: CatalogItem): ExportSheet {
  const r = item.render();
  const strip = stripOf(r.frames);
  return { path: item.id, w: strip.w, h: strip.h, rgba: toRGBA(strip, r.palette, r.background) };
}

export function buildExportSheets(only = ''): ExportSheet[] {
  return artCatalog()
    .filter((it) => !only || it.id.includes(only))
    .map(sheetOf);
}

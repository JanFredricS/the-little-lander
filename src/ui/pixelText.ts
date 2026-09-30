/**
 * A Pixi Sprite showing bitmap-font text (re-rasterised only when it changes).
 *
 * The last few rasters are kept (CACHE_SIZE): text that alternates between a
 * handful of states (the low-fuel FUEL label blinking red/white, a menu label
 * toggling ON/OFF) swaps textures instead of building a new canvas and
 * uploading a new GPU texture on every flip.
 */

import { Sprite, Texture } from 'pixi.js';
import { rasterText, type RasterOptions } from './font';

/** Rasters kept per PixelText (most recently used first). */
const CACHE_SIZE = 4;

export class PixelText extends Sprite {
  private key = '';
  private text: string | null = null;
  private optsKey = '';
  /** Recently shown rasters, most recent first (includes the current texture). */
  private readonly cache: { key: string; tex: Texture }[] = [];

  constructor(text = '', private opts: RasterOptions = {}) {
    super(Texture.EMPTY);
    this.setText(text);
  }

  setText(text: string, opts?: RasterOptions): this {
    // Hot path (HUD calls this every frame): same text, no new options -> nothing to do, no allocation.
    const newOpts = opts !== undefined && !sameOpts(this.opts, opts);
    if (!newOpts && text === this.text) return this;
    if (newOpts || !this.optsKey) {
      if (newOpts) this.opts = { ...this.opts, ...opts };
      this.optsKey = JSON.stringify(this.opts);
    }
    this.text = text;
    const key = `${text}\u0000${this.optsKey}`;
    if (key === this.key) return this;
    this.key = key;
    if (!text) {
      this.texture = Texture.EMPTY;
      return this;
    }
    const cache = this.cache;
    let i = 0;
    while (i < cache.length && cache[i]!.key !== key) i++;
    let entry = cache[i];
    if (entry) cache.splice(i, 1);
    else {
      entry = { key, tex: Texture.from(rasterText(text, this.opts)) };
      while (cache.length >= CACHE_SIZE) cache.pop()!.tex.destroy(true); // never the current texture: it was just replaced
    }
    cache.unshift(entry);
    this.texture = entry.tex;
    return this;
  }

  override destroy(options?: Parameters<Sprite['destroy']>[0]): void {
    super.destroy(options);
    for (const { tex } of this.cache) if (!tex.destroyed) tex.destroy(true);
    this.cache.length = 0;
  }
}

/** Would merging `next` into `cur` change nothing? (flat option values only) */
function sameOpts(cur: RasterOptions, next: RasterOptions): boolean {
  for (const k in next) if ((next as Record<string, unknown>)[k] !== (cur as Record<string, unknown>)[k]) return false;
  return true;
}

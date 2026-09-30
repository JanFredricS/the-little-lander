/** A Pixi Sprite showing bitmap-font text (re-rasterised only when it changes). */

import { Sprite, Texture } from 'pixi.js';
import { rasterText, type RasterOptions } from './font';

export class PixelText extends Sprite {
  private key = '';
  private text: string | null = null;
  private optsKey = '';

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
    const old = this.texture;
    this.texture = text ? Texture.from(rasterText(text, this.opts)) : Texture.EMPTY;
    if (old !== Texture.EMPTY) old.destroy(true);
    return this;
  }

  override destroy(options?: Parameters<Sprite['destroy']>[0]): void {
    const t = this.texture;
    super.destroy(options);
    if (t && t !== Texture.EMPTY && !t.destroyed) t.destroy(true);
  }
}

/** Would merging `next` into `cur` change nothing? (flat option values only) */
function sameOpts(cur: RasterOptions, next: RasterOptions): boolean {
  for (const k in next) if ((next as Record<string, unknown>)[k] !== (cur as Record<string, unknown>)[k]) return false;
  return true;
}

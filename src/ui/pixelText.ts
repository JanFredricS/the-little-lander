/** A Pixi Sprite showing bitmap-font text (re-rasterised only when it changes). */

import { Sprite, Texture } from 'pixi.js';
import { rasterText, type RasterOptions } from './font';

export class PixelText extends Sprite {
  private key = '';

  constructor(text = '', private opts: RasterOptions = {}) {
    super(Texture.EMPTY);
    this.setText(text);
  }

  setText(text: string, opts?: RasterOptions): this {
    if (opts) this.opts = { ...this.opts, ...opts };
    const key = `${text}\u0000${JSON.stringify(this.opts)}`;
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

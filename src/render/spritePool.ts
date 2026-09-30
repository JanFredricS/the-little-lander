/**
 * Render helpers shared by the flight / S7 layers (S8):
 *  - SpriteTextures: one Pixi texture per (sprite name, frame), created on
 *    first use from the memoised ArtApi canvas and reused every frame;
 *  - SpritePool: per-frame sprites without per-frame allocation. begin(),
 *    then next() for each sprite drawn this frame, then end() hides the rest.
 *    Sprites are only ever created when a frame needs more than any frame
 *    before it.
 */

import { Container, Sprite, Texture, type Graphics } from 'pixi.js';
import type { ArtApi, SpriteName, ThemeId } from '../contracts';

interface FrameTex {
  tex: Texture;
  ax: number;
  ay: number;
}

export class SpriteTextures {
  private readonly cache = new Map<string, FrameTex[]>();
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly art: ArtApi,
    private readonly theme: ThemeId,
  ) {}

  frameCount(name: SpriteName): number {
    let n = this.counts.get(name);
    if (n === undefined) {
      n = Math.max(1, this.art.getSpriteFrameCount(name));
      this.counts.set(name, n);
    }
    return n;
  }

  /** Create the textures of every frame of `names` now (level load) instead of on first use mid-flight. */
  warm(names: readonly SpriteName[]): void {
    for (const name of names) {
      const n = this.frameCount(name);
      for (let i = 0; i < n; i++) this.get(name, i);
    }
  }

  /**
   * Level teardown: drop the GPU copies of every texture this cache made and
   * forget them. Unload, not destroy: the textures wrap the ArtApi's memoised
   * canvases (Pixi caches Texture.from per canvas), which menus or the next
   * level may show again; they re-upload on their next preload / first use.
   */
  release(): void {
    this.forEachTexture((t) => {
      if (!t.destroyed && !t.source.destroyed) t.source.unload();
    });
    this.cache.clear();
  }

  /** Every texture created so far (GPU pre-upload at level load). */
  forEachTexture(fn: (tex: Texture) => void): void {
    for (const frames of this.cache.values()) for (const f of frames) if (f) fn(f.tex);
  }

  /** Texture + normalised pivot of `name` frame `frame` (wraps like ArtApi.getSprite). */
  get(name: SpriteName, frame = 0): FrameTex {
    let frames = this.cache.get(name);
    if (!frames) {
      frames = [];
      this.cache.set(name, frames);
    }
    const n = this.frameCount(name);
    const i = ((Math.floor(frame) % n) + n) % n;
    let f = frames[i];
    if (!f) {
      const sf = this.art.getSprite(name, i, this.theme);
      f = { tex: Texture.from(sf.canvas as HTMLCanvasElement), ax: sf.pivot.x / sf.width, ay: sf.pivot.y / sf.height };
      frames[i] = f;
    }
    return f;
  }
}

export class SpritePool {
  private readonly sprites: Sprite[] = [];
  private used = 0;

  constructor(
    readonly container: Container,
    private readonly textures: SpriteTextures,
  ) {}

  /** Pre-create hidden sprites up to `n` (level load), so a burst never allocates display objects mid-flight. */
  reserve(n: number): void {
    while (this.sprites.length < n) {
      const s = new Sprite(Texture.EMPTY);
      s.visible = false;
      this.sprites.push(s);
      this.container.addChild(s);
    }
  }

  begin(): void {
    this.used = 0;
  }

  /** A visible sprite showing `name` frame `frame`, reset to no rotation / unit scale / no tint / opaque. */
  next(name: SpriteName, frame: number, x: number, y: number): Sprite {
    let s = this.sprites[this.used];
    if (!s) {
      s = new Sprite(Texture.EMPTY);
      this.sprites.push(s);
      this.container.addChild(s);
    }
    this.used++;
    const f = this.textures.get(name, frame);
    if (s.texture !== f.tex) s.texture = f.tex;
    s.anchor.set(f.ax, f.ay);
    s.position.set(x, y);
    s.rotation = 0;
    s.scale.set(1, 1);
    s.tint = 0xffffff;
    s.alpha = 1;
    s.visible = true;
    return s;
  }

  end(): void {
    for (let i = this.used; i < this.sprites.length; i++) this.sprites[i]!.visible = false;
  }

  /** Sprites in use this frame (tests / debugging). */
  get count(): number {
    return this.used;
  }
}

/**
 * clear() a per-frame Graphics only when it holds something. Pixi marks a
 * cleared Graphics dirty and rebuilds its GPU geometry on the next render even
 * when it was already empty, so an idle fx layer (no radiation pulse, no
 * vines on screen) would otherwise cost a geometry rebuild + garbage every frame.
 */
export function clearIfDrawn(g: Graphics): Graphics {
  if (g.context.instructions.length > 0) g.clear();
  return g;
}

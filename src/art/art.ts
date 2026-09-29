/**
 * The real ArtApi (S2). Wraps the Pix-level generators:
 *  - memoised: same arguments -> the SAME object (contract),
 *  - deterministic: generators are seeded, never use Math.random,
 *  - never throws for unknown names: magenta/black checker placeholder.
 *
 * Canvases are created lazily through a factory (DOM canvas in the browser,
 * OffscreenCanvas in workers; tests inject a fake).
 */

import { STILL_HEIGHT, STILL_WIDTH, TILE_SIZE } from '../contracts';
import type { ArtApi, BackdropLayer, PixelCanvas, Seed, SpriteFrame, SpriteName, StillId, ThemeId, TileKind } from '../contracts';
import { defaultCanvasFactory, pixToCanvas, type CanvasFactory } from './core/canvas';
import { Pix } from './core/pix';
import { generateBackdrop } from './backdrops';
import { PALETTES, PLACEHOLDER } from './palettes';
import { spriteRegistry } from './sprites/registry';
import type { SpriteDef } from './sprites/types';
import { generateStill, STILL_IDS } from './stills';
import { generateTile, TERRAIN_MATERIALS, TILE_ROLES } from './tiles';

/** Magenta/black 4px checker with a dark border. */
export function placeholderPix(w = 16, h = 16): Pix {
  const p = new Pix(w, h);
  p.apply((x, y) => (((x >> 2) + (y >> 2)) % 2 === 0 ? 1 : 2));
  return p;
}

const PLACEHOLDER_DEF: SpriteDef = { frames: [placeholderPix()], palette: PLACEHOLDER, pivot: { x: 8, y: 8 } };

/** Resolve a sprite to its generated definition (Pix level; no canvas). */
export function resolveSprite(name: string, theme?: ThemeId): { def: SpriteDef; theme: ThemeId | null; known: boolean } {
  const entry = spriteRegistry()[name];
  if (!entry) return { def: PLACEHOLDER_DEF, theme: null, known: false };
  const t = entry.themed ? (theme ?? entry.home) : entry.home;
  return { def: entry.gen(t), theme: entry.themed ? t : null, known: true };
}

const isTileKind = (k: string): k is TileKind => {
  const [m, r] = k.split(':');
  return (TERRAIN_MATERIALS as readonly string[]).includes(m ?? '') && (TILE_ROLES as readonly string[]).includes(r ?? '');
};

export interface CreateArtOptions {
  canvasFactory?: CanvasFactory;
}

export function createArt(opts: CreateArtOptions = {}): ArtApi {
  const factory = opts.canvasFactory ?? defaultCanvasFactory;
  const defs = new Map<string, SpriteDef>();
  const frames = new Map<string, SpriteFrame>();
  const tiles = new Map<string, PixelCanvas>();
  const backdrops = new Map<ThemeId, readonly BackdropLayer[]>();
  const stills = new Map<string, PixelCanvas>();

  const defFor = (name: string, theme?: ThemeId): { key: string; def: SpriteDef } => {
    const entry = spriteRegistry()[name];
    const t = entry?.themed ? (theme ?? entry.home) : '';
    const key = `${name}|${t}`;
    let def = defs.get(key);
    if (!def) {
      def = resolveSprite(name, theme).def;
      defs.set(key, def);
    }
    return { key, def };
  };

  return {
    palettes: PALETTES,

    getSprite(name: SpriteName, frame = 0, theme?: ThemeId): SpriteFrame {
      const { key, def } = defFor(name, theme);
      const n = def.frames.length;
      const f = ((Math.floor(frame) % n) + n) % n;
      const fkey = `${key}#${f}`;
      let sf = frames.get(fkey);
      if (!sf) {
        const pix = def.frames[f]!;
        sf = { canvas: pixToCanvas(pix, def.palette, factory), width: pix.w, height: pix.h, pivot: { ...def.pivot } };
        frames.set(fkey, sf);
      }
      return sf;
    },

    getSpriteFrameCount(name: SpriteName): number {
      return defFor(name).def.frames.length;
    },

    getTile(theme: ThemeId, tileKind: TileKind, variantSeed: Seed): PixelCanvas {
      const v = (variantSeed >>> 0) || 0;
      const key = `${theme}|${tileKind}|${v}`;
      let c = tiles.get(key);
      if (!c) {
        const pix = isTileKind(tileKind) && PALETTES[theme] ? generateTile(theme, tileKind, v) : placeholderPix(TILE_SIZE, TILE_SIZE);
        c = pixToCanvas(pix, isTileKind(tileKind) && PALETTES[theme] ? PALETTES[theme] : PLACEHOLDER, factory);
        tiles.set(key, c);
      }
      return c;
    },

    getBackdropLayers(theme: ThemeId): readonly BackdropLayer[] {
      let b = backdrops.get(theme);
      if (!b) {
        const pal = PALETTES[theme] ?? PALETTES.hangar;
        b = generateBackdrop(PALETTES[theme] ? theme : 'hangar').map((l) => ({
          canvas: pixToCanvas(l.pix, pal, factory),
          width: l.pix.w,
          height: l.pix.h,
          parallax: l.parallax,
          offsetY: l.offsetY,
          repeatX: l.repeatX,
          repeatY: l.repeatY,
        }));
        backdrops.set(theme, b);
      }
      return b;
    },

    getStill(stillId: StillId): PixelCanvas {
      let c = stills.get(stillId);
      if (!c) {
        if ((STILL_IDS as readonly string[]).includes(stillId)) {
          const s = generateStill(stillId);
          c = pixToCanvas(s.pix, s.palette, factory);
        } else {
          c = pixToCanvas(placeholderPix(STILL_WIDTH, STILL_HEIGHT), PLACEHOLDER, factory);
        }
        stills.set(stillId, c);
      }
      return c;
    },
  };
}

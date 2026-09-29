/**
 * Stub ArtApi: flat-colour placeholder canvases + a placeholder palette per
 * theme. Lets render/UI/story code run before the real generators (S2) land.
 * Deterministic: colours come from a hash of the name.
 */

import { STILL_HEIGHT, STILL_WIDTH, THEME_IDS, TILE_SIZE } from '../contracts';
import type { ArtApi, BackdropLayer, Palette, PaletteCatalog, PixelCanvas, RampName, Seed, SpriteFrame, SpriteName, StillId, ThemeId, TileKind } from '../contracts';

/** Placeholder palettes: a neutral 13-colour set tinted per theme. */
const TINTS: Record<ThemeId, number> = {
  hangar: 0x4a78b0,
  asteroid: 0xd06a2a,
  islands: 0x4caf6a,
  caves: 0x2aa6a0,
  core: 0x9a6ad0,
  boss: 0x7a3a9a,
  collapse: 0xc03a3a,
};

function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

function stubPalette(theme: ThemeId): Palette {
  const tint = TINTS[theme];
  const colors = [
    0x000000, // 0: transparent
    0x0b0d14, // 1: outline
    mix(0x0b0d14, tint, 0.25),
    mix(0x0b0d14, tint, 0.5),
    tint,
    mix(tint, 0xffffff, 0.35),
    0x2a2e3a,
    0x4a5064,
    0x7a8298,
    0xb8c0d0,
    0xf0b030, // accent amber
    0xfff0c0, // light
    0x16202e, // sky
  ];
  const ramps: Record<RampName, readonly number[]> = {
    shadow: [1, 2],
    primary: [2, 3, 4, 5],
    secondary: [6, 7, 8, 9],
    accent: [10, 11],
    sky: [12, 2],
    foliage: [2, 3, 4, 5],
    light: [9, 11],
  };
  return { themeId: theme, name: `Placeholder ${theme}`, colors, ramps, outline: 1, background: 0x0b0d14 };
}

export const STUB_PALETTES: PaletteCatalog = Object.fromEntries(THEME_IDS.map((t) => [t, stubPalette(t)])) as unknown as PaletteCatalog;

/** FNV-1a 32-bit. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const SPRITE_SIZES: Partial<Record<string, [number, number]>> = {
  'vessel.csm': [20, 28],
  'vessel.lander': [24, 24],
  'vessel.pod': [16, 16],
  'vessel.podThrust': [16, 22],
  'fx.flameMain': [8, 12],
  'fx.flameSmall': [4, 8],
};

function makeCanvas(w: number, h: number): PixelCanvas {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}

function fillRect(c: PixelCanvas, color: number, outline = true): PixelCanvas {
  const ctx = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return c;
  const hex = `#${color.toString(16).padStart(6, '0')}`;
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, c.width, c.height);
  if (outline && c.width > 2 && c.height > 2) {
    ctx.fillStyle = '#0b0d14';
    ctx.fillRect(0, 0, c.width, 1);
    ctx.fillRect(0, c.height - 1, c.width, 1);
    ctx.fillRect(0, 0, 1, c.height);
    ctx.fillRect(c.width - 1, 0, 1, c.height);
  }
  return c;
}

function colorFor(name: string, palette: Palette): number {
  const usable = [3, 4, 5, 7, 8, 9, 10];
  return palette.colors[usable[hashString(name) % usable.length]!]!;
}

export function createStubArt(): ArtApi {
  const sprites = new Map<string, SpriteFrame>();
  const tiles = new Map<string, PixelCanvas>();
  const backdrops = new Map<ThemeId, readonly BackdropLayer[]>();
  const stills = new Map<StillId, PixelCanvas>();

  return {
    palettes: STUB_PALETTES,
    getSprite(name: SpriteName, _frame = 0, theme: ThemeId = 'hangar'): SpriteFrame {
      const key = `${theme}|${name}`;
      let s = sprites.get(key);
      if (!s) {
        const [w, h] = SPRITE_SIZES[name] ?? [16, 16];
        const color = name.startsWith('vessel.') ? 0xd8dce8 : name.startsWith('fx.flame') ? 0xf0b030 : colorFor(name, STUB_PALETTES[theme]);
        const canvas = fillRect(makeCanvas(w, h), color, !name.startsWith('fx.'));
        s = { canvas, width: w, height: h, pivot: { x: w / 2, y: h / 2 } };
        sprites.set(key, s);
      }
      return s;
    },
    getSpriteFrameCount(): number {
      return 1;
    },
    getTile(theme: ThemeId, tileKind: TileKind, variantSeed: Seed): PixelCanvas {
      const key = `${theme}|${tileKind}|${variantSeed}`;
      let t = tiles.get(key);
      if (!t) {
        t = fillRect(makeCanvas(TILE_SIZE, TILE_SIZE), colorFor(tileKind, STUB_PALETTES[theme]), false);
        tiles.set(key, t);
      }
      return t;
    },
    getBackdropLayers(theme: ThemeId): readonly BackdropLayer[] {
      let b = backdrops.get(theme);
      if (!b) {
        const p = STUB_PALETTES[theme];
        const canvas = fillRect(makeCanvas(64, 64), p.colors[12]!, false);
        b = [{ canvas, width: 64, height: 64, parallax: 0, offsetY: 0, repeatX: true, repeatY: true }];
        backdrops.set(theme, b);
      }
      return b;
    },
    getStill(stillId: StillId): PixelCanvas {
      let s = stills.get(stillId);
      if (!s) {
        s = fillRect(makeCanvas(STILL_WIDTH, STILL_HEIGHT), colorFor(stillId, STUB_PALETTES.hangar));
        stills.set(stillId, s);
      }
      return s;
    },
  };
}

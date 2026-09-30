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
import { generateTile, TERRAIN_MATERIALS, THEME_MATERIALS, TILE_ROLES } from './tiles';

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

/**
 * Number of distinct tile variants per (theme, tileKind). getTile reduces any
 * variantSeed to `seed % TILE_VARIANTS`, so warmup (which builds 0..N-1)
 * provably covers every tile a level can request.
 */
export const TILE_VARIANTS = 4;

export interface WarmupOptions {
  /** Stop early (e.g. the player left the loading screen). */
  signal?: AbortSignal;
  /** Yield to the event loop after this many ms of work (default 8). */
  sliceMs?: number;
}

/**
 * Preload API (beyond the frozen ArtApi contract): generation is lazy and
 * memoised, so first use of a sprite/tile/still costs a main-thread hitch.
 * Call these at level / cutscene load so gameplay never pays for it.
 */
export interface ArtPreload {
  /** Everything a level of `theme` can draw: craft sprites, the theme's props/creatures, tiles, backdrops. */
  warmup(theme: ThemeId, opts?: WarmupOptions): Promise<void>;
  /** Cutscene stills. */
  warmupStills(ids: readonly StillId[], opts?: WarmupOptions): Promise<void>;
}

export type Art = ArtApi & ArtPreload;

/** True when `art` is the real implementation (stubs have no preload). */
export function hasPreload(art: ArtApi): art is Art {
  return typeof (art as Partial<ArtPreload>).warmup === 'function';
}

async function runSliced(jobs: (() => void)[], opts: WarmupOptions = {}): Promise<void> {
  const slice = opts.sliceMs ?? 8;
  let t0 = performance.now();
  for (const job of jobs) {
    if (opts.signal?.aborted) return;
    job();
    if (performance.now() - t0 > slice) {
      await new Promise<void>((r) => setTimeout(r, 0));
      t0 = performance.now();
    }
  }
}

export function createArt(opts: CreateArtOptions = {}): Art {
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

  const api: ArtApi = {
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
      // any seed is accepted; it maps onto one of TILE_VARIANTS variants
      const v = ((variantSeed >>> 0) || 0) % TILE_VARIANTS;
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
        b = generateBackdrop(PALETTES[theme] ? theme : 'hangar').map((l) => {
          // perf (fill rate on phones): a strip that does not repeat vertically is cropped to its
          // non-transparent rows, so the GPU does not blend hundreds of empty rows every frame
          const c = l.repeatY ? { pix: l.pix, top: 0 } : cropRows(l.pix);
          return {
            canvas: pixToCanvas(c.pix, pal, factory),
            width: c.pix.w,
            height: c.pix.h,
            parallax: l.parallax,
            offsetY: l.offsetY + c.top,
            repeatX: l.repeatX,
            repeatY: l.repeatY,
          };
        });
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

  return {
    ...api,
    async warmup(theme, o = {}) {
      const jobs: (() => void)[] = [];
      const reg = spriteRegistry();
      for (const [name, entry] of Object.entries(reg)) {
        const relevant = entry.themed ? entry.home === theme || name.startsWith('obj.') : !entry.themed && (entry.home === theme || isCraft(name));
        if (!relevant) continue;
        jobs.push(() => {
          const n = api.getSpriteFrameCount(name as SpriteName);
          for (let f = 0; f < n; f++) api.getSprite(name as SpriteName, f, theme);
        });
      }
      for (const m of THEME_MATERIALS[theme] ?? [])
        for (const r of TILE_ROLES) for (let v = 0; v < TILE_VARIANTS; v++) jobs.push(() => api.getTile(theme, `${m}:${r}` as TileKind, v));
      jobs.push(() => api.getBackdropLayers(theme));
      await runSliced(jobs, o);
    },
    async warmupStills(ids, o = {}) {
      await runSliced(ids.map((id) => () => api.getStill(id)), o);
    },
  };
}

/** Theme-independent craft sprites (vessels, flames/fx, gameplay objects). */
function isCraft(name: string): boolean {
  return name.startsWith('vessel.') || name.startsWith('fx.') || name.startsWith('obj.');
}

/**
 * `pix` without its fully transparent top / bottom rows (+ how many rows were
 * cut from the top). Returned as-is when there is little to gain.
 */
export function cropRows(pix: Pix): { pix: Pix; top: number } {
  const { w, h, data } = pix;
  const rowEmpty = (y: number): boolean => {
    for (let i = y * w, e = i + w; i < e; i++) if (data[i]) return false;
    return true;
  };
  let y0 = 0;
  while (y0 < h && rowEmpty(y0)) y0++;
  if (y0 === h) return { pix, top: 0 }; // fully transparent: leave it alone
  let y1 = h - 1;
  while (y1 > y0 && rowEmpty(y1)) y1--;
  const rows = y1 - y0 + 1;
  if (h - rows < 8) return { pix, top: 0 };
  const out = new Pix(w, rows);
  out.data.set(data.subarray(y0 * w, (y1 + 1) * w));
  return { pix: out, top: y0 };
}

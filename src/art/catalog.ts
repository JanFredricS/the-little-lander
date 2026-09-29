/**
 * The complete art set as a flat, labelled list — what the ?gallery=1 page
 * shows and tools/export-art.mjs writes out. Everything is rendered at the
 * Pix level (no canvas), so this works in Node too.
 */

import type { Rgb } from '../contracts';
import type { ArtPalette } from './core/palette';
import { spriteRegistry } from './sprites/registry';
import { THEME_IDS, TILE_SIZE } from '../contracts';
import type { ThemeId, TileKind } from '../contracts';
import { Pix } from './core/pix';
import { PALETTES } from './palettes';
import { TERRAIN_MATERIALS, THEME_MATERIALS, generateTile } from './tiles';
import { generateBackdrop } from './backdrops';

export interface CatalogRender {
  frames: Pix[];
  palette: ArtPalette;
  /** Fill for transparent pixels (backdrops/stills are opaque anyway). */
  background?: Rgb;
}

export interface CatalogItem {
  /** Export path, e.g. `sprites/vessel.lander`. */
  id: string;
  section: string;
  label: string;
  note?: string;
  render(): CatalogRender;
  /** Optional existence check (filtered out when false). */
  exists?: () => boolean;
}

export function artCatalog(): CatalogItem[] {
  const items: CatalogItem[] = [];
  for (const [name, entry] of Object.entries(spriteRegistry())) {
    const section = name.startsWith('vessel.') ? 'Vessels' : `Sprites · ${entry.home}`;
    items.push({
      id: `sprites/${entry.themed ? `${entry.home}/` : ''}${name}`,
      section,
      label: name,
      note: entry.note,
      render: () => {
        const d = entry.gen(entry.home);
        return { frames: d.frames, palette: d.palette };
      },
    });
  }
  for (const theme of THEME_IDS) {
    items.push({
      id: `tiles/${theme}`,
      section: 'Terrain tiles',
      label: `${theme} tiles`,
      note: 'rows = materials (theme materials first); fill×3, top×3, bottom×3, side×2, decor×2, then a seamless 4×3 demo chunk',
      render: () => ({ frames: [tileSheet(theme)], palette: PALETTES[theme], background: PALETTES[theme].background }),
    });
  }
  for (const theme of THEME_IDS) {
    const layers = () => generateBackdrop(theme);
    items.push({
      id: `backdrops/${theme}/composite`,
      section: 'Parallax backdrops',
      label: `${theme} — all layers composited`,
      render: () => {
        const ls = layers();
        const out = new Pix(ls[0]!.pix.w, ls[0]!.pix.h);
        for (const l of ls) out.blit(l.pix, 0, l.offsetY);
        return { frames: [out], palette: PALETTES[theme], background: PALETTES[theme].background };
      },
    });
    for (let i = 0; i < 4; i++) {
      items.push({
        id: `backdrops/${theme}/layer${i}`,
        section: 'Parallax backdrops',
        label: `${theme} layer ${i}`,
        render: () => {
          const l = layers()[i];
          if (!l) return { frames: [], palette: PALETTES[theme] };
          return { frames: [l.pix], palette: PALETTES[theme] };
        },
        exists: () => i < layers().length,
      });
    }
  }
  return items.filter((it) => !it.exists || it.exists());
}

/** One theme's tile set laid out for review. */
export function tileSheet(theme: ThemeId): Pix {
  const T = TILE_SIZE;
  const gap = 2;
  const mats = [...THEME_MATERIALS[theme], ...TERRAIN_MATERIALS.filter((m) => !THEME_MATERIALS[theme].includes(m))];
  const cols: [string, number][] = [
    ['fill', 0], ['fill', 1], ['fill', 2],
    ['top', 0], ['top', 1], ['top', 2],
    ['bottom', 0], ['bottom', 1], ['bottom', 2],
    ['side', 0], ['side', 1],
    ['decor', 0], ['decor', 1],
  ];
  const demoW = 4 * T;
  const W = cols.length * (T + gap) + gap * 3 + demoW;
  const rowH = 3 * T + gap;
  const out = new Pix(W, mats.length * rowH);
  mats.forEach((m, row) => {
    const y = row * rowH;
    cols.forEach(([role, v], i) => out.blit(generateTile(theme, `${m}:${role}` as TileKind, v), i * (T + gap), y));
    // demo chunk: tops over fills over bottoms (checks seams across variants)
    const dx = cols.length * (T + gap) + gap * 2;
    for (let c = 0; c < 4; c++) {
      out.blit(generateTile(theme, `${m}:top` as TileKind, c), dx + c * T, y);
      out.blit(generateTile(theme, `${m}:fill` as TileKind, c + 7), dx + c * T, y + T);
      out.blit(generateTile(theme, `${m}:bottom` as TileKind, c + 3), dx + c * T, y + 2 * T);
    }
  });
  return out;
}

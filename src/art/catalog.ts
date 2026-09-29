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
import { CRAFT, PALETTES } from './palettes';
import { TERRAIN_MATERIALS, THEME_MATERIALS, generateTile } from './tiles';
import { generateBackdrop } from './backdrops';
import { generateStill, STILL_IDS } from './stills';

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
  for (const id of STILL_IDS) {
    items.push({
      id: `stills/${id}`,
      section: 'Cutscene stills',
      label: id,
      render: () => {
        const s = generateStill(id);
        return { frames: [s.pix], palette: s.palette };
      },
    });
  }
  const reg = spriteRegistry();
  for (const [name, entry] of Object.entries(reg)) {
    const craft = !entry.themed && /^(vessel|fx|obj)\./.test(name);
    const section = !craft
      ? `Sprites · ${entry.home}`
      : name.startsWith('vessel.')
        ? 'Vessels (craft palette)'
        : name.startsWith('fx.')
          ? 'Effects (craft palette)'
          : 'Objects (craft palette)';
    items.push({
      id: `sprites/${craft ? 'craft/' : `${entry.home}/`}${name}`,
      section,
      label: name,
      note: entry.note ?? (craft ? 'shared craft palette: identical in every theme' : undefined),
      render: () => {
        const d = entry.gen(entry.home);
        return { frames: d.frames, palette: d.palette };
      },
    });
  }
  // Cross-theme gameplay objects, shown in every theme against that theme's
  // backdrop + ground tiles so reviewers judge them in context.
  for (const theme of THEME_IDS) {
    for (const [name, entry] of Object.entries(reg)) {
      if (entry.themed || !name.startsWith('obj.')) continue;
      items.push({
        id: `sprites/${theme}/context/${name}`,
        section: `Sprites · ${theme}`,
        label: `${name} (craft) in ${theme}`,
        note: 'craft-palette object over this theme\'s backdrop and ground tiles',
        render: () => inContext(theme, entry.gen(theme).frames),
      });
    }
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

/** Theme palette + craft palette merged (craft indices offset past the theme's). */
function contextPalette(theme: ThemeId): ArtPalette {
  const t = PALETTES[theme];
  return { name: `${t.name} + craft`, colors: [...t.colors, ...CRAFT.colors.slice(1)], ramps: {}, outline: t.outline };
}

/** Draw craft-palette frames over a crop of the theme backdrop with a strip of ground tiles. */
function inContext(theme: ThemeId, frames: readonly Pix[]): CatalogRender {
  const off = PALETTES[theme].colors.length - 1;
  const layers = generateBackdrop(theme);
  const bw = layers[0]!.pix.w;
  const bh = layers[0]!.pix.h;
  const comp = new Pix(bw, bh);
  for (const l of layers) comp.blit(l.pix, 0, l.offsetY);
  const mat = THEME_MATERIALS[theme][0]!;
  const out = frames.map((f) => {
    const W = Math.max(48, Math.ceil((f.w + 16) / TILE_SIZE) * TILE_SIZE);
    const H = f.h + 12 + TILE_SIZE;
    const p = comp.crop(200, Math.max(0, Math.min(bh - H, 170)), W, H);
    for (let x = 0; x < W; x += TILE_SIZE) p.blit(generateTile(theme, `${mat}:top` as TileKind, x / TILE_SIZE), x, H - TILE_SIZE);
    p.blit(f, Math.floor((W - f.w) / 2), H - TILE_SIZE - f.h, { map: (c) => c + off });
    return p;
  });
  return { frames: out, palette: contextPalette(theme), background: PALETTES[theme].background };
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

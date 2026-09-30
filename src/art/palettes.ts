/**
 * The palette catalog (palette-first theming). One 16-entry palette per
 * ThemeId (index 0 = transparent, 15 real colours), tuned toward the
 * research/inspiration references, plus:
 *  - CRAFT: the shared palette for vessels, flames and gameplay objects, so
 *    the player's craft and pickups read identically in every theme
 *    (gold-foil descent stage vs grey ascent stage, per the Apollo refs).
 *  - PLACEHOLDER: magenta/black checker for unknown sprite names.
 *
 * Generators only ever write palette INDICES; colours live here alone.
 */

import type { Palette, PaletteCatalog, ThemeId } from '../contracts';
import type { ArtPalette } from './core/palette';

const hangar: Palette = {
  themeId: 'hangar',
  name: 'Halcyon Hangar',
  // cool steel-blue / periwinkle deck, planet-blue glow, amber screens (pixel-space-station-deck)
  colors: [
    0x000000, // 0 transparent
    0x0a0b1c, // 1 outline
    0x151a3a, // 2 navy space
    0x252a52, // 3 steel deep
    0x3c4375, // 4 steel dark
    0x5e679e, // 5 steel
    0x8a93c4, // 6 steel light
    0xbfc6e6, // 7 steel highlight
    0xeef0ff, // 8 white
    0x1b4a92, // 9 planet deep
    0x3584cf, // 10 planet blue
    0x8ccaf2, // 11 planet cloud
    0x6e2e16, // 12 amber deep
    0xdc7428, // 13 amber
    0xffc860, // 14 amber light
    0xc8303c, // 15 alarm red
  ],
  ramps: {
    shadow: [1, 2, 3],
    primary: [3, 4, 5, 7],
    secondary: [2, 3, 4, 5],
    accent: [12, 13, 14],
    sky: [2, 9, 10, 11],
    foliage: [9, 10, 11],
    light: [7, 8, 14],
  },
  outline: 1,
  background: 0x151a3a,
};

const asteroid: Palette = {
  themeId: 'asteroid',
  name: 'Ember Belt',
  // charcoal rock, ember orange, purple goo
  colors: [
    0x000000, // 0
    0x09070f, // 1 outline
    0x15111e, // 2 space
    0x241e2c, // 3 charcoal deep
    0x39313f, // 4 charcoal
    0x574d58, // 5 rock
    0x807378, // 6 rock light
    0xb2a5a2, // 7 rock highlight
    0x5c1a10, // 8 ember deep
    0xb6421a, // 9 ember
    0xf0882a, // 10 ember bright
    0xffd272, // 11 hot
    0x2c1440, // 12 goo deep
    0x6a2a8c, // 13 goo
    0xb662da, // 14 goo light
    0xfff4e0, // 15 white-hot / stars
  ],
  ramps: {
    shadow: [1, 2, 3],
    primary: [3, 4, 5, 7],
    secondary: [2, 3, 4, 5],
    accent: [8, 9, 10, 11],
    sky: [1, 2, 12, 3],
    foliage: [12, 13, 14],
    light: [7, 11, 15],
  },
  outline: 1,
  background: 0x15111e,
};

const islands: Palette = {
  themeId: 'islands',
  name: 'Floating Isles',
  // lush greens on warm brown rock, cyan sky into white haze, sunset pink/gold
  colors: [
    0x000000, // 0
    0x13191b, // 1 outline
    0x2d2620, // 2 rock deep
    0x51432f, // 3 rock
    0x7e6a4e, // 4 rock light
    0xae9a78, // 5 rock pale
    0x163a2a, // 6 foliage deep
    0x2d6c34, // 7 foliage
    0x5ea63c, // 8 foliage light
    0xb6dc5c, // 9 foliage highlight
    0x4a8ec6, // 10 sky
    0x8ccbe8, // 11 sky light
    0xe2f2f2, // 12 haze
    0xe88c88, // 13 sunset pink
    0xffd68a, // 14 gold haze
    0x587892, // 15 far-island blue-grey
  ],
  ramps: {
    shadow: [1, 2, 6],
    primary: [2, 3, 4, 5],
    secondary: [15, 11, 12],
    accent: [13, 14, 12],
    sky: [10, 11, 12],
    foliage: [6, 7, 8, 9],
    light: [11, 14, 12],
  },
  outline: 1,
  background: 0x8ccbe8,
};

const caves: Palette = {
  themeId: 'caves',
  name: 'The Throat',
  // deep blue-black rock, god-ray gold, bioluminescent teal, alien violet
  colors: [
    0x000000, // 0
    0x05060c, // 1 outline
    0x0c1122, // 2 rock deep
    0x161f40, // 3 rock dark
    0x243060, // 4 rock
    0x384a84, // 5 rock light
    0x5c6ea6, // 6 rock highlight
    0x08363c, // 7 teal deep
    0x0e7e78, // 8 teal
    0x38dcbe, // 9 teal bright
    0xb0fff0, // 10 teal white
    0x684818, // 11 gold deep
    0xc68e2e, // 12 gold
    0xffd66e, // 13 gold light
    0xfff4c8, // 14 god-ray white
    0x3c1a4e, // 15 violet deep
  ],
  ramps: {
    shadow: [1, 2, 3],
    primary: [2, 3, 4, 6],
    secondary: [15, 3, 4],
    accent: [7, 8, 9, 10],
    sky: [1, 2, 3],
    foliage: [7, 8, 9, 10],
    light: [11, 12, 13, 14],
  },
  outline: 1,
  background: 0x05060c,
};

const core: Palette = {
  themeId: 'core',
  name: 'The Hollow',
  // tropical greens, turquoise water, white artificial sunlight, aurora violet
  colors: [
    0x000000, // 0
    0x10141a, // 1 outline
    0x2c2a26, // 2 rock deep
    0x4e4b3e, // 3 rock
    0x7e7862, // 4 rock light
    0x0e3a2a, // 5 jungle deep
    0x1e7a3a, // 6 jungle
    0x4ec24a, // 7 jungle light
    0xb2f070, // 8 jungle highlight
    0x186a8a, // 9 water
    0x3ac2d2, // 10 water light
    0x3a2a6c, // 11 violet deep
    0x7a4ad0, // 12 aurora violet
    0xd292ff, // 13 aurora light
    0xfffbe8, // 14 sunlight white
    0xffe07a, // 15 sun yellow
  ],
  ramps: {
    shadow: [1, 2, 5],
    primary: [2, 3, 4],
    secondary: [9, 10, 14],
    accent: [13, 15, 14],
    sky: [11, 12, 13, 14],
    foliage: [5, 6, 7, 8],
    light: [13, 15, 14],
  },
  outline: 1,
  background: 0x3a2a6c,
};

const boss: Palette = {
  themeId: 'boss',
  name: "Keeper's Deep",
  // abyssal purple, sickly green glow, flesh
  colors: [
    0x000000, // 0
    0x07040c, // 1 outline
    0x140a20, // 2 abyss
    0x24123a, // 3 purple deep
    0x3a1e58, // 4 purple dark
    0x5a2e7a, // 5 purple
    0x8a4ca2, // 6 purple light
    0x1c3a14, // 7 sick deep
    0x4a7a1a, // 8 sick
    0x9ad02a, // 9 sick bright
    0xe2ff7c, // 10 sick glow
    0x6a1030, // 11 flesh deep
    0xb02a52, // 12 flesh
    0xff6c7c, // 13 flesh light
    0xc4b2d4, // 14 pale
    0xfff8e0, // 15 flash
  ],
  ramps: {
    shadow: [1, 2, 3],
    primary: [2, 3, 4, 6],
    secondary: [11, 12, 13],
    accent: [7, 8, 9, 10],
    sky: [1, 2, 3, 4],
    foliage: [7, 8, 9, 10],
    light: [6, 14, 15],
  },
  outline: 1,
  background: 0x140a20,
};

const collapse: Palette = {
  themeId: 'collapse',
  name: 'The Mad Dash',
  // ruin grey stone, alarm red, dawn gold, moss (overgrown-tech ref)
  colors: [
    0x000000, // 0
    0x0c0a0c, // 1 outline
    0x1e1a1e, // 2 ruin deep
    0x36302f, // 3 ruin dark
    0x5a5250, // 4 ruin
    0x8a807a, // 5 ruin light
    0xbcb2a8, // 6 ruin highlight
    0x5a0e12, // 7 alarm deep
    0xb01e22, // 8 alarm
    0xff4a32, // 9 alarm bright
    0x6a4a20, // 10 dawn deep
    0xd8962e, // 11 dawn
    0xffd068, // 12 dawn light
    0xfff4d8, // 13 white
    0x2e4a22, // 14 moss deep
    0x6a9a34, // 15 moss
  ],
  ramps: {
    shadow: [1, 2, 3],
    primary: [2, 3, 4, 6],
    secondary: [2, 3, 4],
    accent: [7, 8, 9],
    sky: [7, 10, 11, 12],
    foliage: [3, 14, 15],
    light: [11, 12, 13],
  },
  outline: 1,
  background: 0x1e1a1e,
};

export const PALETTES: PaletteCatalog = { hangar, asteroid, islands, caves, core, boss, collapse };

/**
 * Shared craft palette (vessels, flames, gameplay objects). Not a theme, so
 * it lives beside the catalog rather than inside it.
 */
export const CRAFT: ArtPalette = {
  name: 'Craft',
  colors: [
    0x000000, // 0 transparent
    0x13111e, // 1 outline
    0x363a4c, // 2 grey deep
    0x5a6074, // 3 grey dark
    0x8a91a6, // 4 grey
    0xc0c6d4, // 5 grey light
    0xeef0f6, // 6 white
    0x5a3610, // 7 foil deep
    0x9c6416, // 8 foil
    0xd69c24, // 9 foil gold
    0xf4d04c, // 10 foil bright
    0xfff2a6, // 11 foil glint
    0xb2361c, // 12 flame deep
    0xf07a22, // 13 flame
    0xffba42, // 14 flame bright
    0xfff6d6, // 15 flame core
    0x18386a, // 16 window deep
    0x4aa2e2, // 17 window glint
    0x3a1452, // 18 goo deep
    0x7a2c9c, // 19 goo
    0xc262e2, // 20 goo light
    0xf2b4ff, // 21 goo glint
    0x0c5a60, // 22 orb deep
    0x28c2b0, // 23 orb
    0xb2fff0, // 24 orb glint
    0x9e1e22, // 25 red
    0xff4c3a, // 26 red bright
    0x248a3a, // 27 green
    0x7cf27a, // 28 green bright
  ],
  ramps: {
    shadow: [1, 2],
    grey: [2, 3, 4, 5, 6],
    foil: [7, 8, 9, 10, 11],
    flame: [12, 13, 14, 15],
    window: [16, 17],
    goo: [18, 19, 20, 21],
    orb: [22, 23, 24],
    red: [25, 26],
    green: [27, 28],
  },
  outline: 1,
};

export const PLACEHOLDER: ArtPalette = {
  name: 'Placeholder',
  colors: [0x000000, 0xff00ff, 0x000000],
  ramps: { all: [1, 2] },
  outline: 2,
};

const padded = new WeakMap<object, unknown>();

/**
 * Contract ramps are 3-4 shades. Generators that index shades directly
 * (ramp[3], ramp[4]) work on a padded view: every ramp repeated at its
 * lightest end up to `n` entries. Pixels still come only from the palette.
 */
export function padRamps<P extends { ramps: Readonly<Record<string, readonly number[]>> }>(pal: P, n = 5): P {
  const hit = padded.get(pal);
  if (hit) return hit as P;
  const ramps: Record<string, readonly number[]> = {};
  for (const [k, r] of Object.entries(pal.ramps)) ramps[k] = r.length >= n ? r : [...r, ...Array<number>(n - r.length).fill(r[r.length - 1]!)];
  const out = { ...pal, ramps } as P;
  padded.set(pal, out);
  return out;
}
